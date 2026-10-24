"use server";

import { z } from "zod";
import { act } from "@/server/action";
import type { Block } from "@/lib/blocks";
import {
  createNote,
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
    await restoreNoteVersion(z.string().uuid().parse(noteId), z.string().uuid().parse(versionId));
    return null;
  });
}
