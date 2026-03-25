"use client";

import { useEffect, useRef } from "react";
import Link from "@tiptap/extension-link";
import { EditorContent, JSONContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import {
  Bold,
  Heading1,
  Heading2,
  ImagePlus,
  Link2,
  List,
  ListChecks,
  Pilcrow,
  TextQuote,
} from "lucide-react";

import { emptyDoc, extractPlainText } from "@/lib/editor";
import type { Note } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NoteEditorProps {
  note: Note | null;
  onTitleChange: (title: string) => void;
  onContentChange: (content: JSONContent, plainText: string) => void;
  onAddImages: (files: FileList | null) => Promise<void>;
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 items-center gap-2 rounded-[20px] border border-white/12 bg-white/7 px-4 py-3 text-sm font-medium text-white/80 transition hover:scale-[1.02] hover:border-white/24 hover:bg-white/12 hover:text-white",
        active && "border-sky-300/30 bg-sky-300/18 text-white shadow-[0_0_0_1px_rgba(125,211,252,0.12)]",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function NoteEditor({
  note,
  onTitleChange,
  onContentChange,
  onAddImages,
}: NoteEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImagePick(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    await onAddImages(files);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        autolink: true,
        defaultProtocol: "https",
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: "Запишите мысль, список дел или план на день...",
      }),
      Image,
      TaskList,
      TaskItem.configure({
        nested: false,
      }),
    ],
    content: note?.contentJson ?? emptyDoc(),
    editorProps: {
      attributes: {
        class: "prose-note",
      },
    },
    onUpdate({ editor: currentEditor }) {
      const json = currentEditor.getJSON();
      onContentChange(json, extractPlainText(json));
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor && note) {
      editor.commands.setContent(note.contentJson ?? emptyDoc(), {
        emitUpdate: false,
      });
    }
  }, [editor, note]);

  if (!note) {
    return (
      <div className="glass-panel flex min-h-[420px] items-center justify-center rounded-[32px] border border-white/10 px-6 text-center text-white/56">
        Выберите заметку слева или создайте новую.
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-[32px] border border-white/10 p-5 md:p-7">
      <div className="mb-5 rounded-[26px] border border-white/10 bg-white/6 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">Редактор</p>
            <p className="mt-1 text-sm text-white/64">Форматирование и быстрые действия</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/9 px-4 py-2 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white/14"
          >
            <ImagePlus className="h-4 w-4" />
            Вставить фото
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToolbarButton
            active={editor?.isActive("paragraph")}
            label="Текст"
            onClick={() => editor?.chain().focus().setParagraph().run()}
          >
            <Pilcrow className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("heading", { level: 1 })}
            label="H1"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("heading", { level: 2 })}
            label="H2"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("bold")}
            label="Жирный"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("bulletList")}
            label="Список"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("taskList")}
            label="Чеклист"
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          >
            <ListChecks className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("blockquote")}
            label="Цитата"
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <TextQuote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("link")}
            label={editor?.isActive("link") ? "Убрать ссылку" : "Ссылка"}
            onClick={() => {
              if (!editor) {
                return;
              }

              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
                return;
              }

              const value = window.prompt("Вставьте URL");
              if (!value) {
                return;
              }

              const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
              const selectionEmpty = editor.state.selection.empty;

              if (selectionEmpty) {
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: normalizedValue,
                    marks: [{ type: "link", attrs: { href: normalizedValue } }],
                  })
                  .run();
                return;
              }

              editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedValue }).run();
            }}
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void handleImagePick(event.target.files)}
        />
      </div>

      <input
        value={note.title}
        onChange={(event) => onTitleChange(event.target.value)}
        className="mb-4 w-full rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-3xl font-semibold tracking-[-0.03em] text-white outline-none placeholder:text-white/30"
        placeholder="Новая заметка"
      />

      <div className="rounded-[26px] border border-white/10 bg-white/4 p-4 md:p-5">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
