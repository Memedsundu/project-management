import "server-only";
import { UserError } from "@/server/action";
import { checkForChildData } from "@/server/files/child-guard";
import { aiText, asMaterial } from "./client";
import { projectMemoryText } from "./memory";

/**
 * Notion AI's writing tools on a selection: shorten, clarify, make formal,
 * turn into bullets, continue, translate. The answer is only shown to her;
 * she decides whether it replaces the text or goes below it.
 */
export const WRITING_OPS = ["shorten", "clarify", "formal", "bullets", "continue", "translate", "custom"] as const;
export type WritingOp = (typeof WRITING_OPS)[number];

const INSTRUCTIONS: Record<Exclude<WritingOp, "custom" | "translate">, string> = {
  shorten: "Make the text shorter, keeping every fact, number, date and name. Aim for about half the length.",
  clarify: "Rewrite the text so it is clear and easy to read. Keep every fact. Fix grammar and spelling.",
  formal: "Rewrite the text in a formal, professional register suitable for a donor report or an official letter. In Turkish, use the formal 'siz' form and avoid colloquial words. Keep every fact.",
  bullets: "Turn the text into a concise bullet list in Markdown ('- ' at the start of each line). One idea per bullet. Keep every fact.",
  continue: "Continue the text with one or two paragraphs in the same voice and language. Only use facts that are in the text or the project memory; never invent numbers, names or dates.",
};

export async function runWritingTool(input: { op: WritingOp; text: string; context?: string; target?: "tr" | "en" | null; prompt?: string | null; entity?: { type: string; id: string } | null }) {
  const text = input.text.trim();
  if (!text) throw new UserError("Önce bir metin seç.");
  // Personal data about a child never leaves the workspace.
  const guard = checkForChildData({ text });
  if (guard.flag) throw new UserError("Bu metinde bir çocuğa ait kişisel bilgi olabilir; yapay zekâya gönderilmedi.");

  let task: string;
  if (input.op === "translate") {
    const target = input.target ?? (looksTurkish(text) ? "en" : "tr");
    task =
      target === "en"
        ? "Translate the text into British English for a donor audience. Use the glossary terms exactly. Keep Markdown formatting."
        : "Translate the text into Turkish in a natural, professional register. Use the glossary terms exactly. Keep Markdown formatting.";
  } else if (input.op === "custom") {
    const p = (input.prompt ?? "").trim();
    if (!p) throw new UserError("Ne yapmamı istediğini yaz.");
    task = `Do this with the text: ${p.slice(0, 500)}`;
  } else {
    task = INSTRUCTIONS[input.op];
  }

  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const { text: out } = await aiText({
    helper: "writing",
    effort: "low",
    thinking: "light",
    maxTokens: 3000,
    entity: input.entity ?? null,
    system: [
      memory,
      "You are a writing tool inside her notes. Answer with the rewritten text only: no preface, no quotes around it, no explanation. Keep the language of the original unless asked to translate. Keep @-style names and numbers exactly as written.",
      `Task: ${task}`,
    ].join("\n\n"),
    messages: [
      {
        role: "user",
        content: [
          input.context ? asMaterial("note", { part: "surrounding page, for context only" }, input.context.slice(0, 6000)) : "",
          asMaterial("note", { part: "selected text to work on" }, text.slice(0, 20000)),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });
  return out.trim();
}

function looksTurkish(text: string) {
  const sample = text.slice(0, 2000).toLowerCase();
  const tr = (sample.match(/[çğıöşü]/g) ?? []).length + (sample.match(/\b(ve|bir|bu|için|ile|olarak|da|de)\b/g) ?? []).length;
  const en = (sample.match(/\b(the|and|of|to|for|with|is|are)\b/g) ?? []).length;
  return tr >= en;
}
