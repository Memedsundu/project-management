import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { onlyGiven } from "@/lib/patch";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { documents, indicatorValues, periods, reports, reportSections, searchIndex, visuals, type Citation, type SectionDraft, type SourceRef } from "@/server/db/schema";
import { ENTITIES, isEntityType, resolveEntities, type EntityRef, type EntityType } from "@/server/entities";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { getTemplateItem } from "./templates";

/**
 * Reports work like NotebookLM: a report has a fixed set of sources, and
 * each section is drafted only from them, with numbered citations.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SOURCE_TYPES = ["document", "note", "meeting", "indicator", "collection", "activity", "decision", "organisation"] as const;

export const sourceSchema = z.object({ type: z.enum(SOURCE_TYPES), id: z.string().uuid() });

export const reportInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  templateId: z.string().max(80).nullish(),
  periodId: z.string().uuid().nullish(),
  dueDate: day.nullish(),
  audience: z.string().max(300).nullish(),
  language: z.enum(["en-GB", "en-US", "tr"]).default("en-GB"),
  sources: z.array(sourceSchema).max(200).default([]),
});
export type ReportInput = z.input<typeof reportInputSchema>;

export async function createReport(raw: ReportInput, actor: Actor = "user") {
  const input = reportInputSchema.parse(raw);
  const db = await getDb();
  const template = input.templateId ? await getTemplateItem(input.templateId) : null;
  const uuidTemplate = input.templateId && /^[0-9a-f-]{36}$/i.test(input.templateId) ? input.templateId : null;
  const [row] = await db
    .insert(reports)
    .values({
      title: input.title,
      templateId: uuidTemplate,
      periodId: input.periodId ?? null,
      dueDate: input.dueDate ?? null,
      audience: input.audience ?? null,
      language: input.language,
      sources: input.sources,
    })
    .returning();
  const sections = template?.content.sections?.length ? template.content.sections : [{ heading: "Summary", guidance: null, wordLimit: null }];
  await db.insert(reportSections).values(
    sections.map((s, i) => ({ reportId: row!.id, sort: (i + 1) * 10, heading: s.heading, guidance: s.guidance ?? null, wordLimit: s.wordLimit ?? null })),
  );
  await logActivity({ action: "create", entityType: "report", entityId: row!.id, title: row!.title, actor });
  await indexReport(row!.id);
  return row!;
}

export async function updateReport(id: string, raw: Partial<ReportInput> & { status?: "draft" | "final" }) {
  const patch = onlyGiven(raw, reportInputSchema.partial().extend({ status: z.enum(["draft", "final"]).optional() }).parse(raw));
  const db = await getDb();
  const values: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if ("templateId" in patch) values.templateId = patch.templateId && /^[0-9a-f-]{36}$/i.test(patch.templateId) ? patch.templateId : null;
  const [row] = await db.update(reports).set(values).where(eq(reports.id, id)).returning();
  if (!row) return null;
  await logActivity({ action: "update", entityType: "report", entityId: id, title: row.title, summary: Object.keys(patch).join(", ") });
  await indexReport(id);
  return row;
}

export type ReportListItem = typeof reports.$inferSelect & { periodLabel: string | null; sectionCount: number; draftedCount: number; words: number };

export async function listReports(): Promise<ReportListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      r: reports,
      periodLabel: periods.label,
      sectionCount: sql<number>`(select count(*)::int from report_sections s where s.report_id = ${reports.id})`,
      draftedCount: sql<number>`(select count(*)::int from report_sections s where s.report_id = ${reports.id} and length(s.content) > 0)`,
      words: sql<number>`(select coalesce(sum(array_length(regexp_split_to_array(trim(s.content), '\\s+'), 1)), 0)::int from report_sections s where s.report_id = ${reports.id} and length(trim(s.content)) > 0)`,
    })
    .from(reports)
    .leftJoin(periods, eq(periods.id, reports.periodId))
    .where(isNull(reports.deletedAt))
    .orderBy(desc(reports.updatedAt));
  return rows.map((r) => ({ ...r.r, periodLabel: r.periodLabel, sectionCount: Number(r.sectionCount), draftedCount: Number(r.draftedCount), words: Number(r.words) }));
}

export type SectionRow = typeof reportSections.$inferSelect;

export async function getReport(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ r: reports, periodLabel: periods.label, periodStart: periods.startDate, periodEnd: periods.endDate })
    .from(reports)
    .leftJoin(periods, eq(periods.id, reports.periodId))
    .where(eq(reports.id, id))
    .limit(1);
  if (!row) return null;
  const sections = await db.select().from(reportSections).where(eq(reportSections.reportId, id)).orderBy(asc(reportSections.sort));
  const resolved = await resolveEntities((row.r.sources as SourceRef[]).filter((s) => isEntityType(s.type)) as EntityRef[]);
  const sources = (row.r.sources as SourceRef[]).map((s) => {
    const r = resolved.get(`${s.type}:${s.id}`);
    return { type: s.type, id: s.id, title: r?.title ?? "—", href: r?.href ?? "#", missing: !r };
  });
  return { ...row.r, periodLabel: row.periodLabel, periodStart: row.periodStart, periodEnd: row.periodEnd, sections, sourceItems: sources };
}

export async function setReportSources(id: string, list: { type: string; id: string }[]) {
  const parsed = z.array(sourceSchema).max(200).parse(list);
  const unique = [...new Map(parsed.map((s) => [`${s.type}:${s.id}`, s])).values()];
  const db = await getDb();
  await db.update(reports).set({ sources: unique, updatedAt: new Date() }).where(eq(reports.id, id));
  return unique;
}

export const sectionPatchSchema = z.object({
  heading: z.string().trim().min(1).max(300).optional(),
  guidance: z.string().max(4000).nullish(),
  wordLimit: z.number().int().min(10).max(20000).nullish(),
  content: z.string().max(200_000).optional(),
  citations: z.array(z.object({ n: z.number().int(), sourceType: z.string(), sourceId: z.string(), title: z.string(), page: z.number().int().nullish(), quote: z.string().optional() })).optional(),
});

export async function addSection(reportId: string, input: { heading: string; guidance?: string | null; wordLimit?: number | null; afterId?: string | null }) {
  const db = await getDb();
  const list = await db.select().from(reportSections).where(eq(reportSections.reportId, reportId)).orderBy(asc(reportSections.sort));
  let sort = (list.at(-1)?.sort ?? 0) + 10;
  if (input.afterId) {
    const idx = list.findIndex((s) => s.id === input.afterId);
    if (idx >= 0) {
      const next = list[idx + 1];
      sort = next ? Math.floor((list[idx]!.sort + next.sort) / 2) : list[idx]!.sort + 10;
      if (next && sort === list[idx]!.sort) {
        // No room between the two: renumber everything.
        await renumber(reportId);
        return addSection(reportId, input);
      }
    }
  }
  const [row] = await db
    .insert(reportSections)
    .values({ reportId, sort, heading: input.heading.trim() || "Section", guidance: input.guidance ?? null, wordLimit: input.wordLimit ?? null })
    .returning();
  await touch(reportId);
  return row!;
}

async function renumber(reportId: string) {
  const db = await getDb();
  const list = await db.select({ id: reportSections.id }).from(reportSections).where(eq(reportSections.reportId, reportId)).orderBy(asc(reportSections.sort));
  for (const [i, s] of list.entries()) await db.update(reportSections).set({ sort: (i + 1) * 10 }).where(eq(reportSections.id, s.id));
}

export async function updateSection(id: string, raw: z.input<typeof sectionPatchSchema>, opts: { generated?: boolean } = {}) {
  const patch = sectionPatchSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .update(reportSections)
    .set({
      ...patch,
      citations: (patch.citations as Citation[] | undefined) ?? undefined,
      ...(opts.generated ? { generatedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(reportSections.id, id))
    .returning();
  if (row) await touch(row.reportId);
  return row ?? null;
}

/** A section with the report it belongs to, and the other headings (so a draft does not repeat them). */
export async function getSection(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ s: reportSections, r: reports, periodLabel: periods.label, periodStart: periods.startDate, periodEnd: periods.endDate })
    .from(reportSections)
    .innerJoin(reports, eq(reports.id, reportSections.reportId))
    .leftJoin(periods, eq(periods.id, reports.periodId))
    .where(eq(reportSections.id, id))
    .limit(1);
  if (!row || row.r.deletedAt) return null;
  const others = await db
    .select({ id: reportSections.id, heading: reportSections.heading })
    .from(reportSections)
    .where(eq(reportSections.reportId, row.r.id))
    .orderBy(asc(reportSections.sort));
  return {
    section: row.s,
    report: row.r,
    period: row.periodLabel ? { label: row.periodLabel, start: row.periodStart!, end: row.periodEnd! } : null,
    otherHeadings: others.filter((o) => o.id !== id).map((o) => o.heading),
  };
}

