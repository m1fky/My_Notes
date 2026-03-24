"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  Bell,
  CheckCircle2,
  Cloud,
  CloudOff,
  FolderPlus,
  Home,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Star,
  Wifi,
  WifiOff,
} from "lucide-react";

import { NoteEditor } from "@/components/note-editor";
import { db } from "@/lib/db";
import { emptyDoc } from "@/lib/editor";
import { hasSupabasePublicEnv, publicEnv } from "@/lib/env";
import { demoFolders, demoNotes } from "@/lib/mock-data";
import { formatReminder, hasDueReminder } from "@/lib/reminders";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { flushQueue, pullSnapshot } from "@/lib/sync";
import type { Folder, Note, Reminder, SyncQueueItem } from "@/lib/types";
import { cn, deviceNameFromNavigator, isUuid, makeId, toTitle } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const folderColors = ["#7dd3fc", "#f9a8d4", "#34d399", "#f59e0b", "#a78bfa"];

function base64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);

  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function ensureSeededData(seedDemo: boolean) {
  if (!seedDemo) {
    return;
  }

  const count = await db.notes.count();
  if (count > 0) {
    return;
  }

  await db.transaction("rw", db.folders, db.notes, db.syncQueue, async () => {
    await db.folders.bulkPut(demoFolders);
    await db.notes.bulkPut(demoNotes);
    await db.syncQueue.bulkPut(
      demoFolders.map((folder) => ({
        id: `seed-folder-${folder.id}`,
        entity: "folder" as const,
        operation: "upsert" as const,
        payload: folder,
        createdAt: folder.updatedAt,
      })),
    );
    await db.syncQueue.bulkPut(
      demoNotes.map((note) => ({
        id: `seed-${note.id}`,
        entity: "note" as const,
        operation: "upsert" as const,
        payload: note,
        createdAt: note.updatedAt,
      })),
    );
  });
}

async function normalizeLegacyLocalIds() {
  const [folders, notes, queue] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.syncQueue.toArray(),
  ]);

  const folderIdMap = new Map<string, string>();
  const noteIdMap = new Map<string, string>();

  for (const folder of folders) {
    if (!isUuid(folder.id)) {
      folderIdMap.set(folder.id, makeId());
    }
  }

  for (const note of notes) {
    if (!isUuid(note.id)) {
      noteIdMap.set(note.id, makeId());
    }
  }

  const needsMigration =
    folderIdMap.size > 0 ||
    noteIdMap.size > 0 ||
    notes.some((note) =>
      note.reminders.some((reminder) => !isUuid(reminder.id)) ||
      note.attachments.some((attachment) => !isUuid(attachment.id)),
    );

  if (!needsMigration) {
    return;
  }

  const migratedFolders = folders.map((folder) => ({
    ...folder,
    id: folderIdMap.get(folder.id) ?? folder.id,
  }));

  const migratedNotes = notes.map((note) => {
    const nextNoteId = noteIdMap.get(note.id) ?? note.id;

    return {
      ...note,
      id: nextNoteId,
      folderId: note.folderId ? (folderIdMap.get(note.folderId) ?? note.folderId) : null,
      attachments: note.attachments.map((attachment) => ({
        ...attachment,
        id: isUuid(attachment.id) ? attachment.id : makeId(),
        noteId: nextNoteId,
      })),
      reminders: note.reminders.map((reminder) => ({
        ...reminder,
        id: isUuid(reminder.id) ? reminder.id : makeId(),
        noteId: nextNoteId,
      })),
    };
  });

  const migratedQueue = queue.map((item) => {
    if (item.entity === "folder" && "color" in item.payload) {
      const folder = item.payload as Folder;
      const nextFolder: Folder = {
        ...folder,
        id: folderIdMap.get(folder.id) ?? folder.id,
      };

      return {
        ...item,
        id: `queue-folder-${nextFolder.id}`,
        payload: nextFolder,
      };
    }

    const note = item.payload as Note;
    const nextNoteId = noteIdMap.get(note.id) ?? note.id;
    const nextNote: Note = {
      ...note,
      id: nextNoteId,
      folderId: note.folderId ? (folderIdMap.get(note.folderId) ?? note.folderId) : null,
      attachments: note.attachments.map((attachment) => ({
        ...attachment,
        id: isUuid(attachment.id) ? attachment.id : makeId(),
        noteId: nextNoteId,
      })),
      reminders: note.reminders.map((reminder) => ({
        ...reminder,
        id: isUuid(reminder.id) ? reminder.id : makeId(),
        noteId: nextNoteId,
      })),
    };

    return {
      ...item,
      id: `queue-note-${nextNote.id}`,
      payload: nextNote,
    };
  });

  await db.transaction("rw", db.folders, db.notes, db.syncQueue, async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.syncQueue.clear();
    await db.folders.bulkPut(migratedFolders);
    await db.notes.bulkPut(migratedNotes);
    await db.syncQueue.bulkPut(migratedQueue);
  });
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.readAsDataURL(file);
  });
}

