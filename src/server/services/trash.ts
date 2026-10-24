import "server-only";
import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { ENTITIES, type EntityType } from "@/server/entities";
import { unindexRecord } from "@/server/search/index-service";
import { logActivity } from "./activity";
import { deleteLinksOf } from "./links";

export const TRASH_DAYS = 30;

/** Soft delete: the record moves to the trash for 30 days and leaves search. */
export async function moveToTrash(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  const [row] = (await db
    .update(def.table)
    .set({ deletedAt: new Date() })
    .where(eq(def.table.id, id))
    .returning()) as Record<string, unknown>[];
  if (!row) return null;
  await unindexRecord(type, id);
  if (type === "document") {
    const { removeDocumentPassagesFromSearch } = await import("./documents-search-hooks");
    await removeDocumentPassagesFromSearch(id);
  }
  await logActivity({ action: "trash", entityType: type, entityId: id, title: String(row[def.title] ?? "") });
  return row;
}

export async function restoreFromTrash(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  const [row] = (await db
    .update(def.table)
    .set({ deletedAt: null })
    .where(eq(def.table.id, id))
    .returning()) as Record<string, unknown>[];
  if (!row) return null;
  const { reindexEntity } = await import("./reindex");
  await reindexEntity(type, id);
  await logActivity({ action: "restore", entityType: type, entityId: id, title: String(row[def.title] ?? "") });
  return row;
}

export type TrashItem = { type: EntityType; id: string; title: string; deletedAt: Date };

export async function listTrash(): Promise<TrashItem[]> {
  const db = await getDb();
  const items: TrashItem[] = [];
  for (const [type, def] of Object.entries(ENTITIES) as [EntityType, (typeof ENTITIES)[EntityType]][]) {
    if (!def.trash) continue;
    const rows = (await db
      .select()
      .from(def.table)
      .where(isNotNull(def.table.deletedAt))
      .orderBy(desc(def.table.deletedAt))
      .limit(200)) as Record<string, unknown>[];
    for (const r of rows) {
      items.push({ type, id: r.id as string, title: String(r[def.title] ?? "") || "—", deletedAt: r.deletedAt as Date });
    }
  }
  return items.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** Delete for good: the record, its links, its search rows, and for files the stored bytes. */
export async function purge(type: EntityType, id: string) {
  const def = ENTITIES[type];
  const db = await getDb();
  if (type === "document") {
    const { purgeDocumentFiles } = await import("./documents-search-hooks");
    await purgeDocumentFiles(id);
  }
  await deleteLinksOf({ type, id });
  await unindexRecord(type, id);
  await db.delete(def.table).where(eq(def.table.id, id));
  await logActivity({ action: "purge", entityType: type, entityId: id, actor: "system" });
}

/** Empty everything older than 30 days (runs daily from cron). */
export async function purgeExpired(now = new Date()) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  let count = 0;
  for (const [type, def] of Object.entries(ENTITIES) as [EntityType, (typeof ENTITIES)[EntityType]][]) {
    if (!def.trash) continue;
    const rows = (await db
      .select({ id: def.table.id })
      .from(def.table)
      .where(and(isNotNull(def.table.deletedAt), lt(def.table.deletedAt, cutoff)))) as { id: string }[];
    for (const r of rows) {
      await purge(type, r.id);
      count++;
    }
  }
  return count;
}
