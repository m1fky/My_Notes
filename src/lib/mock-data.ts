import { emptyDoc } from "@/lib/editor";
import type { Folder, Note } from "@/lib/types";

const now = new Date().toISOString();

const demoFolderInboxId = "f3e7c4d2-6fd8-4c54-9a55-54e7bf8a8d21";
const demoFolderFocusId = "c961f5db-3772-4496-8fbc-787a263d95bd";
const demoWelcomeId = "f4e5fe2f-0fde-4c4b-b4ec-34a11f716b31";
const demoIdeasId = "77170129-4d12-4781-8cc7-cfd4542ad83d";

export const demoFolders: Folder[] = [
  {
    id: demoFolderInboxId,
    name: "Inbox",
    color: "#7dd3fc",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: demoFolderFocusId,
    name: "Focus",
    color: "#f9a8d4",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoNotes: Note[] = [
  {
    id: demoWelcomeId,
    title: "Добро пожаловать в Liquid Notes",
    folderId: demoFolderInboxId,
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
    id: demoIdeasId,
    title: "Идеи для следующей версии",
    folderId: demoFolderFocusId,
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
