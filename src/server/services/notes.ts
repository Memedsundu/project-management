import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { blocksToPlainText, extractMentions, markdownToBlocks, type Block } from "@/lib/blocks";
import { formatLongDay, todayStr } from "@/lib/dates";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { notes, noteVersions } from "@/server/db/schema";
import { isEntityType, type EntityRef } from "@/server/entities";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { addLink, setLinks } from "./links";

export type NoteRow = typeof notes.$inferSelect;

const VERSION_EVERY_MS = 10 * 60 * 1000;

export const noteInputSchema = z.object({
  title: z.string().max(300).optional(),
  markdown: z.string().max(400_000).optional(),
  content: z.array(z.any()).max(5000).optional(),
  parentId: z.string().uuid().nullish(),
  kind: z.enum(["page", "daily", "memory", "email"]).optional(),
  icon: z.string().max(16).nullish(),
  inbox: z.boolean().optional(),
  dailyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  systemKey: z.string().max(60).nullish(),
  meta: z.record(z.string(), z.unknown()).optional(),
  links: z.array(z.object({ type: z.string(), id: z.string().uuid() })).max(20).optional(),
});
export type NoteInput = z.input<typeof noteInputSchema>;

/** A new page. Content comes as BlockNote JSON or as Markdown. */
export async function createNote(raw: NoteInput, actor: Actor = "user") {
  const input = noteInputSchema.parse(raw);
  const content: Block[] = input.content ?? (input.markdown ? markdownToBlocks(input.markdown) : []);
  const db = await getDb();
  const [row] = await db
    .insert(notes)
    .values({
      title: (input.title ?? "").trim(),
      icon: input.icon ?? null,
      parentId: input.parentId ?? null,
      content,
      plainText: blocksToPlainText(content),
      kind: input.kind ?? "page",
      dailyDate: input.dailyDate ?? null,
      systemKey: input.systemKey ?? null,
      inbox: input.inbox ?? false,
      meta: input.meta ?? {},
      sortOrder: Date.now() % 1_000_000_000,
    })
    .returning();
  const note = row!;
  await syncMentions(note.id, content);
  for (const l of input.links ?? []) {
    if (isEntityType(l.type)) await addLink({ type: "note", id: note.id }, { type: l.type, id: l.id }, "related", actor === "ai" ? "ai" : "user");
  }
  if (actor === "ai") await snapshot(note.id, note.title, content, "ai");
  await logActivity({ action: "create", entityType: "note", entityId: note.id, title: note.title || null, actor });
  await indexNote(note.id);
  return note;
}

export const notePatchSchema = z.object({
  title: z.string().max(300).optional(),
  content: z.array(z.any()).max(5000).optional(),
  markdown: z.string().max(400_000).optional(),
  icon: z.string().max(16).nullish(),
  parentId: z.string().uuid().nullish(),
  pinned: z.boolean().optional(),
  aiOff: z.boolean().optional(),
  inbox: z.boolean().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type NotePatch = z.input<typeof notePatchSchema>;

/** Save edits. Keeps a version at most every ten minutes, like Notion page history. */
export async function updateNote(id: string, raw: NotePatch, actor: Actor = "user") {
  const patch = notePatchSchema.parse(raw);
  const db = await getDb();
  const [before] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!before) return null;
  const set: Partial<typeof notes.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title.trim();
  const content = patch.content ?? (patch.markdown !== undefined ? markdownToBlocks(patch.markdown) : undefined);
  if (content) {
    set.content = content;
    set.plainText = blocksToPlainText(content as Block[]);
  }
  if (patch.icon !== undefined) set.icon = patch.icon ?? null;
  if (patch.parentId !== undefined) {
    if (patch.parentId && (await isDescendant(patch.parentId, id))) throw new UserError("Bir sayfa kendi içine taşınamaz.");
    set.parentId = patch.parentId ?? null;
  }
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (patch.aiOff !== undefined) set.aiOff = patch.aiOff;
  if (patch.inbox !== undefined) set.inbox = patch.inbox;
  if (patch.meta !== undefined) set.meta = { ...(before.meta as object), ...patch.meta };
  // Moving a page somewhere files it out of the inbox.
  if (patch.parentId && before.inbox && patch.inbox === undefined) set.inbox = false;

  if (content || patch.title !== undefined) {
    const [last] = await db
      .select({ createdAt: noteVersions.createdAt })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, id))
      .orderBy(desc(noteVersions.createdAt))
      .limit(1);
    const stale = !last || Date.now() - last.createdAt.getTime() > VERSION_EVERY_MS;
    if (stale || actor === "ai") await snapshot(id, before.title, before.content as Block[], "user");
  }
  const [row] = await db.update(notes).set(set).where(eq(notes.id, id)).returning();
  if (content) await syncMentions(id, content as Block[]);
  if (patch.title !== undefined && patch.title !== before.title) {
    await logActivity({ action: "rename", entityType: "note", entityId: id, title: row!.title, actor });
  } else if (patch.parentId !== undefined && patch.parentId !== before.parentId) {
    await logActivity({ action: "move", entityType: "note", entityId: id, title: row!.title, actor });
  } else if (content && actor === "ai") {
    await logActivity({ action: "update", entityType: "note", entityId: id, title: row!.title, actor });
  }
  await indexNote(id);
  return row!;
}

