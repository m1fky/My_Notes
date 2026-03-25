"use client";

import { useEffect, useRef, useState } from "react";
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
  onAddImages: (
    files: FileList | null,
  ) => Promise<Array<{ name: string; sourceUrl: string }> | null | undefined>;
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
  const imageInsertSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [isLinkPanelOpen, setIsLinkPanelOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");

  async function handleImagePick(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const attachments = await onAddImages(files);

    if (editor && attachments?.length) {
      const selection = imageInsertSelectionRef.current;
      const chain = editor.chain().focus();

      if (selection) {
        chain.setTextSelection(selection);
      }

      chain
        .insertContent(
          attachments.flatMap((attachment) => [
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
        )
        .run();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    imageInsertSelectionRef.current = null;
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
      const nextContent = JSON.stringify(note.contentJson ?? emptyDoc());
      const currentContent = JSON.stringify(editor.getJSON());

      if (currentContent !== nextContent) {
        editor.commands.setContent(note.contentJson ?? emptyDoc(), {
          emitUpdate: false,
        });
      }
    }
  }, [editor, note]);

  function openLinkPanel() {
    if (!editor) {
      return;
    }

    setLinkDraft(String(editor.getAttributes("link").href ?? ""));
    setIsLinkPanelOpen(true);
  }

  function applyLink() {
    if (!editor) {
      return;
    }

    const value = linkDraft.trim();
    if (!value) {
      editor.chain().focus().unsetLink().run();
      setIsLinkPanelOpen(false);
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
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedValue }).run();
    }

    setIsLinkPanelOpen(false);
  }

  if (!note) {
    return (
      <div className="glass-panel flex min-h-[420px] items-center justify-center rounded-[32px] border border-white/10 px-6 text-center text-white/56">
        Выберите заметку слева или создайте новую.
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-[32px] border border-white/10 p-5 md:p-7">
      <div className="mb-5 rounded-[26px] border border-white/10 bg-white/6 p-3 md:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/38">Редактор</p>
            <p className="mt-1 text-sm text-white/64">Форматирование, ссылки и изображения прямо внутри заметки</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (editor) {
                imageInsertSelectionRef.current = {
                  from: editor.state.selection.from,
                  to: editor.state.selection.to,
                };
              }
              fileInputRef.current?.click();
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] border border-white/12 bg-white/9 px-4 py-2 text-sm font-medium text-white transition hover:border-white/24 hover:bg-white/14"
          >
            <ImagePlus className="h-4 w-4" />
            Вставить фото
          </button>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <ToolbarButton
              active={editor?.isActive("paragraph")}
              label="Текст"
              onClick={() => editor?.chain().focus().setParagraph().run()}
            >
              <Pilcrow className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor?.isActive("heading", { level: 1 })}
              label="Заголовок"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <Heading1 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor?.isActive("heading", { level: 2 })}
              label="Подзаголовок"
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
          </div>
          <div className="flex flex-wrap gap-2">
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
              active={editor?.isActive("link") || isLinkPanelOpen}
              label={editor?.isActive("link") ? "Изменить ссылку" : "Ссылка"}
              onClick={() => {
                if (!editor) {
                  return;
                }

                if (editor.isActive("link")) {
                  openLinkPanel();
                  return;
                }

                setLinkDraft("");
                setIsLinkPanelOpen(true);
              }}
            >
              <Link2 className="h-4 w-4" />
            </ToolbarButton>
          </div>
          {isLinkPanelOpen ? (
            <div className="rounded-[22px] border border-white/10 bg-white/6 p-3">
              <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-white/40">Ссылка</label>
              <input
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setIsLinkPanelOpen(false);
                  }
                }}
                autoFocus
                placeholder="example.com или https://example.com"
                className="w-full rounded-[18px] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none placeholder:text-white/28"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white/50">
                  Выделите текст, чтобы повесить ссылку на него. Без выделения будет вставлен URL.
                </p>
                <div className="flex items-center gap-2">
                  {editor?.isActive("link") ? (
                    <button
                      type="button"
                      onClick={() => {
                        editor.chain().focus().unsetLink().run();
                        setIsLinkPanelOpen(false);
                      }}
                      className="inline-flex rounded-[16px] border border-rose-300/18 bg-rose-400/12 px-3 py-2 text-sm text-rose-50 transition hover:bg-rose-400/18"
                    >
                      Убрать
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setIsLinkPanelOpen(false)}
                    className="inline-flex rounded-[16px] border border-white/10 bg-white/8 px-3 py-2 text-sm text-white/72 transition hover:bg-white/12 hover:text-white"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={applyLink}
                    className="inline-flex rounded-[16px] border border-sky-300/20 bg-sky-300/16 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-300/22"
                  >
                    Применить
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-white/50">
              Быстрый совет: выделите фрагмент и нажмите «Ссылка», чтобы превратить его в tappable ссылку.
            </p>
          )}
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

      <div className="mb-4 space-y-2">
        <p className="text-xs uppercase tracking-[0.22em] text-white/38">Название</p>
        <input
          value={note.title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="w-full rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-3xl font-semibold tracking-[-0.03em] text-white outline-none placeholder:text-white/30"
          placeholder="Новая заметка"
        />
      </div>

      <div className="rounded-[26px] border border-white/10 bg-white/4 p-4 md:p-5">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
