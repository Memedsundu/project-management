"use server";

import { z } from "zod";
import { act } from "@/server/action";
import { deleteConversation, getConversation, listConversations } from "@/server/ai/assistant";
import { deleteGlossaryTerm, glossaryInputSchema, listGlossary, saveGlossaryTerm } from "@/server/services/glossary";
import { getMemoryNote } from "@/server/services/notes";

/** Recent chats for the panel's history menu. */
export async function listConversationsAction() {
  return act(async () => listConversations(30), { write: false });
}

export async function getConversationAction(id: string) {
  return act(async () => getConversation(z.string().uuid().parse(id)), { write: false });
}

/** A chat is the assistant's scratch paper, so it can go even in an archived project. */
export async function deleteConversationAction(id: string) {
  return act(
    async () => {
      await deleteConversation(z.string().uuid().parse(id));
      return null;
    },
    { write: false },
  );
}

/** "Hafıza": her memory page (first lines) and the glossary. */
export async function loadMemoryAction() {
  return act(
    async () => {
      const [note, glossary] = await Promise.all([getMemoryNote(), listGlossary()]);
      return {
        noteId: note.id,
        preview: note.plainText
          .split("\n")
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s+/, "").trim())
          .filter(Boolean)
          .slice(0, 6),
        aiOff: note.aiOff,
        glossary,
      };
    },
    { write: false },
  );
}

export async function saveGlossaryTermAction(input: z.input<typeof glossaryInputSchema>) {
  return act(async () => saveGlossaryTerm(input), { refresh: false });
}

export async function deleteGlossaryTermAction(id: string) {
  return act(
    async () => {
      await deleteGlossaryTerm(z.string().uuid().parse(id));
      return null;
    },
    { refresh: false },
  );
}