async function snapshot(noteId: string, title: string, content: Block[], createdBy: string) {
  const db = await getDb();
  await db.insert(noteVersions).values({ noteId, title, content, createdBy });
  // Keep the last 60 versions per page.
  await db.execute(sql`
    delete from note_versions where note_id = ${noteId}::uuid and id not in (
      select id from note_versions where note_id = ${noteId}::uuid order by created_at desc limit 60)`);
}

async function isDescendant(candidate: string, ancestor: string) {
  if (candidate === ancestor) return true;
  const db = await getDb();
  const res = (await db.execute(sql`
    with recursive up as (
      select id, parent_id from notes where id = ${candidate}::uuid
      union all
      select n.id, n.parent_id from notes n join up on n.id = up.parent_id
    ) select 1 as hit from up where id = ${ancestor}::uuid limit 1`)) as unknown as { rows: unknown[] };
  return (res.rows?.length ?? 0) > 0;
}

async function syncMentions(noteId: string, content: Block[]) {
  const targets: EntityRef[] = extractMentions(content)
    .filter((m) => isEntityType(m.kind))
    .map((m) => ({ type: m.kind as EntityRef["type"], id: m.id }));
  await setLinks({ type: "note", id: noteId }, "mention", targets);
}

export async function indexNote(id: string) {
  const db = await getDb();
  const [n] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!n || n.deletedAt || n.kind === "memory") {
    await unindexRecord("note", id);
    return;
  }
  await indexRecord({
    type: "note",
    id,
    title: n.title || (n.kind === "daily" && n.dailyDate ? formatLongDay(n.dailyDate, "tr") : ""),
    body: n.plainText,
    meta: { kind: n.kind, parentId: n.parentId },
    aiOff: n.aiOff,
    occurredAt: n.dailyDate ? new Date(n.dailyDate) : n.updatedAt,
  });
}

export async function getNote(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  return row ?? null;
}

export type NoteTreeItem = { id: string; title: string; icon: string | null; parentId: string | null; kind: string; pinned: boolean; updatedAt: Date; inbox: boolean };

/** Every page for the sidebar tree, children under parents. Daily notes live in their own list. */
export async function listNotesTree(): Promise<NoteTreeItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      icon: notes.icon,
      parentId: notes.parentId,
      kind: notes.kind,
      pinned: notes.pinned,
      updatedAt: notes.updatedAt,
      inbox: notes.inbox,
      deletedAt: notes.deletedAt,
    })
    .from(notes)
    .where(and(eq(notes.kind, "page")))
    .orderBy(asc(notes.sortOrder), asc(notes.createdAt));
  const deleted = new Set(rows.filter((r) => r.deletedAt).map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hidden = (r: (typeof rows)[number]): boolean => {
    let p = r.parentId;
    let guard = 0;
    while (p && guard++ < 50) {
      if (deleted.has(p)) return true;
      p = byId.get(p)?.parentId ?? null;
    }
    return false;
  };
  return rows
    .filter((r) => !r.deletedAt && !hidden(r))
    .map((r) => ({ id: r.id, title: r.title, icon: r.icon, parentId: r.parentId, kind: r.kind, pinned: r.pinned, updatedAt: r.updatedAt, inbox: r.inbox }));
}

