import Dexie, { type Table } from "dexie";

import type { Folder, Note, PushSubscriptionRecord, SyncQueueItem } from "@/lib/types";

class NotesDatabase extends Dexie {
  notes!: Table<Note, string>;
  folders!: Table<Folder, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  subscriptions!: Table<PushSubscriptionRecord, string>;

  constructor() {
    super("liquid-notes-db");

    this.version(1).stores({
      notes: "id, updatedAt, folderId, isPinned, isArchived, syncState",
      folders: "id, updatedAt",
      syncQueue: "id, entity, operation, createdAt",
      subscriptions: "id, userId, endpoint",
    });
  }
}

export const db = new NotesDatabase();
