import "server-only";
import { inArray, isNull, and, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Every kind of record the app links, searches, logs and trashes.
 * One registry keeps titles and URLs consistent across the app.
 */
export const ENTITY_TYPES = [
  "task",
  "note",
  "meeting",
  "series",
  "decision",
  "document",
  "folder",
  "organisation",
  "contact",
  "activity",
  "indicator",
  "logframe",
  "report",
  "collection",
  "template",
  "visual",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(v: string): v is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(v);
}

type Def = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable & Record<string, any>;
  title: string; // column key holding the display title
  trash: boolean;
  href: (id: string, row?: Record<string, unknown>) => string;
};

export const ENTITIES: Record<EntityType, Def> = {
  task: { table: s.tasks, title: "title", trash: true, href: (id) => `/tasks?open=${id}` },
  note: { table: s.notes, title: "title", trash: true, href: (id) => `/notes/${id}` },
  meeting: { table: s.meetings, title: "title", trash: true, href: (id) => `/meetings/${id}` },
  series: { table: s.meetingSeries, title: "title", trash: true, href: (id) => `/meetings/series/${id}` },
  decision: {
    table: s.decisions,
    title: "text",
    trash: true,
    href: (id, row) => (row?.meetingId ? `/meetings/${row.meetingId}` : `/meetings/decisions#${id}`),
  },
  document: { table: s.documents, title: "title", trash: true, href: (id) => `/files/d/${id}` },
  folder: { table: s.folders, title: "name", trash: true, href: (id) => `/files/f/${id}` },
  organisation: { table: s.organisations, title: "name", trash: true, href: (id) => `/partners/${id}` },
  contact: {
    table: s.contacts,
    title: "name",
    trash: true,
    href: (id, row) => (row?.organisationId ? `/partners/${row.organisationId}?contact=${id}` : `/partners/contacts#${id}`),
  },
  activity: { table: s.activities, title: "title", trash: true, href: (id) => `/workplan?open=${id}` },
  indicator: { table: s.indicators, title: "name", trash: true, href: (id) => `/indicators/${id}` },
  logframe: { table: s.logframeNodes, title: "title", trash: true, href: () => `/indicators/logframe` },
  report: { table: s.reports, title: "title", trash: true, href: (id) => `/reports/${id}` },
  collection: { table: s.collections, title: "name", trash: true, href: (id) => `/collections/${id}` },
  template: { table: s.templates, title: "name", trash: true, href: () => `/settings/templates` },
  visual: { table: s.visuals, title: "title", trash: true, href: (id) => `/reports/visuals/${id}` },
};

export type EntityRef = { type: EntityType; id: string };
export type ResolvedEntity = EntityRef & { title: string; href: string; deleted: boolean; extra?: Record<string, unknown> };

/** Titles and URLs for a set of references, in one query per type. */
export async function resolveEntities(refs: EntityRef[], opts: { includeDeleted?: boolean } = {}) {
  const db = await getDb();
  const byType = new Map<EntityType, string[]>();
  for (const r of refs) {
    if (!isEntityType(r.type)) continue;
    const list = byType.get(r.type) ?? [];
    list.push(r.id);
    byType.set(r.type, list);
  }
  const out = new Map<string, ResolvedEntity>();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const def = ENTITIES[type];
      const table = def.table;
      const where: SQL[] = [inArray(table.id, ids)];
      if (!opts.includeDeleted && "deletedAt" in table) where.push(isNull(table.deletedAt));
      const rows = (await db
        .select()
        .from(table)
        .where(and(...where))) as Record<string, unknown>[];
      for (const row of rows) {
        const id = row.id as string;
        out.set(`${type}:${id}`, {
          type,
          id,
          title: String(row[def.title] ?? "") || "—",
          href: def.href(id, row),
          deleted: Boolean(row.deletedAt),
          extra: row,
        });
      }
    }),
  );
  return out;
}

export async function resolveEntity(ref: EntityRef) {
  const map = await resolveEntities([ref], { includeDeleted: true });
  return map.get(`${ref.type}:${ref.id}`) ?? null;
}
