import type { JSONContent } from "@tiptap/react";

export const emptyDoc = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
});

export function extractPlainText(node?: JSONContent): string {
  if (!node) {
    return "";
  }

  const ownText = typeof node.text === "string" ? node.text : "";
  const childText = (node.content ?? []).map(extractPlainText).join(" ");

  return [ownText, childText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
