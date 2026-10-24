import "server-only";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { links } from "@/server/db/schema";
import { resolveEntities, type EntityRef, type EntityType, type ResolvedEntity } from "@/server/entities";

export type LinkKind = "related" | "mention" | "partner" | "attendee" | "collection_item" | "source" | "attachment";

export async function addLink(from: EntityRef, to: EntityRef, kind: LinkKind = "related", createdBy: "user" | "ai" = "user") {
  if (from.type === to.type && from.id === to.id) return;
  const db = await getDb();
  await db
    .insert(links)
    .values({ fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, kind, createdBy })
    .onConflictDoNothing();
}

export async function removeLink(from: EntityRef, to: EntityRef, kind?: LinkKind) {
  const db = await getDb();
  const where = [
    eq(links.fromType, from.type),
    eq(links.fromId, from.id),
    eq(links.toType, to.type),
    eq(links.toId, to.id),
  ];
  if (kind) where.push(eq(links.kind, kind));
  await db.delete(links).where(and(...where));
  // Links are undirected for the user: remove the mirror too.
  const mirror = [
    eq(links.fromType, to.type),
    eq(links.fromId, to.id),
    eq(links.toType, from.type),
    eq(links.toId, from.id),
  ];
  if (kind) mirror.push(eq(links.kind, kind));
  await db.delete(links).where(and(...mirror));
}

/** Replace every outgoing link of one kind (used for @mentions and partner pickers). */
export async function setLinks(from: EntityRef, kind: LinkKind, targets: EntityRef[], createdBy: "user" | "ai" = "user") {
  const db = await getDb();
  await db
    .delete(links)
    .where(and(eq(links.fromType, from.type), eq(links.fromId, from.id), eq(links.kind, kind)));
  const unique = new Map(targets.filter((t) => !(t.type === from.type && t.id === from.id)).map((t) => [`${t.type}:${t.id}`, t]));
  if (unique.size === 0) return;
  await db
    .insert(links)
    .values(
      [...unique.values()].map((t) => ({
        fromType: from.type,
        fromId: from.id,
        toType: t.type,
        toId: t.id,
        kind,
        createdBy,
      })),
    )
    .onConflictDoNothing();
}

export type LinkedItem = ResolvedEntity & { kind: string; direction: "out" | "in"; linkId: string; createdBy: string };

/** Everything linked to a record, in both directions, with titles. Backlinks included. */
export async function listLinks(ref: EntityRef, opts: { kinds?: LinkKind[] } = {}): Promise<LinkedItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(links)
    .where(
      or(
        and(eq(links.fromType, ref.type), eq(links.fromId, ref.id)),
        and(eq(links.toType, ref.type), eq(links.toId, ref.id)),
      ),
    );
  const filtered = opts.kinds ? rows.filter((r) => opts.kinds!.includes(r.kind as LinkKind)) : rows;
  const others = filtered.map((r) =>
    r.fromType === ref.type && r.fromId === ref.id
      ? { ref: { type: r.toType as EntityType, id: r.toId }, direction: "out" as const, row: r }
      : { ref: { type: r.fromType as EntityType, id: r.fromId }, direction: "in" as const, row: r },
  );
  const resolved = await resolveEntities(others.map((o) => o.ref));
  const seen = new Set<string>();
  const out: LinkedItem[] = [];
  for (const o of others) {
    const r = resolved.get(`${o.ref.type}:${o.ref.id}`);
    if (!r) continue;
    const key = `${o.row.kind}:${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, kind: o.row.kind, direction: o.direction, linkId: o.row.id, createdBy: o.row.createdBy });
  }
  return out;
}

/** Ids of records of one type linked to the given record (either direction). */
export async function linkedIds(ref: EntityRef, type: EntityType, kind?: LinkKind) {
  const items = await listLinks(ref, kind ? { kinds: [kind] } : {});
  return items.filter((i) => i.type === type).map((i) => i.id);
}

/** Records of `fromType` that link to any of the given targets. */
export async function idsLinkedTo(fromType: EntityType, target: EntityRef, kind?: LinkKind) {
  const db = await getDb();
  const where = [eq(links.toType, target.type), eq(links.toId, target.id), eq(links.fromType, fromType)];
  if (kind) where.push(eq(links.kind, kind));
  const out = await db.select({ id: links.fromId }).from(links).where(and(...where));
  const back = [eq(links.fromType, target.type), eq(links.fromId, target.id), eq(links.toType, fromType)];
  if (kind) back.push(eq(links.kind, kind));
  const out2 = await db.select({ id: links.toId }).from(links).where(and(...back));
  return [...new Set([...out.map((r) => r.id), ...out2.map((r) => r.id)])];
}

export async function deleteLinksOf(ref: EntityRef) {
  const db = await getDb();
  await db
    .delete(links)
    .where(
      or(
        and(eq(links.fromType, ref.type), eq(links.fromId, ref.id)),
        and(eq(links.toType, ref.type), eq(links.toId, ref.id)),
      ),
    );
}
