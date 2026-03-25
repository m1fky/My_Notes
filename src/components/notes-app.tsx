"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Archive,
  Bell,
  Clock3,
  CheckCircle2,
  Cloud,
  CloudOff,
  FileText,
  FolderPlus,
  Home,
  LoaderCircle,
  LogOut,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { NoteEditor } from "@/components/note-editor";
import { db } from "@/lib/db";
import { emptyDoc } from "@/lib/editor";
import { hasSupabasePublicEnv, publicEnv } from "@/lib/env";
import { demoFolders, demoNotes, isDemoFolderSeed, isDemoNoteSeed } from "@/lib/mock-data";
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

function stripSeededDemoData(notes: Note[], folders: Folder[]) {
  const removedNoteIds = new Set<string>();
  const notesWithoutDemo = notes.filter((note) => {
    const isDemo = isDemoNoteSeed(note);
    if (isDemo) {
      removedNoteIds.add(note.id);
    }
    return !isDemo;
  });

  const removedFolderIds = new Set(
    folders
      .filter((folder) => isDemoFolderSeed(folder))
      .filter((folder) => !notesWithoutDemo.some((note) => note.folderId === folder.id))
      .map((folder) => folder.id),
  );

  const cleanedNotes = notesWithoutDemo.map((note) =>
    note.folderId && removedFolderIds.has(note.folderId)
      ? {
          ...note,
          folderId: null,
        }
      : note,
  );

  return {
    notes: cleanedNotes,
    folders: folders.filter((folder) => !removedFolderIds.has(folder.id)),
    removedNoteIds,
    removedFolderIds,
  };
}

async function purgeLocalDemoState(cloudMode: boolean, isAuthed: boolean) {
  if (!cloudMode || !isAuthed) {
    return false;
  }

  const [localNotes, localFolders, queue] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
    db.syncQueue.toArray(),
  ]);

  const { notes: cleanedNotes, folders: cleanedFolders, removedNoteIds, removedFolderIds } =
    stripSeededDemoData(localNotes, localFolders);

  let changed = removedNoteIds.size > 0 || removedFolderIds.size > 0;

  const cleanedQueue = queue
    .filter((item) => {
      if (item.entity === "folder" && "color" in item.payload) {
        const folder = item.payload as Folder;
        if (removedFolderIds.has(folder.id)) {
          changed = true;
          return false;
        }

        if (isDemoFolderSeed(folder) && !cleanedNotes.some((note) => note.folderId === folder.id)) {
          changed = true;
          return false;
        }

        return true;
      }

      const note = item.payload as Note;
      if (removedNoteIds.has(note.id) || isDemoNoteSeed(note)) {
        changed = true;
        return false;
      }

      return true;
    })
    .map((item) => {
      if (item.entity === "note" && "contentJson" in item.payload) {
        const note = item.payload as Note;
        if (note.folderId && removedFolderIds.has(note.folderId)) {
          changed = true;
        }

        return {
          ...item,
          payload: {
            ...note,
            folderId: note.folderId && removedFolderIds.has(note.folderId) ? null : note.folderId,
          },
        };
      }

      return item;
    });

  if (!changed && cleanedQueue.length === queue.length) {
    return false;
  }

  await db.transaction("rw", db.folders, db.notes, db.syncQueue, async () => {
    await db.folders.clear();
    await db.notes.clear();
    await db.syncQueue.clear();
    if (cleanedFolders.length) {
      await db.folders.bulkPut(cleanedFolders);
    }
    if (cleanedNotes.length) {
      await db.notes.bulkPut(cleanedNotes);
    }
    if (cleanedQueue.length) {
      await db.syncQueue.bulkPut(cleanedQueue);
    }
  });

  return true;
}

