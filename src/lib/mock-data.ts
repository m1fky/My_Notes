import { emptyDoc } from "@/lib/editor";
import type { Folder, Note } from "@/lib/types";

const now = new Date().toISOString();

export const demoFolders: Folder[] = [
  {
    id: "folder-inbox",
    name: "Inbox",
    color: "#7dd3fc",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "folder-focus",
    name: "Focus",
    color: "#f9a8d4",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoNotes: Note[] = [
  {
    id: "note-welcome",
    title: "Добро пожаловать в Liquid Notes",
    folderId: "folder-inbox",
    tags: ["pwa", "demo"],
    contentJson: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "PWA, которая ощущается как приложение" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Эта демо-заметка уже доступна оффлайн. Подключите Supabase env, чтобы включить аккаунты, sync между устройствами и push напоминания.",
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Установить PWA на главный экран" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Включить Supabase и push" }] }],
            },
          ],
        },
      ],
    },
    plainText: "Добро пожаловать в Liquid Notes PWA, которая ощущается как приложение. Установить PWA на главный экран. Включить Supabase и push.",
    isPinned: true,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
    lastSyncedVersion: 0,
    syncState: "queued",
    attachments: [],
    reminders: [],
  },
  {
    id: "note-ideas",
    title: "Идеи для следующей версии",
    folderId: "folder-focus",
    tags: ["roadmap"],
    contentJson: emptyDoc(),
    plainText: "Идеи для следующей версии",
    isPinned: false,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
    lastSyncedVersion: 0,
    syncState: "queued",
    attachments: [],
    reminders: [],
  },
];