/* ------------------------------ Number check ------------------------------- */

export type NumberCheckItem = {
  quote: string;
  status: "match" | "mismatch" | "not_in_iptt";
  indicatorCode: string | null;
  ipttValue: string | null;
  note: string;
};
export type NumberCheck = { at: string; hash: string; periodLabel: string | null; items: NumberCheckItem[] };

/** Short fingerprint of a section's text, so a check knows when the text has changed since. */
export function textHash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The last check of a section, or null when it was never checked (old rows hold an empty list). */
export function numberCheckOf(raw: unknown): NumberCheck | null {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return null;
  const c = raw as Partial<NumberCheck>;
  return typeof c.at === "string" && typeof c.hash === "string" && Array.isArray(c.items) ? { at: c.at, hash: c.hash, periodLabel: c.periodLabel ?? null, items: c.items } : null;
}

export async function setSectionChecks(id: string, check: NumberCheck | null) {
  const db = await getDb();
  await db
    .update(reportSections)
    .set({ numberChecks: check ?? [] })
    .where(eq(reportSections.id, id));
}

/* ---------------------------------- Drafts ---------------------------------- */

export async function setSectionDraft(id: string, draft: SectionDraft | null) {
  const db = await getDb();
  const [row] = await db.update(reportSections).set({ draft }).where(eq(reportSections.id, id)).returning();
  return row ?? null;
}