function nowIso() {
  return new Date().toISOString();
}

export function NotesApp() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [syncLabel, setSyncLabel] = useState("Загрузка данных…");
  const [isOnline, setIsOnline] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission>("default");
  const [syncRequest, setSyncRequest] = useState(0);

  const supabaseEnabled = hasSupabasePublicEnv();
  const supabase = getSupabaseBrowserClient();

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  const visibleNotes = useMemo(() => {
    return notes
      .filter((note) => !note.deletedAt && !note.isArchived)
      .filter((note) => (folderFilter === "all" ? true : note.folderId === folderFilter))
      .filter((note) => {
        const haystack = `${note.title} ${note.plainText} ${note.tags.join(" ")}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
          return left.isPinned ? -1 : 1;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [folderFilter, notes, query]);

  useEffect(() => {
    setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    setNotificationStatus(typeof Notification === "undefined" ? "default" : Notification.permission);

    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", onInstall);

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      await ensureSeededData(!supabaseEnabled);
      await normalizeLegacyLocalIds();
      await loadLocal();
      setIsLoading(false);
      setSyncLabel(supabaseEnabled ? "Локальные данные готовы" : "Demo/local mode");
    };

    void bootstrap();
  }, [supabaseEnabled]);

  useEffect(() => {
    if (!selectedNoteId && notes.length) {
      const candidate = notes.find((note) => !note.deletedAt && !note.isArchived) ?? notes[0];
      setSelectedNoteId(candidate?.id ?? null);
    }
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  async function loadLocal() {
    const [localNotes, localFolders] = await Promise.all([db.notes.toArray(), db.folders.toArray()]);
    setNotes(localNotes);
    setFolders(localFolders.sort((left, right) => left.name.localeCompare(right.name, "ru")));
  }

  async function pushQueueItem(item: SyncQueueItem) {
    await db.syncQueue.put(item);
  }

  async function ensureFoldersQueuedForSync() {
    const localFolders = await db.folders.toArray();

    await Promise.all(
      localFolders.map((folder) =>
        db.syncQueue.put({
          id: `queue-folder-${folder.id}`,
          entity: "folder",
          operation: "upsert",
          payload: folder,
          createdAt: folder.updatedAt,
        }),
      ),
    );
  }

  async function upsertFolder(folder: Folder) {
    await db.folders.put(folder);
    await pushQueueItem({
      id: `queue-folder-${folder.id}`,
      entity: "folder",
      operation: "upsert",
      payload: folder,
      createdAt: folder.updatedAt,
    });
    await loadLocal();
    if (isOnline && supabase && session) {
      setSyncRequest(Date.now());
    }
  }

  async function upsertNote(note: Note) {
    await db.notes.put(note);
    await pushQueueItem({
      id: `queue-note-${note.id}`,
      entity: "note",
      operation: note.deletedAt ? "delete" : "upsert",
      payload: note,
      createdAt: note.updatedAt,
    });
    await loadLocal();
    if (isOnline && supabase && session) {
      setSyncRequest(Date.now());
    }
  }

  const syncWithCloud = useCallback(async () => {
    if (!supabase || !session) {
      return;
    }

    try {
      setSyncLabel("Синхронизирую с облаком…");
      await ensureFoldersQueuedForSync();
      const queue = await db.syncQueue.toArray();

      if (queue.length) {
        const { conflicts } = await flushQueue(supabase, session.user.id, queue);
        if (conflicts.length) {
          for (const conflict of conflicts) {
            const copy: Note = {
              ...conflict.note,
              id: makeId(),
              title: `${conflict.note.title} · Conflict copy`,
              createdAt: nowIso(),
              updatedAt: nowIso(),
              version: 1,
              lastSyncedVersion: 0,
              syncState: "conflicted",
            };
            await db.notes.put(copy);
          }
        }
        await db.syncQueue.clear();
      }

      const snapshot = await pullSnapshot(supabase, session.user.id);
      await db.transaction("rw", db.folders, db.notes, async () => {
        await db.folders.clear();
        await db.notes.clear();
        await db.folders.bulkPut(snapshot.folders);
        await db.notes.bulkPut(snapshot.notes);
      });
      await loadLocal();
      setSyncLabel("Синхронизировано");
    } catch (error) {
      setSyncLabel(error instanceof Error ? error.message : "Ошибка синхронизации");
    }
  }, [session, supabase]);

  useEffect(() => {
    if (!supabase || !session || !isOnline) {
      return;
    }

    void syncWithCloud();

    const notesChannel = supabase
      .channel("liquid-notes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes", filter: `user_id=eq.${session.user.id}` },
        () => void syncWithCloud(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(notesChannel);
    };
  }, [isOnline, session, supabase, syncWithCloud]);

  useEffect(() => {
    if (!syncRequest || !supabase || !session || !isOnline) {
      return;
    }

    const timer = window.setTimeout(() => {
      void syncWithCloud();
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOnline, session, supabase, syncRequest, syncWithCloud]);

  async function createNote() {
    const timestamp = nowIso();
    const note: Note = {
      id: makeId(),
      userId: session?.user.id ?? null,
      title: "Новая заметка",
      folderId: folders[0]?.id ?? null,
      tags: [],
      contentJson: emptyDoc(),
      plainText: "",
      isPinned: false,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      lastSyncedVersion: 0,
      syncState: "queued",
      attachments: [],
      reminders: [],
    };
    await upsertNote(note);
    setSelectedNoteId(note.id);
  }

  async function createFolder() {
    const timestamp = nowIso();
    const folder: Folder = {
      id: makeId(),
      userId: session?.user.id ?? null,
      name: `Папка ${folders.length + 1}`,
      color: folderColors[folders.length % folderColors.length],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await upsertFolder(folder);
  }

  async function mutateSelectedNote(mutator: (note: Note) => Note) {
    if (!selectedNote) {
      return;
    }

    const next = mutator(selectedNote);
    await upsertNote({
      ...next,
      title: toTitle(next.title),
      updatedAt: nowIso(),
      version: next.version + 1,
      syncState: next.syncState === "conflicted" ? "conflicted" : "queued",
    });
  }

  async function handleAuthSubmit() {
    if (!supabase) {
      return;
    }

    setAuthBusy(true);
    setAuthMessage("");

    try {
      const action =
        authMode === "sign-in"
          ? supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
          : supabase.auth.signUp({ email: authEmail, password: authPassword });

      const { error } = await action;
      if (error) {
        throw error;
      }

      setAuthMessage(
        authMode === "sign-up"
          ? "Письмо для подтверждения отправлено. После входа данные начнут синхронизироваться."
          : "Вход выполнен.",
      );
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Ошибка авторизации");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleAuth() {
    if (!supabase) {
      return;
    }

    const redirectTo = `${window.location.origin}/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      setAuthMessage(error.message);
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setSyncLabel("Уведомления не поддерживаются в этом браузере");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationStatus(permission);

    if (permission !== "granted") {
      setSyncLabel("Разрешение на уведомления не выдано");
      return;
    }

    if (!publicEnv.vapidPublicKey) {
      setSyncLabel("Добавьте NEXT_PUBLIC_VAPID_PUBLIC_KEY для web push");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(publicEnv.vapidPublicKey),
    });

    if (session) {
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription,
          deviceName: deviceNameFromNavigator(),
          userId: session.user.id,
        }),
      });
    }

    setSyncLabel("Push-уведомления включены");
  }

  async function promptInstall() {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  async function logout() {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setSyncLabel("Вы вышли из аккаунта");
  }

  async function addImages(files: FileList | null) {
    if (!files || !selectedNote) {
      return;
    }

    const attachments = await Promise.all(
      [...files].map(async (file) => ({
        id: makeId(),
        noteId: selectedNote.id,
        kind: "image" as const,
        name: file.name,
        sourceUrl: await readFileAsDataUrl(file),
        createdAt: nowIso(),
      })),
    );

    await mutateSelectedNote((note) => ({
      ...note,
      attachments: [...note.attachments, ...attachments],
    }));
  }

  async function updateReminder(input: Partial<Reminder>) {
    if (!selectedNote) {
      return;
    }

    const current = selectedNote.reminders[0];
    const nextReminder: Reminder = {
      id: current?.id ?? makeId(),
      noteId: selectedNote.id,
      fireAt: input.fireAt ?? current?.fireAt ?? new Date(Date.now() + 3600_000).toISOString(),
      timezone: input.timezone ?? current?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      repeatRule: input.repeatRule ?? current?.repeatRule ?? "none",
      isEnabled: input.isEnabled ?? current?.isEnabled ?? true,
      lastSentAt: current?.lastSentAt ?? null,
    };

    await mutateSelectedNote((note) => ({
      ...note,
      reminders: [nextReminder],
    }));
  }

  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.matchMedia("(display-mode: standalone)").matches;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass-panel flex items-center gap-3 rounded-full px-5 py-3 text-white/72">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Подготавливаю Liquid Notes…
        </div>
      </div>
    );
  }

  if (supabaseEnabled && !session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="glass-panel relative overflow-hidden rounded-[36px] border border-white/10 p-8 lg:p-10">
            <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/12 to-transparent" />
            <div className="relative space-y-6">
              <div className="liquid-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/80">
                <Sparkles className="h-4 w-4" />
                iOS Liquid Glass · Android/ПК/iPhone PWA
              </div>
              <div className="max-w-xl space-y-4">
                <h1 className="text-5xl font-semibold tracking-[-0.06em] text-white md:text-6xl">
                  Заметки, которые живут как настоящее приложение.
                </h1>
                <p className="text-lg leading-8 text-white/70">
                  Ставится на главный экран Android и iPhone, работает оффлайн, синхронизируется через
                  Supabase и отправляет напоминания на все ваши устройства.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ["Оффлайн", "Локальная база Dexie и очередь синка"],
                  ["Push", "Web Push и deeplink в заметку"],
                  ["Sync", "Realtime + cloud snapshot"],
                ].map(([title, desc]) => (
                  <div key={title} className="liquid-pill rounded-[24px] p-4">
                    <p className="text-sm font-medium text-white">{title}</p>
                    <p className="mt-2 text-sm leading-6 text-white/62">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="glass-panel rounded-[36px] border border-white/10 p-6 md:p-8">
            <div className="space-y-5">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-white/40">Auth</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                  {authMode === "sign-in" ? "Войти" : "Создать аккаунт"}
                </h2>
              </div>
              <div className="space-y-3">
                <input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  placeholder="email@example.com"
                  className="w-full rounded-[24px] border border-white/12 bg-white/7 px-4 py-4 text-white outline-none placeholder:text-white/28"
                />
                <input
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  type="password"
                  placeholder="Пароль"
                  className="w-full rounded-[24px] border border-white/12 bg-white/7 px-4 py-4 text-white outline-none placeholder:text-white/28"
                />
              </div>
              <button
                type="button"
                disabled={authBusy}
                onClick={handleAuthSubmit}
                className="w-full rounded-[24px] bg-white/92 px-4 py-4 font-medium text-slate-950 transition hover:translate-y-[-1px] disabled:opacity-60"
              >
                {authBusy ? "Подождите…" : authMode === "sign-in" ? "Войти по email" : "Создать аккаунт"}
              </button>
              <button
                type="button"
                onClick={handleGoogleAuth}
                className="w-full rounded-[24px] border border-white/16 bg-transparent px-4 py-4 font-medium text-white transition hover:bg-white/8"
              >
                Google sign-in
              </button>
              <button
                type="button"
                onClick={() => setAuthMode((mode) => (mode === "sign-in" ? "sign-up" : "sign-in"))}
                className="text-sm text-white/58"
              >
                {authMode === "sign-in"
                  ? "Нет аккаунта? Создать"
                  : "Уже есть аккаунт? Переключиться на вход"}
              </button>
              {authMessage ? <p className="text-sm leading-6 text-white/62">{authMessage}</p> : null}
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 px-3 py-3 md:px-5 md:py-5">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="glass-panel rounded-[34px] border border-white/10 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-white/40">Liquid Notes</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-white">Ваши заметки</h1>
            </div>
            <button
              type="button"
              onClick={createNote}
              className="liquid-pill inline-flex h-11 w-11 items-center justify-center rounded-2xl"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 flex items-center gap-2 rounded-[24px] border border-white/10 bg-white/7 px-4 py-3 text-white/58">
            <Search className="h-4 w-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по заметкам"
              className="w-full bg-transparent outline-none placeholder:text-white/28"
            />
          </div>

          <div className="mb-5 space-y-2">
            <button
              type="button"
              onClick={() => setFolderFilter("all")}
              className={cn(
                "flex w-full items-center justify-between rounded-[22px] px-4 py-3 text-left transition",
                folderFilter === "all" ? "bg-white/14 text-white" : "text-white/68 hover:bg-white/6",
              )}
            >
              <span className="inline-flex items-center gap-3">
                <Home className="h-4 w-4" />
                Все заметки
              </span>
              <span>{notes.filter((note) => !note.deletedAt && !note.isArchived).length}</span>
            </button>
            {folders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                onClick={() => setFolderFilter(folder.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-[22px] px-4 py-3 text-left transition",
                  folderFilter === folder.id ? "bg-white/14 text-white" : "text-white/68 hover:bg-white/6",
                )}
              >
                <span className="inline-flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: folder.color }}
                  />
                  {folder.name}
                </span>
                <span>{notes.filter((note) => note.folderId === folder.id && !note.deletedAt).length}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={createFolder}
              className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-white/58 transition hover:bg-white/6 hover:text-white"
            >
              <FolderPlus className="h-4 w-4" />
              Добавить папку
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.24em] text-white/35">Список</p>
              <span className="text-sm text-white/48">{visibleNotes.length}</span>
            </div>
            <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {visibleNotes.map((note) => (
                  <motion.button
                    key={note.id}
                    layout
                    onClick={() => setSelectedNoteId(note.id)}
                    className={cn(
                      "w-full rounded-[28px] border px-4 py-4 text-left transition",
                      selectedNoteId === note.id
                        ? "border-white/20 bg-white/16"
                        : "border-white/8 bg-white/6 hover:bg-white/9",
                    )}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="line-clamp-2 text-base font-medium text-white">{note.title}</p>
                        <p className="mt-1 text-xs text-white/42">
                          {folders.find((folder) => folder.id === note.folderId)?.name ?? "Без папки"}
                        </p>
                      </div>
                      {note.isPinned ? <Star className="h-4 w-4 text-sky-300" /> : null}
                    </div>
                    <p className="line-clamp-3 text-sm leading-6 text-white/58">{note.plainText || "Пустая заметка"}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {note.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded-full bg-white/8 px-3 py-1 text-xs text-white/58">
                          #{tag}
                        </span>
                      ))}
                      {hasDueReminder(note.reminders) ? (
                        <span className="rounded-full bg-rose-400/16 px-3 py-1 text-xs text-rose-200">
                          Reminder due
                        </span>
                      ) : null}
                    </div>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-[30px] border border-white/10 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="liquid-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/72">
                {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                {isOnline ? "Онлайн" : "Оффлайн"}
              </span>
              <span className="liquid-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/72">
                {supabaseEnabled ? <Cloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
                {syncLabel}
              </span>
              <span className="liquid-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/72">
                <Bell className="h-4 w-4" />
                {notificationStatus === "granted" ? "Push включен" : "Push не включен"}
              </span>
            </div>
            {session ? (
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-white/58 transition hover:bg-white/8 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                Выйти
              </button>
            ) : (
              <span className="text-sm text-white/48">Demo mode без облака</span>
            )}
          </div>

          <NoteEditor
            note={selectedNote}
            onTitleChange={(title) => {
              void mutateSelectedNote((note) => ({ ...note, title }));
            }}
            onContentChange={(content, plainText) => {
              void mutateSelectedNote((note) => ({ ...note, contentJson: content, plainText }));
            }}
            onAddImages={addImages}
          />

          {selectedNote?.attachments.length ? (
            <div className="glass-panel rounded-[30px] border border-white/10 p-4">
              <p className="mb-3 text-sm uppercase tracking-[0.24em] text-white/36">Изображения</p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectedNote.attachments.map((attachment) => (
                  <div key={attachment.id} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.sourceUrl} alt={attachment.name} className="h-44 w-full object-cover" />
                    <div className="px-4 py-3 text-sm text-white/62">{attachment.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-white/36">Onboarding</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-white/64">
              <div className="rounded-[26px] border border-white/10 bg-white/6 p-4">
                <div className="mb-2 inline-flex items-center gap-2 text-white">
                  <Smartphone className="h-4 w-4" />
                  Установка на главный экран
                </div>
                {installPrompt ? (
                  <button
                    type="button"
                    onClick={promptInstall}
                    className="mt-3 w-full rounded-[20px] bg-white/92 px-4 py-3 font-medium text-slate-950"
                  >
                    Установить PWA
                  </button>
                ) : isIos ? (
                  <p>На iPhone/iPad откройте Share и выберите “На экран Домой”.</p>
                ) : (
                  <p>PWA уже установлена либо браузер не отдал install prompt.</p>
                )}
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/6 p-4">
                <div className="mb-2 inline-flex items-center gap-2 text-white">
                  <Bell className="h-4 w-4" />
                  Уведомления
                </div>
                <button
                  type="button"
                  onClick={enableNotifications}
                  className="mt-3 w-full rounded-[20px] border border-white/12 px-4 py-3 text-white transition hover:bg-white/10"
                >
                  Включить push
                </button>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-white/36">Inspector</p>
            {selectedNote ? (
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-white/54">Теги</label>
                  <input
                    value={selectedNote.tags.join(", ")}
                    onChange={(event) => {
                      const tags = event.target.value
                        .split(",")
                        .map((tag) => tag.trim())
                        .filter(Boolean);
                      void mutateSelectedNote((note) => ({ ...note, tags }));
                    }}
                    className="w-full rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-white outline-none placeholder:text-white/26"
                    placeholder="pwa, ideas, personal"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void mutateSelectedNote((note) => ({ ...note, isPinned: !note.isPinned }))}
                    className="rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-sm text-white/72 transition hover:bg-white/10"
                  >
                    {selectedNote.isPinned ? "Открепить" : "Закрепить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void mutateSelectedNote((note) => ({ ...note, isArchived: !note.isArchived }))}
                    className="rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-sm text-white/72 transition hover:bg-white/10"
                  >
                    {selectedNote.isArchived ? "Вернуть из архива" : "В архив"}
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-white/54">Папка</label>
                  <select
                    value={selectedNote.folderId ?? ""}
                    onChange={(event) => {
                      void mutateSelectedNote((note) => ({
                        ...note,
                        folderId: event.target.value || null,
                      }));
                    }}
                    className="w-full rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-white outline-none"
                  >
                    <option value="">Без папки</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-3 rounded-[26px] border border-white/10 bg-white/6 p-4">
                  <div className="flex items-center gap-2 text-white">
                    <Bell className="h-4 w-4" />
                    Напоминание
                  </div>
                  <input
                    type="datetime-local"
                    value={
                      selectedNote.reminders[0]?.fireAt
                        ? selectedNote.reminders[0].fireAt.slice(0, 16)
                        : new Date(Date.now() + 3600_000).toISOString().slice(0, 16)
                    }
                    onChange={(event) =>
                      void updateReminder({
                        fireAt: new Date(event.target.value).toISOString(),
                      })
                    }
                    className="w-full rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-white outline-none"
                  />
                  <select
                    value={selectedNote.reminders[0]?.repeatRule ?? "none"}
                    onChange={(event) =>
                      void updateReminder({
                        repeatRule: event.target.value as Reminder["repeatRule"],
                      })
                    }
                    className="w-full rounded-[20px] border border-white/10 bg-white/7 px-4 py-3 text-white outline-none"
                  >
                    <option value="none">Без повтора</option>
                    <option value="daily">Каждый день</option>
                    <option value="weekly">Каждую неделю</option>
                  </select>
                  <div className="text-sm text-white/54">{formatReminder(selectedNote.reminders[0])}</div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void mutateSelectedNote((note) => ({
                      ...note,
                      deletedAt: nowIso(),
                    }))
                  }
                  className="w-full rounded-[22px] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100 transition hover:bg-rose-400/14"
                >
                  Удалить заметку
                </button>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-white/56">Свойства заметки появятся здесь.</p>
            )}
          </div>

          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-white/36">Status</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-white/64">
              <div className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/6 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                Local-first редактирование активно через IndexedDB.
              </div>
              <div className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/6 p-4">
                <Archive className="mt-0.5 h-4 w-4 text-sky-300" />
                Cloud sync, auth и realtime включаются после настройки env Supabase.
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
