import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { slugify } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { taggings, tags } from "@/server/db/schema";
import type { EntityRef, EntityType } from "@/server/entities";

export type TagRow = { id: string; name: string; slug: string; count?: number };

export async function listTags(): Promise<TagRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: tags.id, name: tags.name, slug: tags.slug, count: count(taggings.id) })
    .from(tags)
    .leftJoin(taggings, eq(taggings.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(tags.name));
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

/** Find or create tags by name ("rapor", "#Bütçe" → "butce"). */
export async function ensureTags(names: string[]) {
  const db = await getDb();
  const clean = [...new Map(names.map((n) => n.replace(/^#/, "").trim()).filter(Boolean).map((n) => [slugify(n), n])).entries()]
    .filter(([slug]) => slug.length > 0)
    .slice(0, 30);
  if (!clean.length) return [];
  await db
    .insert(tags)
    .values(clean.map(([slug, name]) => ({ slug, name })))
    .onConflictDoNothing();
  return db.select().from(tags).where(inArray(tags.slug, clean.map(([s]) => s)));
}

export async function tagsOf(ref: EntityRef): Promise<TagRow[]> {
  const db = await getDb();
  return db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, ref.type), eq(taggings.entityId, ref.id)))
    .orderBy(asc(tags.name));
}

/** Tags of many records of one type at once (for lists). */
export async function tagsFor(type: EntityType, ids: string[]) {
  const out = new Map<string, TagRow[]>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = await db
    .select({ entityId: taggings.entityId, id: tags.id, name: tags.name, slug: tags.slug })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, type), inArray(taggings.entityId, ids)));
  for (const r of rows) {
    const list = out.get(r.entityId) ?? [];
    list.push({ id: r.id, name: r.name, slug: r.slug });
    out.set(r.entityId, list);
  }
  return out;
}

export async function setTags(ref: EntityRef, names: string[]) {
  const db = await getDb();
  const rows = await ensureTags(names);
  await db.delete(taggings).where(and(eq(taggings.entityType, ref.type), eq(taggings.entityId, ref.id)));
  if (rows.length) {
    await db
      .insert(taggings)
      .values(rows.map((t) => ({ tagId: t.id, entityType: ref.type, entityId: ref.id })))
      .onConflictDoNothing();
  }
  return rows;
}

export async function addTags(ref: EntityRef, names: string[]) {
  const db = await getDb();
  const rows = await ensureTags(names);
  if (rows.length) {
    await db
      .insert(taggings)
      .values(rows.map((t) => ({ tagId: t.id, entityType: ref.type, entityId: ref.id })))
      .onConflictDoNothing();
  }
  return rows;
}

export async function idsWithTag(type: EntityType, slug: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: taggings.entityId })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.entityType, type), eq(tags.slug, slug)));
  return rows.map((r) => r.id);
}

export async function renameTag(id: string, name: string) {
  const db = await getDb();
  await db.update(tags).set({ name: name.trim(), slug: slugify(name) }).where(eq(tags.id, id));
}

export async function deleteTag(id: string) {
  const db = await getDb();
  await db.delete(tags).where(eq(tags.id, id));
}

export async function mergeTags(fromId: string, intoId: string) {
  const db = await getDb();
  await db.execute(sql`
    insert into taggings (tag_id, entity_type, entity_id)
    select ${intoId}::uuid, entity_type, entity_id from taggings where tag_id = ${fromId}::uuid
    on conflict do nothing`);
  await db.delete(tags).where(eq(tags.id, fromId));
}