export async function listRecentNotes(limit = 8) {
  const db = await getDb();
  return db
    .select({ id: notes.id, title: notes.title, icon: notes.icon, kind: notes.kind, dailyDate: notes.dailyDate, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(isNull(notes.deletedAt), sql`${notes.kind} in ('page', 'daily', 'email')`))
    .orderBy(desc(notes.updatedAt))
    .limit(limit);
}

export async function listDailyNotes(limit = 60) {
  const db = await getDb();
  return db
    .select({ id: notes.id, title: notes.title, dailyDate: notes.dailyDate, plainText: notes.plainText, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(isNull(notes.deletedAt), eq(notes.kind, "daily")))
    .orderBy(desc(notes.dailyDate))
    .limit(limit);
}

export async function listInboxNotes() {
  const db = await getDb();
  return db
    .select()
    .from(notes)
    .where(and(isNull(notes.deletedAt), eq(notes.inbox, true)))
    .orderBy(desc(notes.createdAt))
    .limit(200);
}

/** "Günlük not": one page per day, made on first open (Obsidian daily notes). */
export async function getOrCreateDailyNote(day = todayStr()) {
  const db = await getDb();
  const [found] = await db.select().from(notes).where(eq(notes.dailyDate, day)).limit(1);
  if (found) {
    if (found.deletedAt) {
      const [row] = await db.update(notes).set({ deletedAt: null }).where(eq(notes.id, found.id)).returning();
      await indexNote(found.id);
      return row!;
    }
    return found;
  }
  const content: Block[] = [
    { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Bugünün odağı" }] },
    { type: "checkListItem", props: { checked: false }, content: [] },
    { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Notlar" }] },
    { type: "paragraph", content: [] },
  ];
  try {
    return await createNote({ title: "", kind: "daily", dailyDate: day, content });
  } catch {
    // Opened twice at the same moment: the other request made it.
    const [row] = await db.select().from(notes).where(eq(notes.dailyDate, day)).limit(1);
    return row!;
  }
}

export async function listNoteVersions(noteId: string) {
  const db = await getDb();
  return db
    .select({ id: noteVersions.id, title: noteVersions.title, createdAt: noteVersions.createdAt, createdBy: noteVersions.createdBy })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.createdAt))
    .limit(60);
}

export async function getNoteVersion(versionId: string) {
  const db = await getDb();
  const [row] = await db.select().from(noteVersions).where(eq(noteVersions.id, versionId)).limit(1);
  return row ?? null;
}

export async function restoreNoteVersion(noteId: string, versionId: string) {
  const v = await getNoteVersion(versionId);
  if (!v || v.noteId !== noteId) return null;
  const db = await getDb();
  const [cur] = await db.select().from(notes).where(eq(notes.id, noteId)).limit(1);
  if (!cur) return null;
  await snapshot(noteId, cur.title, cur.content as Block[], "user");
  const row = await updateNote(noteId, { title: v.title, content: v.content as Block[] });
  await logActivity({ action: "restore_version", entityType: "note", entityId: noteId, title: v.title });
  return row;
}

export async function duplicateNote(id: string) {
  const n = await getNote(id);
  if (!n) return null;
  return createNote({ title: `${n.title} (kopya)`.trim(), content: n.content as Block[], parentId: n.parentId, icon: n.icon });
}

/** Ancestors, for the breadcrumb ("Saha > Ziyaretler > Ekim"). */
export async function noteBreadcrumb(id: string) {
  const db = await getDb();
  const res = (await db.execute(sql`
    with recursive up as (
      select id, parent_id, title, icon, 0 as depth from notes where id = ${id}::uuid
      union all
      select n.id, n.parent_id, n.title, n.icon, up.depth + 1 from notes n join up on n.id = up.parent_id where up.depth < 20
    ) select id, title, icon, depth from up where id <> ${id}::uuid order by depth desc`)) as unknown as {
    rows: { id: string; title: string; icon: string | null }[];
  };
  return res.rows ?? [];
}

export async function childNotes(id: string) {
  const db = await getDb();
  return db
    .select({ id: notes.id, title: notes.title, icon: notes.icon, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.parentId, id), isNull(notes.deletedAt)))
    .orderBy(asc(notes.sortOrder), asc(notes.createdAt));
}

/** The assistant's memory page: facts she asked it to keep ("Hatırla: ..."). */
export async function getMemoryNote() {
  const db = await getDb();
  const [found] = await db.select().from(notes).where(eq(notes.systemKey, "assistant_memory")).limit(1);
  if (found) return found;
  return createNote({ title: "Asistanın hafızası", kind: "memory", systemKey: "assistant_memory", content: [] }, "system");
}
