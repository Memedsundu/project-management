import "server-only";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { askThreads, folders, logframeNodes, notes, studioOutputs, visuals } from "@/server/db/schema";
import { ENTITIES, type EntityType } from "@/server/entities";
import { unindexRecord } from "@/server/search/index-service";
import { logActivity } from "./activity";
import { deleteLinksOf } from "./links";

export const TRASH_DAYS = 30;

type Ref = { type: EntityType; id: string };

/**
 * What sits under a folder or a page: subfolders and their files, or
 * subpages. `at` set: only the rows that went to the trash with it (same
 * moment). `at` null: only the rows still in use.
 */
async function under(type: EntityType, id: string, at: Date | null): Promise<Ref[]> {
  if (type !== "folder" && type !== "note") return [];
  const db = await getDb();
  const state = (alias: string) => (at ? sql`${sql.raw(alias)}.deleted_at = ${at.toISOString()}::timestamptz` : sql`${sql.raw(alias)}.deleted_at is null`);
  if (type === "folder") {
    const res = (await db.execute(sql`
      with recursive down as (
        select f.id, 0 as depth from folders f where f.parent_id = ${id}::uuid and ${state("f")}
        union all
        select f.id, down.depth + 1 from folders f join down on f.parent_id = down.id where ${state("f")} and down.depth < 40
      )
      select 'folder' as type, id from down
      union all
      select 'document' as type, d.id from documents d
        where ${state("d")} and (d.folder_id = ${id}::uuid or d.folder_id in (select id from down))`)) as unknown as { rows: { type: EntityType; id: string }[] };
    return res.rows ?? [];
  }
  const res = (await db.execute(sql`
    with recursive down as (
      select n.id, 0 as depth from notes n where n.parent_id = ${id}::uuid and ${state("n")}
      union all
      select n.id, down.depth + 1 from notes n join down on n.parent_id = down.id where ${state("n")} and down.depth < 40
    ) select 'note' as type, id from down`)) as unknown as { rows: { type: EntityType; id: string }[] };
  return res.rows ?? [];
}

/**
 * Soft delete: the record moves to the trash for 30 days and leaves search.
 * A folder takes its files and subfolders with it, a page its subpages (Drive,
 * Notion); they come back together.
 */
export async function moveToTrash(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  if (type === "logframe") {
    // A logframe item leaves only when nothing sits under it; its indicators and activities stay and show as not linked.
    const kids = await db.select({ id: logframeNodes.id }).from(logframeNodes).where(and(eq(logframeNodes.parentId, id), isNull(logframeNodes.deletedAt))).limit(1);
    if (kids.length) throw new UserError("Altında başka öğeler var; önce onları sil ya da taşı.");
  }
  const at = new Date();
  const inside = await under(type, id, null);
  const [row] = (await db
    .update(def.table)
    .set({ deletedAt: at })
    .where(and(eq(def.table.id, id), isNull(def.table.deletedAt)))
    .returning()) as Record<string, unknown>[];
  if (!row) return null;
  for (const r of [{ type, id }, ...inside]) {
    if (r.id !== id) await db.update(ENTITIES[r.type].table).set({ deletedAt: at }).where(eq(ENTITIES[r.type].table.id, r.id));
    await unindexRecord(r.type, r.id);
  }
  await logActivity({ action: "trash", entityType: type, entityId: id, title: String(row[def.title] ?? "") });
  return row;
}

/**
 * Bring a record back with whatever went with it. When the folder or page it
 * lived in is still in the trash, it comes back at the top level (Drive).
 */
export async function restoreFromTrash(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  const [before] = (await db.select().from(def.table).where(eq(def.table.id, id)).limit(1)) as Record<string, unknown>[];
  if (!before) return null;
  const at = before.deletedAt instanceof Date ? before.deletedAt : null;
  const inside = at ? await under(type, id, at) : [];
  const set: Record<string, unknown> = { deletedAt: null };
  if (type === "document" && before.folderId && (await isDeleted(folders, before.folderId as string))) set.folderId = null;
  if (type === "folder" && before.parentId && (await isDeleted(folders, before.parentId as string))) set.parentId = null;
  if (type === "note" && before.parentId && (await isDeleted(notes, before.parentId as string))) set.parentId = null;
  const [row] = (await db.update(def.table).set(set).where(eq(def.table.id, id)).returning()) as Record<string, unknown>[];
  if (!row) return null;
  const { reindexEntity } = await import("./reindex");
  for (const r of inside) {
    await db.update(ENTITIES[r.type].table).set({ deletedAt: null }).where(eq(ENTITIES[r.type].table.id, r.id));
    await reindexEntity(r.type, r.id);
  }
  await reindexEntity(type, id);
  await logActivity({ action: "restore", entityType: type, entityId: id, title: String(row[def.title] ?? "") });
  return row;
}

async function isDeleted(table: typeof folders | typeof notes, id: string) {
  const db = await getDb();
  const [r] = await db.select({ deletedAt: table.deletedAt }).from(table).where(eq(table.id, id)).limit(1);
  return !r || r.deletedAt !== null;
}

export type TrashItem = { type: EntityType; id: string; title: string; href: string; deletedAt: Date; inside: number };

