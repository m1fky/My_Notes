"use client";

import { useEffect, useRef } from "react";
import { EditorContent, JSONContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { ImagePlus, Link2, List, ListChecks, Pilcrow, Quote, TextQuote } from "lucide-react";

import { emptyDoc, extractPlainText } from "@/lib/editor";
import type { Note } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NoteEditorProps {
  note: Note | null;
  onTitleChange: (title: string) => void;
  onContentChange: (content: JSONContent, plainText: string) => void;
  onAddImages: (files: FileList | null) => void;
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
        "liquid-pill inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white/80 transition hover:scale-[1.03] hover:text-white",
        active && "bg-white/16 text-white",
      )}
    >
      {children}
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: "Запишите мысль, список дел или план на день...",
      }),
      Underline,
      Link.configure({
        openOnClick: true,
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
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <ToolbarButton label="Параграф" onClick={() => editor?.chain().focus().setParagraph().run()}>
          <Pilcrow className="h-4 w-4" />
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
          label="Ссылка"
          onClick={() => {
            const value = window.prompt("Вставьте URL");
            if (value) {
              editor?.chain().focus().setLink({ href: value }).run();
            }
          }}
        >
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Изображение" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor?.isActive("blockquote")}
          label="Цитата"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => onAddImages(event.target.files)}
        />
      </div>

      <input
        value={note.title}
        onChange={(event) => onTitleChange(event.target.value)}
        className="mb-4 w-full bg-transparent text-3xl font-semibold tracking-[-0.03em] text-white outline-none placeholder:text-white/30"
        placeholder="Новая заметка"
      />

      <EditorContent editor={editor} />
    </div>
  );
}
