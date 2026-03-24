import type { JSONContent } from "@tiptap/react";

export type ReminderRepeat = "none" | "daily" | "weekly";
export type SyncState = "synced" | "queued" | "conflicted";

export interface Folder {
  id: string;
  userId?: string | null;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  kind: "image";
  name: string;
  sourceUrl: string;
  createdAt: string;
}

export interface Reminder {
  id: string;
  noteId: string;
  fireAt: string;
  timezone: string;
  repeatRule: ReminderRepeat;
  isEnabled: boolean;
  lastSentAt?: string | null;
}

export interface Note {
  id: string;
  userId?: string | null;
  title: string;
  folderId: string | null;
  tags: string[];
  contentJson: JSONContent;
  plainText: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  version: number;
  lastSyncedVersion: number;
  syncState: SyncState;
  attachments: NoteAttachment[];
  reminders: Reminder[];
}

export interface PushSubscriptionRecord {
  id: string;
  userId?: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceName: string;
  userAgent?: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface SyncQueueItem {
  id: string;
  entity: "note" | "folder";
  operation: "upsert" | "delete";
  payload: Note | Folder;
  createdAt: string;
}

export interface LocalSnapshot {
  notes: Note[];
  folders: Folder[];
}