/** [n] markers shifted so an appended draft keeps its own sources after the ones already there. Other brackets stay as written. */
export function shiftCitations(content: string, citations: Citation[], offset: number) {
  if (!offset) return { content, citations };
  const known = new Set(citations.map((c) => c.n));
  return {
    content: content.replace(/\[(\d+)\]/g, (m, n: string) => (known.has(Number(n)) ? `[${Number(n) + offset}]` : m)),
    citations: citations.map((c) => ({ ...c, n: c.n + offset })),
  };
}

/** "Kullan" puts Claude's draft in place of the text; "Sonuna ekle" adds it after. Either way the draft is hers now. */
export async function acceptDraft(id: string, mode: "replace" | "append") {
  const db = await getDb();
  const [row] = await db.select().from(reportSections).where(eq(reportSections.id, id)).limit(1);
  if (!row?.draft) throw new UserError("Bekleyen bir taslak yok.");
  const draft = row.draft;
  let content = draft.content;
  let citations = draft.citations;
  if (mode === "append" && row.content.trim()) {
    const offset = Math.max(0, ...row.citations.map((c) => c.n));
    const shifted = shiftCitations(draft.content, draft.citations, offset);
    content = `${row.content.trimEnd()}\n\n${shifted.content}`;
    citations = [...row.citations, ...shifted.citations];
  }
  const [saved] = await db
    .update(reportSections)
    .set({ content, citations, draft: null, numberChecks: [], generatedAt: new Date(), updatedAt: new Date() })
    .where(eq(reportSections.id, id))
    .returning();
  await touch(row.reportId);
  await logActivity({ action: "update", entityType: "report", entityId: row.reportId, title: row.heading, summary: mode === "append" ? "draft appended" : "draft used" });
  return saved!;
}