/**
 * What she deleted, newest first. Files and subpages that went with a folder
 * or a page are counted on it instead of listed one by one.
 */
export async function listTrash(): Promise<TrashItem[]> {
  const db = await getDb();
  const [deadFolders, deadNotes] = await Promise.all([
    db.select({ id: folders.id, parentId: folders.parentId, deletedAt: folders.deletedAt }).from(folders).where(isNotNull(folders.deletedAt)),
    db.select({ id: notes.id, parentId: notes.parentId, deletedAt: notes.deletedAt }).from(notes).where(isNotNull(notes.deletedAt)),
  ]);
  const folderAt = new Map(deadFolders.map((f) => [f.id, f]));
  const noteAt = new Map(deadNotes.map((n) => [n.id, n]));
  const same = (a: Date | null | undefined, b: Date | null | undefined) => Boolean(a && b && a.getTime() === b.getTime());

  /** The folder or page this row went to the trash with, if any. */
  const carrier = (type: EntityType, r: Record<string, unknown>): Ref | null => {
    const at = r.deletedAt as Date;
    if (type === "document" && r.folderId && same(folderAt.get(r.folderId as string)?.deletedAt, at)) return { type: "folder", id: r.folderId as string };
    if (type === "folder" && r.parentId && same(folderAt.get(r.parentId as string)?.deletedAt, at)) return { type: "folder", id: r.parentId as string };
    if (type === "note" && r.parentId && same(noteAt.get(r.parentId as string)?.deletedAt, at)) return { type: "note", id: r.parentId as string };
    return null;
  };
  const top = (ref: Ref): Ref => {
    let cur = ref;
    for (let i = 0; i < 40; i++) {
      const row = cur.type === "folder" ? folderAt.get(cur.id) : noteAt.get(cur.id);
      const next = row ? carrier(cur.type, row) : null;
      if (!next) return cur;
      cur = next;
    }
    return cur;
  };

  const items: TrashItem[] = [];
  const inside = new Map<string, number>();
  for (const [type, def] of Object.entries(ENTITIES) as [EntityType, (typeof ENTITIES)[EntityType]][]) {
    if (!def.trash) continue;
    const rows = (await db.select().from(def.table).where(isNotNull(def.table.deletedAt)).orderBy(desc(def.table.deletedAt)).limit(500)) as Record<string, unknown>[];
    for (const r of rows) {
      const with_ = carrier(type, r);
      if (with_) {
        const head = top(with_);
        inside.set(`${head.type}:${head.id}`, (inside.get(`${head.type}:${head.id}`) ?? 0) + 1);
        continue;
      }
      items.push({ type, id: r.id as string, title: String(r[def.title] ?? "") || "—", href: def.href(r.id as string, r), deletedAt: r.deletedAt as Date, inside: 0 });
    }
  }
  for (const item of items) item.inside = inside.get(`${item.type}:${item.id}`) ?? 0;
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** Delete for good: the record, what went to the trash with it, their links, search rows, and for files the stored bytes. */
export async function purge(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  const [row] = (await db.select({ deletedAt: def.table.deletedAt }).from(def.table).where(eq(def.table.id, id)).limit(1)) as { deletedAt: Date | null }[];
  if (!row) return;
  // Children first; subfolders and subpages would otherwise lose their parent and come back at the top.
  const inside = row.deletedAt ? await under(type, id, row.deletedAt) : [];
  for (const r of inside.reverse()) await purgeOne(r.type, r.id);
  await purgeOne(type, id);
}

async function purgeOne(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  if (type === "document") {
    const { purgeDocumentFiles } = await import("./documents-search-hooks");
    await purgeDocumentFiles(id);
  }
  if (type === "collection") {
    // Its chat and Studio outputs go with it; notes saved from them stay.
    await db.delete(askThreads).where(and(eq(askThreads.scopeType, "collection"), eq(askThreads.scopeId, id)));
    await db.delete(studioOutputs).where(and(eq(studioOutputs.scopeType, "collection"), eq(studioOutputs.scopeId, id)));
  }
  if (type === "report") {
    // Its Studio outputs go with it; its visuals stay as visuals of their own.
    await db.delete(studioOutputs).where(and(eq(studioOutputs.scopeType, "report"), eq(studioOutputs.scopeId, id)));
    await db.update(visuals).set({ reportId: null }).where(eq(visuals.reportId, id));
  }
  await deleteLinksOf({ type, id });
  await unindexRecord(type, id);
  await db.delete(def.table).where(eq(def.table.id, id));
  await logActivity({ action: "purge", entityType: type, entityId: id, actor: "system" });
}

/** Empty everything older than 30 days (runs daily from cron). */
export async function purgeExpired(now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 24 * 60 * 60 * 1000);
  let count = 0;
  for (const item of await listTrash()) {
    if (item.deletedAt >= cutoff) continue;
    await purge(item.type, item.id);
    count++;
  }
  return count;
}

/** Days until the trash empties this item on its own. */
export function daysLeft(deletedAt: Date, now = new Date()) {
  return Math.max(0, TRASH_DAYS - Math.floor((now.getTime() - deletedAt.getTime()) / 86_400_000));
}