async function settleProcessedQueue(queue: SyncQueueItem[]) {
  if (!queue.length) {
    return;
  }

  const currentQueue = await db.syncQueue.bulkGet(queue.map((item) => item.id));
  const queueIdsToDelete = currentQueue.flatMap((currentItem, index) => {
    const processedItem = queue[index];

    if (!currentItem) {
      return [];
    }

    return currentItem.createdAt === processedItem.createdAt ? [processedItem.id] : [];
  });

  const processedNoteItems = queue.filter(
    (item): item is SyncQueueItem & { payload: Note } =>
      item.entity === "note" && "contentJson" in item.payload,
  );

  const currentNotes = await db.notes.bulkGet(processedNoteItems.map((item) => item.payload.id));
  const notesToUpdate = currentNotes.flatMap((currentNote, index) => {
    const processedNote = processedNoteItems[index].payload;

    if (!currentNote) {
      return [];
    }

    if (currentNote.updatedAt !== processedNote.updatedAt || currentNote.version !== processedNote.version) {
      return [];
    }

    return [
      {
        ...currentNote,
        lastSyncedVersion: Math.max(currentNote.lastSyncedVersion, currentNote.version),
        syncState: "synced" as const,
      },
    ];
  });

  await db.transaction("rw", db.notes, db.syncQueue, async () => {
    if (queueIdsToDelete.length) {
      await db.syncQueue.bulkDelete(queueIdsToDelete);
    }

    if (notesToUpdate.length) {
      await db.notes.bulkPut(notesToUpdate);
    }
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

function formatUpdatedAt(value?: string | null) {
  if (!value) {
    return "Только что";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function appendImagesToDoc(
  contentJson: Note["contentJson"],
  attachments: Array<Pick<Note["attachments"][number], "name" | "sourceUrl">>,
) {
  const normalizedDoc =
    contentJson?.type === "doc"
      ? {
          ...contentJson,
          content: [...(contentJson.content ?? [])],
        }
      : emptyDoc();

  return {
    ...normalizedDoc,
    type: "doc" as const,
    content: [
      ...(normalizedDoc.content ?? []),
      ...attachments.flatMap((attachment) => [
        {
          type: "image" as const,
          attrs: {
            src: attachment.sourceUrl,
            alt: attachment.name,
            title: attachment.name,
          },
        },
        {
          type: "paragraph" as const,
        },
      ]),
    ],
  };
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
  const [mobileView, setMobileView] = useState<"library" | "editor" | "details">("library");
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const syncInFlightRef = useRef(false);

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
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const updateLayout = () => setIsCompactLayout(mediaQuery.matches);

    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);

    return () => {
      mediaQuery.removeEventListener("change", updateLayout);
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
    if (selectedNoteId && notes.some((note) => note.id === selectedNoteId)) {
      return;
    }

    const candidate = notes.find((note) => !note.deletedAt && !note.isArchived) ?? notes[0] ?? null;
    setSelectedNoteId(candidate?.id ?? null);
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (folderFilter === "all") {
      return;
    }

    if (!folders.some((folder) => folder.id === folderFilter)) {
      setFolderFilter("all");
    }
  }, [folderFilter, folders]);

  useEffect(() => {
    if (!isCompactLayout) {
      setMobileView("editor");
      return;
    }

    if (!selectedNote) {
      setMobileView("library");
    }
  }, [isCompactLayout, selectedNote]);

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

  useEffect(() => {
    void purgeLocalDemoState(supabaseEnabled, Boolean(session)).then((changed) => {
      if (changed) {
        void loadLocal();
      }
    });
  }, [session, supabaseEnabled]);

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

  async function renameFolder(folder: Folder) {
    const nextName = window.prompt("Название папки", folder.name)?.trim();

    if (!nextName || nextName === folder.name) {
      return;
    }

    await upsertFolder({
      ...folder,
      name: nextName,
      updatedAt: nowIso(),
    });
  }

  async function deleteFolder(folder: Folder) {
    const confirmed = window.confirm(
      `Удалить папку «${folder.name}»? Заметки останутся, но будут перемещены в «Без папки».`,
    );

    if (!confirmed) {
      return;
    }

    const timestamp = nowIso();
    const linkedNotes = (await db.notes.toArray()).filter((note) => note.folderId === folder.id && !note.deletedAt);
    const updatedNotes: Note[] = linkedNotes.map((note) => ({
      ...note,
      folderId: null,
      updatedAt: timestamp,
      version: note.version + 1,
      syncState: note.syncState === "conflicted" ? "conflicted" : "queued",
    }));

    await db.transaction("rw", db.folders, db.notes, db.syncQueue, async () => {
      await db.folders.delete(folder.id);
      await db.syncQueue.put({
        id: `queue-folder-${folder.id}`,
        entity: "folder",
        operation: "delete",
        payload: {
          ...folder,
          updatedAt: timestamp,
        },
        createdAt: timestamp,
      });

      if (updatedNotes.length) {
        await db.notes.bulkPut(updatedNotes);
        await db.syncQueue.bulkPut(
          updatedNotes.map((note) => ({
            id: `queue-note-${note.id}`,
            entity: "note" as const,
            operation: "upsert" as const,
            payload: note,
            createdAt: note.updatedAt,
          })),
        );
      }
    });

    if (folderFilter === folder.id) {
      setFolderFilter("all");
    }

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

    if (syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;

    try {
      const syncStartedAt = nowIso();
      setSyncLabel("Синхронизирую с облаком…");
      await purgeLocalDemoState(true, true);
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
        await settleProcessedQueue(queue);
      }

      const snapshot = await pullSnapshot(supabase, session.user.id);
      const cleanedSnapshot = stripSeededDemoData(snapshot.notes, snapshot.folders);

      if (cleanedSnapshot.removedNoteIds.size) {
        await supabase.from("notes").delete().in("id", [...cleanedSnapshot.removedNoteIds]);
      }

      if (cleanedSnapshot.removedFolderIds.size) {
        await supabase.from("folders").delete().in("id", [...cleanedSnapshot.removedFolderIds]);
      }

      const [localNotesAfterSync, localFoldersAfterSync] = await Promise.all([
        db.notes.toArray(),
        db.folders.toArray(),
      ]);
      const dirtyNotes = localNotesAfterSync.filter(
        (note) => note.syncState !== "synced" && note.updatedAt > syncStartedAt,
      );
      const dirtyFolders = localFoldersAfterSync.filter((folder) => folder.updatedAt > syncStartedAt);

      const mergedFolders = new Map(localFoldersAfterSync.map((folder) => [folder.id, folder]));
      for (const folder of cleanedSnapshot.folders) {
        const local = mergedFolders.get(folder.id);
        if (!local || local.updatedAt <= folder.updatedAt) {
          mergedFolders.set(folder.id, folder);
        }
      }
      for (const folder of dirtyFolders) {
        mergedFolders.set(folder.id, folder);
      }

      const mergedNotes = new Map(localNotesAfterSync.map((note) => [note.id, note]));
      for (const note of cleanedSnapshot.notes) {
        const local = mergedNotes.get(note.id);
        if (!local || (local.syncState === "synced" && local.version <= note.version)) {
          mergedNotes.set(note.id, note);
        }
      }
      for (const note of dirtyNotes) {
        mergedNotes.set(note.id, note);
      }

      await db.transaction("rw", db.folders, db.notes, async () => {
        await db.folders.clear();
        await db.notes.clear();
        await db.folders.bulkPut([...mergedFolders.values()]);
        await db.notes.bulkPut([...mergedNotes.values()]);
      });
      await loadLocal();
      setSyncLabel("Синхронизировано");
    } catch (error) {
      setSyncLabel(error instanceof Error ? error.message : "Ошибка синхронизации");
    } finally {
      syncInFlightRef.current = false;
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
    const preferredFolderId =
      folderFilter !== "all" && folders.some((folder) => folder.id === folderFilter)
        ? folderFilter
        : folders[0]?.id ?? null;

    const note: Note = {
      id: makeId(),
      userId: session?.user.id ?? null,
      title: "Новая заметка",
      folderId: preferredFolderId,
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
    if (isCompactLayout) {
      setMobileView("editor");
    }
  }

  async function createFolder() {
    const suggestedName = `Папка ${folders.length + 1}`;
    const name = window.prompt("Название новой папки", suggestedName)?.trim();

    if (!name) {
      return;
    }

    const timestamp = nowIso();
    const folder: Folder = {
      id: makeId(),
      userId: session?.user.id ?? null,
      name,
      color: folderColors[folders.length % folderColors.length],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await upsertFolder(folder);
    setFolderFilter(folder.id);
    if (isCompactLayout) {
      setMobileView("library");
    }
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
      contentJson: appendImagesToDoc(note.contentJson, attachments),
      attachments: [...note.attachments, ...attachments],
    }));
  }

  async function removeAttachment(attachmentId: string) {
    if (!selectedNote) {
      return;
    }

    await mutateSelectedNote((note) => ({
      ...note,
      attachments: note.attachments.filter((attachment) => attachment.id !== attachmentId),
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

  async function clearReminder() {
    if (!selectedNote) {
      return;
    }

    await mutateSelectedNote((note) => ({
      ...note,
      reminders: [],
    }));
  }

  const selectedFolder = selectedNote ? folders.find((folder) => folder.id === selectedNote.folderId) ?? null : null;
  const selectedReminder = selectedNote?.reminders[0] ?? null;
  const archivedNotesCount = notes.filter((note) => note.isArchived && !note.deletedAt).length;

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
      <main className="safe-shell mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-8">
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
    <main className="safe-shell mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 px-3 py-3 pb-28 md:px-5 md:py-5 md:pb-5">
      <div className="glass-panel sticky top-[max(12px,env(safe-area-inset-top))] z-20 rounded-[30px] border border-white/10 px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="liquid-pill inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs uppercase tracking-[0.22em] text-white/72">
                <Sparkles className="h-3.5 w-3.5" />
                Liquid Notes
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-[-0.05em] text-white">
                  {selectedNote ? selectedNote.title : "Коллекция заметок"}
                </p>
                <p className="mt-1 text-sm text-white/54">
                  {selectedNote
                    ? `${selectedFolder?.name ?? "Без папки"} · обновлено ${formatUpdatedAt(selectedNote.updatedAt)}`
                    : "Local-first заметки с синхронизацией, push и установкой как PWA"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isCompactLayout && installPrompt ? (
                <button
                  type="button"
                  onClick={promptInstall}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/14 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white/14"
                >
                  <Smartphone className="h-4 w-4" />
                  Установить
                </button>
              ) : null}
              {!isCompactLayout ? (
                <button
                  type="button"
                  onClick={enableNotifications}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/78 transition hover:border-white/22 hover:bg-white/10 hover:text-white"
                >
                  <Bell className="h-4 w-4" />
                  Push
                </button>
              ) : null}
              {session ? (
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white/72 transition hover:border-white/22 hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Выйти
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
            <span className="liquid-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/72">
              <Archive className="h-4 w-4" />
              Архив: {archivedNotesCount}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className={cn("glass-panel rounded-[34px] border border-white/10 p-4", mobileView !== "library" && "hidden lg:block")}>
          <div className="mb-4 space-y-3">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-white/40">Liquid Notes</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-white">Ваши заметки</h1>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void createNote()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[22px] border border-white/14 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white/14"
              >
                <Plus className="h-4 w-4" />
                Новая заметка
              </button>
              <button
                type="button"
                onClick={() => void createFolder()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[22px] border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white/78 transition hover:border-white/22 hover:bg-white/10 hover:text-white"
              >
                <FolderPlus className="h-4 w-4" />
                Папка
              </button>
            </div>
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
            {folders.map((folder) => {
              const noteCount = notes.filter((note) => note.folderId === folder.id && !note.deletedAt).length;
              const active = folderFilter === folder.id;

              return (
                <div
                  key={folder.id}
                  className={cn(
                    "flex items-center gap-2 rounded-[22px] border px-2 py-2 transition",
                    active
                      ? "border-white/18 bg-white/14 text-white"
                      : "border-white/8 bg-white/4 text-white/68 hover:bg-white/8",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setFolderFilter(folder.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[18px] px-2 py-2 text-left"
                  >
                    <span className="inline-flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: folder.color }} />
                      <span className="truncate">{folder.name}</span>
                    </span>
                    <span className="text-sm text-white/48">{noteCount}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void renameFolder(folder)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/10 bg-white/6 text-white/62 transition hover:border-white/20 hover:bg-white/12 hover:text-white"
                    aria-label={`Переименовать папку ${folder.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteFolder(folder)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-rose-300/12 bg-rose-400/8 text-rose-100/78 transition hover:border-rose-300/20 hover:bg-rose-400/14 hover:text-rose-50"
                    aria-label={`Удалить папку ${folder.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
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
                    onClick={() => {
                      setSelectedNoteId(note.id);
                      if (isCompactLayout) {
                        setMobileView("editor");
                      }
                    }}
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
              {!visibleNotes.length ? (
                <div className="rounded-[28px] border border-dashed border-white/14 bg-white/5 px-5 py-8 text-center">
                  <p className="text-base font-medium text-white">Пока пусто</p>
                  <p className="mt-2 text-sm leading-6 text-white/56">
                    Создайте первую заметку или переключитесь на другую папку.
                  </p>
                  <button
                    type="button"
                    onClick={() => void createNote()}
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/14 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white/14"
                  >
                    <Plus className="h-4 w-4" />
                    Создать заметку
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className={cn("space-y-4", mobileView !== "editor" && "hidden lg:block")}>
          {selectedNote ? (
            <div className="glass-panel rounded-[30px] border border-white/10 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-white/56">
                    {isCompactLayout ? (
                      <button
                        type="button"
                        onClick={() => setMobileView("library")}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-white/72 transition hover:bg-white/10 hover:text-white"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        К списку
                      </button>
                    ) : null}
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                      <Clock3 className="h-4 w-4" />
                      {formatUpdatedAt(selectedNote.updatedAt)}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5">
                      <FileText className="h-4 w-4" />
                      {selectedFolder?.name ?? "Без папки"}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">{selectedNote.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-white/58">
                      {selectedNote.plainText
                        ? selectedNote.plainText.slice(0, 140)
                        : "Здесь можно быстро писать идеи, списки и напоминания."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void mutateSelectedNote((note) => ({
                        ...note,
                        isPinned: !note.isPinned,
                      }))
                    }
                    className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/7 px-4 py-2 text-sm font-medium text-white/74 transition hover:border-white/22 hover:bg-white/12 hover:text-white"
                  >
                    {selectedNote.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {selectedNote.isPinned ? "Открепить" : "Закрепить"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void mutateSelectedNote((note) => ({
                        ...note,
                        isArchived: !note.isArchived,
                      }))
                    }
                    className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/7 px-4 py-2 text-sm font-medium text-white/74 transition hover:border-white/22 hover:bg-white/12 hover:text-white"
                  >
                    <Archive className="h-4 w-4" />
                    {selectedNote.isArchived ? "Вернуть" : "В архив"}
                  </button>
                  {isCompactLayout ? (
                    <button
                      type="button"
                      onClick={() => setMobileView("details")}
                      className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/7 px-4 py-2 text-sm font-medium text-white/74 transition hover:border-white/22 hover:bg-white/12 hover:text-white"
                    >
                      <Settings2 className="h-4 w-4" />
                      Свойства
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

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
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm uppercase tracking-[0.24em] text-white/36">Изображения</p>
                <span className="text-sm text-white/48">{selectedNote.attachments.length}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectedNote.attachments.map((attachment) => (
                  <div key={attachment.id} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.sourceUrl} alt={attachment.name} className="h-44 w-full object-cover" />
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 text-sm text-white/62">
                        <p className="truncate">{attachment.name}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeAttachment(attachment.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-[14px] border border-rose-300/12 bg-rose-400/8 text-rose-100/80 transition hover:border-rose-300/20 hover:bg-rose-400/14 hover:text-rose-50"
                        aria-label={`Удалить изображение ${attachment.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className={cn("space-y-4", mobileView !== "details" && "hidden lg:block")}>
          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm uppercase tracking-[0.24em] text-white/36">Свойства</p>
              {isCompactLayout && selectedNote ? (
                <button
                  type="button"
                  onClick={() => setMobileView("editor")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-sm text-white/72 transition hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  К заметке
                </button>
              ) : null}
            </div>
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
                    placeholder="работа, идеи, личное"
                  />
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-white">
                      <Bell className="h-4 w-4" />
                      Напоминание
                    </div>
                    {selectedReminder ? (
                      <button
                        type="button"
                        onClick={() => void clearReminder()}
                        className="text-sm text-white/56 transition hover:text-white"
                      >
                        Очистить
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="datetime-local"
                    value={
                      selectedReminder?.fireAt
                        ? selectedReminder.fireAt.slice(0, 16)
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
                    value={selectedReminder?.repeatRule ?? "none"}
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
                  <div className="text-sm text-white/54">{formatReminder(selectedReminder ?? undefined)}</div>
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
              <p className="mt-4 text-sm leading-6 text-white/56">
                Выберите заметку, чтобы управлять тегами, папкой и напоминанием.
              </p>
            )}
          </div>

          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-white/36">Устройство</p>
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
                  <p>Откройте Share и выберите «На экран Домой», чтобы установить приложение.</p>
                ) : (
                  <p>PWA уже установлена или браузер сейчас не показывает install prompt.</p>
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
                  {notificationStatus === "granted" ? "Проверить push" : "Включить push"}
                </button>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-[34px] border border-white/10 p-5">
            <p className="text-sm uppercase tracking-[0.24em] text-white/36">Как это работает</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-white/64">
              <div className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/6 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-300" />
                Изменения сначала пишутся локально, поэтому редактор ощущается мгновенным даже без сети.
              </div>
              <div className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/6 p-4">
                <Archive className="mt-0.5 h-4 w-4 text-sky-300" />
                При появлении интернета заметки и папки синхронизируются между устройствами через облако.
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="glass-panel fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 grid grid-cols-3 gap-2 rounded-[26px] border border-white/10 p-2 lg:hidden">
        {[
          { view: "library" as const, label: "Заметки", icon: Home },
          { view: "editor" as const, label: "Редактор", icon: FileText },
          { view: "details" as const, label: "Свойства", icon: Settings2 },
        ].map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            onClick={() => setMobileView(view)}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2 rounded-[20px] px-3 py-3 text-sm font-medium transition",
              mobileView === view ? "bg-white/16 text-white" : "text-white/56",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </main>
  );
}
