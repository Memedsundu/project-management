import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { collections, links } from "@/server/db/schema";
import { ENTITY_TYPES, type EntityRef, type EntityType } from "@/server/entities";
import { keywordSearch, type SearchHit } from "@/server/search/search";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity } from "./activity";
import { addLink, listLinks, removeLink } from "./links";
import { idsWithTag } from "./tags";

/**
 * Collections gather items for one purpose without moving them (Dropbox Dash
 * Stacks). A smart collection is a saved filter that keeps itself up to date.
 * Each collection also works as a NotebookLM-style notebook for Ask.
 */

export const smartFilterSchema = z.object({
  q: z.string().max(200).optional(),
  types: z.array(z.enum(ENTITY_TYPES)).max(16).optional(),
  orgId: z.string().uuid().optional(),
  tag: z.string().max(60).optional(),
  docType: z.string().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SmartFilter = z.infer<typeof smartFilterSchema>;

export const collectionInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  pinned: z.boolean().optional(),
  smartFilter: smartFilterSchema.nullish(),
});

export async function createCollection(raw: z.input<typeof collectionInputSchema>, items: EntityRef[] = []) {
  const input = collectionInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .insert(collections)
    .values({ name: input.name, description: input.description ?? null, pinned: input.pinned ?? false, smartFilter: input.smartFilter ?? null })
    .returning();
  for (const item of items) await addLink({ type: "collection", id: row!.id }, item, "collection_item");
  await logActivity({ action: "create", entityType: "collection", entityId: row!.id, title: row!.name });
  await indexCollection(row!.id);
  return row!;
}

export async function updateCollection(id: string, raw: Partial<z.input<typeof collectionInputSchema>>) {
  const patch = collectionInputSchema.partial().parse(raw);
  const db = await getDb();
  const [row] = await db.update(collections).set({ ...patch, updatedAt: new Date() }).where(eq(collections.id, id)).returning();
  if (row) await indexCollection(id);
  return row ?? null;
}

export async function addToCollection(id: string, items: EntityRef[]) {
  for (const item of items) await addLink({ type: "collection", id }, item, "collection_item");
  const db = await getDb();
  await db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, id));
  await indexCollection(id);
}

export async function removeFromCollection(id: string, item: EntityRef) {
  await removeLink({ type: "collection", id }, item, "collection_item");
  await indexCollection(id);
}

export type CollectionListItem = typeof collections.$inferSelect & { itemCount: number };

export async function listCollections(opts: { pinnedOnly?: boolean } = {}): Promise<CollectionListItem[]> {
  const db = await getDb();
  const where = [isNull(collections.deletedAt)];
  if (opts.pinnedOnly) where.push(eq(collections.pinned, true));
  const rows = await db
    .select({
      c: collections,
      n: sql<number>`(select count(*)::int from ${links} l where l.kind = 'collection_item' and l.from_type = 'collection' and l.from_id = ${collections.id})`,
    })
    .from(collections)
    .where(and(...where))
    .orderBy(desc(collections.pinned), asc(collections.name));
  return rows.map((r) => ({ ...r.c, itemCount: Number(r.n) }));
}

export type CollectionItem = { type: EntityType; id: string; title: string; href: string; source: "picked" | "smart"; snippet?: string; occurredAt?: string | null };

/** The items of a collection: hand-picked ones first, then the smart filter's matches. */
export async function collectionItems(id: string, opts: { limit?: number } = {}): Promise<CollectionItem[]> {
  const db = await getDb();
  const [c] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!c) return [];
  const picked = (await listLinks({ type: "collection", id }, { kinds: ["collection_item"] }))
    .filter((l) => l.direction === "out" && !l.deleted)
    .map<CollectionItem>((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, source: "picked" }));
  const seen = new Set(picked.map((p) => `${p.type}:${p.id}`));
  const smart = c.smartFilter ? await runSmartFilter(smartFilterSchema.parse(c.smartFilter), opts.limit ?? 100) : [];
  const extra = smart
    .filter((h) => !seen.has(`${h.type}:${h.id}`))
    .map<CollectionItem>((h) => ({ type: h.type, id: h.id, title: h.title, href: h.href, source: "smart", snippet: h.snippet, occurredAt: h.occurredAt }));
  return [...picked, ...extra];
}

export async function runSmartFilter(f: SmartFilter, limit = 100): Promise<SearchHit[]> {
  let hits = await keywordSearch(f.q ?? "", {
    filters: { types: f.types, orgId: f.orgId, from: f.from, to: f.to, docType: f.docType },
    limit: f.tag ? 400 : limit,
  });
  if (f.tag) {
    const types = [...new Set(hits.map((h) => h.type))];
    const allowed = new Set<string>();
    for (const t of types) for (const tid of await idsWithTag(t, f.tag)) allowed.add(`${t}:${tid}`);
    hits = hits.filter((h) => allowed.has(`${h.type}:${h.id}`));
  }
  return hits.filter((h) => h.type !== "collection").slice(0, limit);
}

export async function getCollection(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!c) return null;
  return { ...c, items: await collectionItems(id) };
}

/** Collections an item belongs to by hand (for the "Koleksiyonlar" chip on any page). */
export async function collectionsOf(ref: EntityRef) {
  const items = await listLinks(ref, { kinds: ["collection_item"] });
  return items.filter((i) => i.type === "collection").map((i) => ({ id: i.id, title: i.title, href: i.href }));
}

export async function indexCollection(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(collections).where(eq(collections.id, id)).limit(1);
  if (!c || c.deletedAt) return unindexRecord("collection", id);
  const items = await listLinks({ type: "collection", id }, { kinds: ["collection_item"] });
  await indexRecord({
    type: "collection",
    id,
    title: c.name,
    body: [c.description, items.map((i) => i.title).join("\n")].filter(Boolean).join("\n"),
    meta: { pinned: c.pinned, smart: Boolean(c.smartFilter) },
    occurredAt: c.updatedAt,
  });
}
