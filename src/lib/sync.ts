import type { SupabaseClient } from "@supabase/supabase-js";

import type { Folder, LocalSnapshot, Note, SyncQueueItem } from "@/lib/types";

type RemoteFolderRow = {
  id: string;
  user_id: string | null;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type RemoteNoteRow = {
  id: string;
  user_id: string | null;
  folder_id: string | null;
  title: string;
  tags: string[] | null;
  content_json: Note["contentJson"];
  plain_text: string;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  last_synced_version: number;
};

type RemoteReminderRow = {
  id: string;
  note_id: string;
  fire_at_utc: string;
  timezone: string;
  repeat_rule: Note["reminders"][number]["repeatRule"];
  is_enabled: boolean;
  last_sent_at: string | null;
};

type RemoteAttachmentRow = {
  id: string;
  note_id: string;
  kind: "image";
  name: string;
  source_url: string;
  created_at: string;
};

export interface SyncConflict {
  note: Note;
}

export function isNote(entity: Folder | Note): entity is Note {
  return "contentJson" in entity;
}

function folderToRemote(folder: Folder, userId: string) {
  return {
    id: folder.id,
    user_id: userId,
    name: folder.name,
    color: folder.color,
    created_at: folder.createdAt,
    updated_at: folder.updatedAt,
  };
}

function noteToRemote(note: Note, userId: string) {
  return {
    id: note.id,
    user_id: userId,
    folder_id: note.folderId,
    title: note.title,
    tags: note.tags,
    content_json: note.contentJson,
    plain_text: note.plainText,
    is_pinned: note.isPinned,
    is_archived: note.isArchived,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: note.deletedAt ?? null,
    version: note.version,
    last_synced_version: note.lastSyncedVersion,
  };
}

export async function pullSnapshot(client: SupabaseClient, userId: string): Promise<LocalSnapshot> {
  const [foldersRes, notesRes, remindersRes, attachmentsRes] = await Promise.all([
    client.from("folders").select("*").eq("user_id", userId),
    client.from("notes").select("*").eq("user_id", userId),
    client.from("reminders").select("*").eq("user_id", userId),
    client.from("note_attachments").select("*").eq("user_id", userId),
  ]);

  if (foldersRes.error) throw foldersRes.error;
  if (notesRes.error) throw notesRes.error;
  if (remindersRes.error) throw remindersRes.error;
  if (attachmentsRes.error) throw attachmentsRes.error;

  const remindersByNote = new Map<string, Note["reminders"]>();
  for (const row of (remindersRes.data ?? []) as RemoteReminderRow[]) {
    const items = remindersByNote.get(row.note_id) ?? [];
    items.push({
      id: row.id,
      noteId: row.note_id,
      fireAt: row.fire_at_utc,
      timezone: row.timezone,
      repeatRule: row.repeat_rule,
      isEnabled: row.is_enabled,
      lastSentAt: row.last_sent_at,
    });
    remindersByNote.set(row.note_id, items);
  }

  const attachmentsByNote = new Map<string, Note["attachments"]>();
  for (const row of (attachmentsRes.data ?? []) as RemoteAttachmentRow[]) {
    const items = attachmentsByNote.get(row.note_id) ?? [];
    items.push({
      id: row.id,
      noteId: row.note_id,
      kind: row.kind,
      name: row.name,
      sourceUrl: row.source_url,
      createdAt: row.created_at,
    });
    attachmentsByNote.set(row.note_id, items);
  }

  return {
    folders: ((foldersRes.data ?? []) as RemoteFolderRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    notes: ((notesRes.data ?? []) as RemoteNoteRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      title: row.title,
      folderId: row.folder_id,
      tags: row.tags ?? [],
      contentJson: row.content_json,
      plainText: row.plain_text,
      isPinned: row.is_pinned,
      isArchived: row.is_archived,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      version: row.version,
      lastSyncedVersion: row.last_synced_version,
      syncState: "synced",
      reminders: remindersByNote.get(row.id) ?? [],
      attachments: attachmentsByNote.get(row.id) ?? [],
    })),
  };
}

export async function flushQueue(
  client: SupabaseClient,
  userId: string,
  queue: SyncQueueItem[],
) {
  const conflicts: SyncConflict[] = [];

  for (const item of queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (item.entity === "folder" && !isNote(item.payload)) {
      const folder = item.payload as Folder;
      const { error } = await client.from("folders").upsert(folderToRemote(folder, userId));
      if (error) throw error;
      continue;
    }

    if (item.entity === "note" && isNote(item.payload)) {
      const note = item.payload;

      const remoteVersionRes = await client
        .from("notes")
        .select("version")
        .eq("id", note.id)
        .maybeSingle();

      if (remoteVersionRes.error) {
        throw remoteVersionRes.error;
      }

      const remoteVersion = remoteVersionRes.data?.version ?? 0;
      if (remoteVersion > note.lastSyncedVersion) {
        conflicts.push({ note });
        continue;
      }

      const { error: noteError } = await client.from("notes").upsert(noteToRemote(note, userId));
      if (noteError) throw noteError;

      const { error: deleteAttachmentError } = await client
        .from("note_attachments")
        .delete()
        .eq("note_id", note.id)
        .eq("user_id", userId);
      if (deleteAttachmentError) throw deleteAttachmentError;

      const { error: deleteReminderError } = await client
        .from("reminders")
        .delete()
        .eq("note_id", note.id)
        .eq("user_id", userId);
      if (deleteReminderError) throw deleteReminderError;

      if (!note.deletedAt) {
        if (note.attachments.length) {
          const { error: attachmentError } = await client.from("note_attachments").insert(
            note.attachments.map((attachment) => ({
              id: attachment.id,
              note_id: note.id,
              user_id: userId,
              kind: attachment.kind,
              name: attachment.name,
              source_url: attachment.sourceUrl,
              created_at: attachment.createdAt,
            })),
          );
          if (attachmentError) throw attachmentError;
        }

        if (note.reminders.length) {
          const { error: reminderError } = await client.from("reminders").insert(
            note.reminders.map((reminder) => ({
              id: reminder.id,
              note_id: note.id,
              user_id: userId,
              fire_at_utc: reminder.fireAt,
              timezone: reminder.timezone,
              repeat_rule: reminder.repeatRule,
              is_enabled: reminder.isEnabled,
              last_sent_at: reminder.lastSentAt ?? null,
            })),
          );
          if (reminderError) throw reminderError;
        }
      }
    }
  }

  return { conflicts };
}
