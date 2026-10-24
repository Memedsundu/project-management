import "server-only";
import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { briefs, recipes } from "@/server/db/schema";
import { isEntityType, resolveEntities, type EntityRef } from "@/server/entities";

/**
 * What the helpers wrote: the day's summary, the Friday review, the monthly
 * partner report check and her recipes' results. Read on Özetler; the ones
 * she has not opened yet are offered on Bugün.
 */

export const BRIEF_KINDS = ["daily", "weekly", "partner_check", "recipe"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

export type BriefListItem = {
  id: string;
  kind: BriefKind;
  day: string;
  title: string;
  preview: string;
  read: boolean;
  ai: boolean;
  createdAt: string;
};

/** Markdown down to a line of plain words, for a preview. */
export function plainPreview(markdown: string, max = 180) {
  const text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>|]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const toItem = (r: typeof briefs.$inferSelect): BriefListItem => ({
  id: r.id,
  kind: (BRIEF_KINDS as readonly string[]).includes(r.kind) ? (r.kind as BriefKind) : "recipe",
  day: r.day,
  title: r.title,
  preview: plainPreview(r.content),
  read: Boolean(r.readAt),
  ai: Boolean(r.model),
  createdAt: r.createdAt.toISOString(),
});

export async function listBriefs(opts: { kind?: BriefKind | null; limit?: number } = {}) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(briefs)
    .where(opts.kind ? eq(briefs.kind, opts.kind) : undefined)
    .orderBy(desc(briefs.day), desc(briefs.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map(toItem);
}

/** Briefs she has not opened, apart from the day's summary (Bugün shows that one itself). */
export async function unreadBriefs(limit = 3) {
  const db = await getDb();
  const where = and(isNull(briefs.readAt), ne(briefs.kind, "daily"));
  const [rows, [total]] = await Promise.all([
    db.select().from(briefs).where(where).orderBy(desc(briefs.createdAt)).limit(limit),
    db.select({ n: count() }).from(briefs).where(where),
  ]);
  return { items: rows.map(toItem), total: Number(total?.n ?? 0) };
}

export async function countUnreadBriefs() {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(briefs)
    .where(and(isNull(briefs.readAt), ne(briefs.kind, "daily")));
  return Number(row?.n ?? 0);
}

/** One brief with the recipe that wrote it and the page it was run on. */
export async function getBrief(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  if (!row) return null;
  const [recipe] = row.recipeId ? await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(eq(recipes.id, row.recipeId)).limit(1) : [];
  const entity = (row.data as { entity?: { type: string; id: string } } | null)?.entity;
  let about: { type: string; id: string; title: string; href: string } | null = null;
  if (entity && isEntityType(entity.type)) {
    const found = (await resolveEntities([entity as EntityRef])).get(`${entity.type}:${entity.id}`);
    if (found) about = { type: entity.type, id: entity.id, title: found.title, href: found.href };
  }
  return { ...toItem(row), content: row.content, model: row.model, recipe: recipe ?? null, about, entity: entity ?? null, data: row.data };
}

export async function markBriefRead(id: string) {
  const db = await getDb();
  await db
    .update(briefs)
    .set({ readAt: new Date() })
    .where(and(eq(briefs.id, id), isNull(briefs.readAt)));
}

export async function markBriefsRead(ids: string[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db
    .update(briefs)
    .set({ readAt: new Date() })
    .where(and(inArray(briefs.id, ids), isNull(briefs.readAt)));
}

export async function deleteBrief(id: string) {
  const db = await getDb();
  await db.delete(briefs).where(eq(briefs.id, id));
}

/** When each helper last wrote something, for Ayarlar. */
export async function lastBriefDays() {
  const db = await getDb();
  const out: Partial<Record<BriefKind, string>> = {};
  for (const kind of ["daily", "weekly", "partner_check"] as const) {
    const [row] = await db.select({ day: briefs.day }).from(briefs).where(eq(briefs.kind, kind)).orderBy(desc(briefs.day)).limit(1);
    if (row) out[kind] = row.day;
  }
  return out;
}