/* ------------------------------ Source ideas -------------------------------- */

export type SourceIdea = { type: EntityType; id: string; title: string; href: string; reason: "period" | "dates" | "values" };

/**
 * "Dönemden öner": what the report's period points to. Files filed under
 * the period, meetings, decisions and notes dated inside it, and the
 * indicators with approved values for it. She ticks what to add.
 */
export async function suggestReportSources(reportId: string): Promise<SourceIdea[]> {
  const r = await getReport(reportId);
  if (!r) return [];
  const have = new Set((r.sources as SourceRef[]).map((s) => `${s.type}:${s.id}`));
  const db = await getDb();
  const end = r.periodEnd ?? new Date().toISOString().slice(0, 10);
  const start = r.periodStart ?? new Date(Date.now() - 92 * 86_400_000).toISOString().slice(0, 10);
  const out: SourceIdea[] = [];
  const push = (type: EntityType, id: string, title: string, meta: Record<string, unknown>, reason: SourceIdea["reason"]) => {
    const key = `${type}:${id}`;
    if (have.has(key)) return;
    have.add(key);
    out.push({ type, id, title, href: ENTITIES[type].href(id, meta), reason });
  };
  if (r.periodId) {
    const filed = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(and(eq(documents.periodId, r.periodId), isNull(documents.deletedAt), eq(documents.aiOff, false), eq(documents.childDataFlag, false)))
      .orderBy(desc(documents.createdAt))
      .limit(40);
    for (const d of filed) push("document", d.id, d.title, {}, "period");
    const valued = await db
      .selectDistinct({ id: indicatorValues.indicatorId })
      .from(indicatorValues)
      .where(and(eq(indicatorValues.periodId, r.periodId), eq(indicatorValues.status, "approved")));
    if (valued.length) {
      const resolved = await resolveEntities(valued.map((v) => ({ type: "indicator" as const, id: v.id })));
      for (const v of valued) {
        const e = resolved.get(`indicator:${v.id}`);
        if (e) push("indicator", v.id, e.title, {}, "values");
      }
    }
  }
  const dated = await db
    .select({ type: searchIndex.entityType, id: searchIndex.entityId, title: searchIndex.title, meta: searchIndex.meta })
    .from(searchIndex)
    .where(
      and(
        inArray(searchIndex.entityType, ["meeting", "decision", "note", "document"]),
        eq(searchIndex.aiOff, false),
        gte(searchIndex.occurredAt, new Date(`${start}T00:00:00+03:00`)),
        lte(searchIndex.occurredAt, new Date(`${end}T23:59:59+03:00`)),
      ),
    )
    .orderBy(desc(searchIndex.occurredAt))
    .limit(60);
  for (const d of dated) if (isEntityType(d.type)) push(d.type, d.id, d.title, (d.meta ?? {}) as Record<string, unknown>, "dates");
  return out.slice(0, 60);
}

/** A copy for the next period: the same sections and guidance, with empty text and no sources (the new period has its own). */
export async function duplicateReport(id: string, input: { title: string; periodId: string | null; dueDate?: string | null }) {
  const r = await getReport(id);
  if (!r) throw new UserError("Rapor bulunamadı.");
  const db = await getDb();
  const [row] = await db
    .insert(reports)
    .values({ title: input.title.trim() || r.title, templateId: r.templateId, periodId: input.periodId, dueDate: input.dueDate ?? null, audience: r.audience, language: r.language, sources: [] })
    .returning();
  await db.insert(reportSections).values(r.sections.map((s, i) => ({ reportId: row!.id, sort: (i + 1) * 10, heading: s.heading, guidance: s.guidance, wordLimit: s.wordLimit })));
  await logActivity({ action: "create", entityType: "report", entityId: row!.id, title: row!.title, summary: `copy of ${r.title}` });
  await indexReport(row!.id);
  return row!;
}

