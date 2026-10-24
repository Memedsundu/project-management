"use server";

import { z } from "zod";
import { act, UserError } from "@/server/action";
import { blocksToMarkdown, type Block } from "@/lib/blocks";
import { addLink } from "@/server/services/links";
import {
  createNote,
  getNote,
  duplicateNote,
  getNoteVersion,
  getOrCreateDailyNote,
  listNoteVersions,
  noteInputSchema,
  notePatchSchema,
  restoreNoteVersion,
  updateNote,
  type NoteInput,
  type NotePatch,
} from "@/server/services/notes";

export async function createNoteAction(input: NoteInput) {
  return act(async () => {
    const note = await createNote(noteInputSchema.parse(input));
    return { id: note.id };
  });
}

/** Quick add "Not": the first line is the title, the rest the body. It waits in Gelen kutusu. */
export async function createInboxNoteAction(text: string, link?: { type: string; id: string } | null) {
  return act(async () => {
    const body = z.string().trim().min(1).max(100_000).parse(text);
    const [first, ...rest] = body.split(/\r?\n/);
    const note = await createNote({
      title: (first ?? "").slice(0, 200),
      markdown: rest.join("\n").trim(),
      inbox: !link,
      links: link ? [link] : undefined,
    });
    return { id: note.id };
  });
}

/** Autosave from the editor. No screen refresh: the editor already shows the change. */
export async function saveNoteAction(id: string, patch: NotePatch) {
  return act(
    async () => {
      const row = await updateNote(z.string().uuid().parse(id), notePatchSchema.parse(patch));
      return { updatedAt: row?.updatedAt.toISOString() ?? null };
    },
    { refresh: false },
  );
}

/** Changes that the rest of the screen shows (title in the tree, icon, move, pin). */
export async function updateNoteAction(id: string, patch: NotePatch) {
  return act(async () => {
    await updateNote(z.string().uuid().parse(id), notePatchSchema.parse(patch));
    return null;
  });
}

export async function duplicateNoteAction(id: string) {
  return act(async () => {
    const row = await duplicateNote(z.string().uuid().parse(id));
    return { id: row?.id ?? null };
  });
}

export async function dailyNoteAction(day?: string) {
  return act(async () => {
    const note = await getOrCreateDailyNote(day ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day) : undefined);
    return { id: note.id };
  });
}

export async function noteVersionsAction(id: string) {
  return act(
    async () => {
      const rows = await listNoteVersions(z.string().uuid().parse(id));
      return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString(), createdBy: r.createdBy }));
    },
    { write: false },
  );
}

export async function noteVersionAction(versionId: string) {
  return act(
    async () => {
      const v = await getNoteVersion(z.string().uuid().parse(versionId));
      return v ? { id: v.id, title: v.title, content: v.content as Block[], createdAt: v.createdAt.toISOString() } : null;
    },
    { write: false },
  );
}

export async function restoreNoteVersionAction(noteId: string, versionId: string) {
  return act(async () => {
    const row = await restoreNoteVersion(z.string().uuid().parse(noteId), z.string().uuid().parse(versionId));
    if (!row) throw new UserError("Bu sürüm bulunamadı.");
    // The editor remounts with the restored blocks.
    return { title: row.title, content: row.content as Block[] };
  });
}

/** A new page, optionally from a template and under a parent page. */
export async function createPageAction(input: { title?: string; parentId?: string | null; templateId?: string | null }) {
  return act(async () => {
    const parsed = z
      .object({ title: z.string().max(300).optional(), parentId: z.string().uuid().nullish(), templateId: z.string().max(80).nullish() })
      .parse(input);
    let markdown: string | undefined;
    if (parsed.templateId) {
      const { getTemplate } = await import("@/server/services/templates");
      markdown = (await getTemplate(parsed.templateId))?.markdown;
    }
    const note = await createNote({ title: parsed.title ?? "", parentId: parsed.parentId ?? null, markdown });
    return { id: note.id, title: note.title };
  });
}

/** "Şablon olarak kaydet": the page body becomes one of her note templates. */
export async function saveNoteAsTemplateAction(id: string, name: string) {
  return act(async () => {
    const note = await getNote(z.string().uuid().parse(id));
    if (!note) throw new UserError("Sayfa bulunamadı.");
    const { saveTemplate } = await import("@/server/services/templates");
    const tpl = await saveTemplate({ kind: "note", name: z.string().trim().min(1).max(120).parse(name), content: { markdown: blocksToMarkdown(note.content as Block[]) } });
    return { id: tpl.id };
  });
}

/** Images and files dropped into a page are stored in Belgeler and linked to the page. */
export async function attachToNoteAction(noteId: string, documentId: string) {
  return act(
    async () => {
      await addLink({ type: "note", id: z.string().uuid().parse(noteId) }, { type: "document", id: z.string().uuid().parse(documentId) }, "attachment");
      return null;
    },
    { refresh: false },
  );
}

/** Notion AI on a selection. The answer is shown to her first; nothing changes on its own. */
export async function writingToolAction(input: { noteId: string; op: string; text: string; context?: string; target?: "tr" | "en" | null; prompt?: string | null }) {
  return act(
    async () => {
      const { runWritingTool, WRITING_OPS } = await import("@/server/ai/writing");
      const parsed = z
        .object({
          noteId: z.string().uuid(),
          op: z.enum(WRITING_OPS),
          text: z.string().max(40_000),
          context: z.string().max(20_000).optional(),
          target: z.enum(["tr", "en"]).nullish(),
          prompt: z.string().max(500).nullish(),
        })
        .parse(input);
      const note = await getNote(parsed.noteId);
      if (!note) throw new UserError("Sayfa bulunamadı.");
      if (note.aiOff) throw new UserError("Bu sayfa yapay zekâya kapalı.");
      const text = await runWritingTool({ ...parsed, entity: { type: "note", id: note.id } });
      return { text };
    },
    { write: false },
  );
}
