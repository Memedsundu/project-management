"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { act, UserError } from "@/server/action";
import type { Citation } from "@/server/db/schema";
import { ENTITY_TYPES, type EntityRef } from "@/server/entities";
import {
  addToCollection,
  cleanSmartFilter,
  collectionInputSchema,
  createCollection,
  removeFromCollection,
  runSmartFilter,
  smartFilterSchema,
  updateCollection,
} from "@/server/services/collections";

const uuid = z.string().uuid();
const refSchema = z.object({ type: z.enum(ENTITY_TYPES), id: uuid });
const refsSchema = z.array(refSchema).max(300);

export async function createCollectionAction(raw: z.input<typeof collectionInputSchema>, items: EntityRef[] = []) {
  return act(async () => {
    const row = await createCollection(raw, refsSchema.parse(items).filter((r) => r.type !== "collection"));
    return { id: row.id };
  });
}

export async function updateCollectionAction(id: string, raw: Partial<z.input<typeof collectionInputSchema>>) {
  return act(async () => {
    const row = await updateCollection(uuid.parse(id), raw);
    if (!row) throw new UserError("Koleksiyon bulunamadı.");
    return null;
  });
}

export async function addToCollectionAction(id: string, items: EntityRef[]) {
  return act(async () => {
    const list = refsSchema.parse(items).filter((r) => r.type !== "collection");
    await addToCollection(uuid.parse(id), list);
    return { count: list.length };
  });
}

export async function removeFromCollectionAction(id: string, item: EntityRef) {
  return act(async () => {
    await removeFromCollection(uuid.parse(id), refSchema.parse(item));
    return null;
  });
}

/** The live count under the smart-filter fields (Paperless saved views). */
export async function previewSmartFilterAction(raw: z.input<typeof smartFilterSchema>) {
  return act(
    async () => {
      const clean = cleanSmartFilter(smartFilterSchema.parse(raw));
      if (!clean) return { count: 0, sample: [] };
      const hits = await runSmartFilter(clean, 100);
      return { count: hits.length, sample: hits.slice(0, 4).map((h) => ({ type: h.type, id: h.id, title: h.title })) };
    },
    { write: false },
  );
}

/** A question answered only from the collection (or the sources she ticked); kept in its chat. */
export async function askCollectionAction(id: string, question: string, refs?: EntityRef[]) {
  return act(
    async () => {
      const { askCollection } = await import("@/server/ai/collections");
      return askCollection(uuid.parse(id), z.string().trim().min(3).max(1000).parse(question), refs ? refsSchema.parse(refs) : undefined);
    },
    { write: false },
  );
}

const kindSchema = z.enum(["brief", "talking_points", "slide_outline", "partner_email", "section"]);

/** NotebookLM Studio: a draft written from the collection with citations. */
export async function generateOutputAction(id: string, input: { kind: string; focus?: string | null; language: string; refs?: EntityRef[] }) {
  return act(async () => {
    const { generateStudioOutput } = await import("@/server/ai/collections");
    return generateStudioOutput(uuid.parse(id), {
      kind: kindSchema.parse(input.kind),
      focus: z.string().max(600).nullish().parse(input.focus),
      language: z.enum(["tr", "en"]).parse(input.language),
      refs: input.refs ? refsSchema.parse(input.refs) : undefined,
    });
  });
}

export async function deleteOutputAction(id: string) {
  return act(async () => {
    const { deleteStudioOutput } = await import("@/server/ai/collections");
    await deleteStudioOutput(uuid.parse(id));
    return null;
  });
}

/** The text with its numbered sources underneath, as Markdown for a note. */
function noteMarkdown(text: string, citations: Citation[], locale: string) {
  if (!citations.length) return text;
  const page = locale === "en" ? "p." : "s.";
  const lines = citations.map((c) => `${c.n}. [${c.title.replace(/[[\]]/g, "")}](${c.href ?? "#"})${c.page ? `, ${page} ${c.page}` : ""}${c.quote ? `: “${c.quote.slice(0, 240)}”` : ""}`);
  return `${text}\n\n## ${locale === "en" ? "Sources" : "Kaynaklar"}\n\n${lines.join("\n")}`;
}

async function saveNote(collectionId: string, title: string, text: string, citations: Citation[]) {
  const { createNote } = await import("@/server/services/notes");
  const sources = citations.flatMap((c) => (c.sourceId && (ENTITY_TYPES as readonly string[]).includes(c.sourceType) ? [{ type: c.sourceType, id: c.sourceId } as EntityRef] : []));
  const note = await createNote({
    title: title.slice(0, 200),
    markdown: noteMarkdown(text, citations, await getLocale()),
    links: [{ type: "collection", id: collectionId }, ...sources.filter((s, i) => sources.findIndex((x) => x.type === s.type && x.id === s.id) === i)],
  });
  return { id: note.id };
}

/** "Not olarak kaydet" on a Studio output: a normal note she can edit, linked to the collection and its sources. */
export async function saveOutputAsNoteAction(id: string, title?: string) {
  return act(async () => {
    const { getStudioOutput } = await import("@/server/ai/collections");
    const out = await getStudioOutput(uuid.parse(id));
    if (!out) throw new UserError("Çıktı bulunamadı.");
    return saveNote(out.scopeId, z.string().trim().min(1).max(200).catch(out.title).parse(title), out.content, out.citations);
  });
}

/** "Not olarak kaydet" on a chat answer. */
export async function saveAnswerAsNoteAction(threadId: string) {
  return act(async () => {
    const { getAskThread } = await import("@/server/ai/ask");
    const thread = await getAskThread(uuid.parse(threadId));
    if (!thread || thread.scopeType !== "collection" || !thread.scopeId) throw new UserError("Yanıt bulunamadı.");
    return saveNote(thread.scopeId, thread.question, thread.answer, thread.citations);
  });
}
