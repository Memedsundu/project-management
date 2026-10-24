import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { aiText } from "./client";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Read the text of a scan or photo with Claude (Haiku). Pages come back marked "=== page N ===". */
export async function ocrWithClaude(buf: Buffer, mime: string, documentId: string) {
  let block: Anthropic.ContentBlockParam;
  if (mime === "application/pdf") {
    if (buf.length > 30 * 1024 * 1024) return null;
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
  } else if (IMAGE_TYPES.has(mime)) {
    if (buf.length > 5 * 1024 * 1024) return null;
    block = { type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } };
  } else return null;
  const { text } = await aiText({
    helper: "ocr",
    maxTokens: 16000,
    thinking: "light",
    entity: { type: "document", id: documentId },
    system:
      "Transcribe every word in the attached file exactly, in its original language. Keep tables as rows with ' | ' between cells. Start each page with a line '=== page N ==='. Do not summarise, translate or comment. If a part is unreadable write [okunamadı].",
    messages: [{ role: "user", content: [block, { type: "text", text: "Transcribe this file." }] }],
  });
  const pages: { page: number | null; text: string }[] = [];
  const parts = text.split(/^=== page (\d+) ===\s*$/m);
  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: (parts[i + 1] ?? "").trim() });
  } else if (text.trim()) pages.push({ page: 1, text: text.trim() });
  return pages.filter((p) => p.text);
}