export async function reorderSections(reportId: string, ids: string[]) {
  const db = await getDb();
  for (const [i, id] of ids.entries()) {
    await db.update(reportSections).set({ sort: (i + 1) * 10 }).where(and(eq(reportSections.id, id), eq(reportSections.reportId, reportId)));
  }
  await touch(reportId);
}

export async function deleteSection(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(reportSections).where(eq(reportSections.id, id)).limit(1);
  if (!row) return null;
  const [{ n } = { n: 0 }] = (await db.select({ n: sql<number>`count(*)::int` }).from(reportSections).where(eq(reportSections.reportId, row.reportId))) as { n: number }[];
  if (Number(n) <= 1) throw new UserError("Bir raporda en az bir bölüm kalmalı.");
  await db.delete(reportSections).where(eq(reportSections.id, id));
  await touch(row.reportId);
  return row;
}

async function touch(reportId: string) {
  const db = await getDb();
  await db.update(reports).set({ updatedAt: new Date() }).where(eq(reports.id, reportId));
  await indexReport(reportId);
}

/** Save the report's sections as one of her report templates (reused every period). */
export async function sectionsAsTemplate(reportId: string) {
  const r = await getReport(reportId);
  if (!r) return null;
  return r.sections.map((s) => ({ heading: s.heading, guidance: s.guidance ?? undefined, wordLimit: s.wordLimit }));
}

export async function indexReport(id: string) {
  const db = await getDb();
  const [r] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!r || r.deletedAt) return unindexRecord("report", id);
  const sections = await db.select({ heading: reportSections.heading, content: reportSections.content }).from(reportSections).where(eq(reportSections.reportId, id)).orderBy(asc(reportSections.sort));
  await indexRecord({
    type: "report",
    id,
    title: r.title,
    body: sections.map((s) => `${s.heading}\n${s.content.replace(/\[\d+\]/g, "")}`).join("\n\n"),
    meta: { status: r.status, periodId: r.periodId, dueDate: r.dueDate },
    occurredAt: r.updatedAt,
  });
}

/* --------------------------------- Visuals ---------------------------------- */

export const VISUAL_KINDS = ["chart", "onepager"] as const;

export const visualInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(VISUAL_KINDS).default("chart"),
  spec: z.record(z.string(), z.unknown()),
  dataSource: z.record(z.string(), z.unknown()).nullish(),
  reportId: z.string().uuid().nullish(),
});

export async function createVisual(raw: z.input<typeof visualInputSchema>, actor: Actor = "user") {
  const input = visualInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .insert(visuals)
    .values({ title: input.title, kind: input.kind, spec: input.spec, dataSource: input.dataSource ?? null, reportId: input.reportId ?? null })
    .returning();
  await logActivity({ action: "create", entityType: "visual", entityId: row!.id, title: row!.title, actor });
  await indexVisual(row!.id);
  return row!;
}

export async function updateVisual(id: string, raw: Partial<z.input<typeof visualInputSchema>>) {
  const patch = onlyGiven(raw, visualInputSchema.partial().parse(raw));
  const db = await getDb();
  const [row] = await db.update(visuals).set({ ...patch, updatedAt: new Date() }).where(eq(visuals.id, id)).returning();
  if (row) await indexVisual(id);
  return row ?? null;
}

export async function listVisuals(opts: { reportId?: string } = {}) {
  const db = await getDb();
  const where = [isNull(visuals.deletedAt)];
  if (opts.reportId) where.push(eq(visuals.reportId, opts.reportId));
  return db
    .select()
    .from(visuals)
    .where(and(...where))
    .orderBy(desc(visuals.updatedAt));
}

export async function getVisual(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(visuals).where(eq(visuals.id, id)).limit(1);
  return row ?? null;
}

export async function indexVisual(id: string) {
  const v = await getVisual(id);
  if (!v || v.deletedAt) return unindexRecord("visual", id);
  await indexRecord({ type: "visual", id, title: v.title, body: v.kind, meta: { kind: v.kind, reportId: v.reportId }, occurredAt: v.updatedAt });
}
