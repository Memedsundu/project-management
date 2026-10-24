import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { todayStr } from "@/lib/dates";
import { onlyGiven } from "@/lib/patch";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { activities, documents, indicators, indicatorTargets, indicatorValues, logframeNodes, organisations, periods } from "@/server/db/schema";
import { checkForChildData } from "@/server/files/child-guard";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { getSetting } from "./settings";

/**
 * The logframe and its indicators, in the shape of an IPTT (Indicator
 * Performance Tracking Table): baseline, targets and actual totals per period,
 * with a source for every number. Values are totals only; no field can hold
 * an individual child.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* --------------------------------- Logframe --------------------------------- */

export const LOGFRAME_LEVELS = ["goal", "outcome", "output"] as const;
export type LogframeLevel = (typeof LOGFRAME_LEVELS)[number];

export const nodeInputSchema = z.object({
  parentId: z.string().uuid().nullish(),
  level: z.enum(LOGFRAME_LEVELS),
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10000).nullish(),
});

export async function createLogframeNode(raw: z.input<typeof nodeInputSchema>) {
  const input = nodeInputSchema.parse(raw);
  const db = await getDb();
  const [{ max } = { max: 0 }] = (await db.select({ max: sql<number>`coalesce(max(${logframeNodes.sort}), 0)::int` }).from(logframeNodes)) as { max: number }[];
  const [row] = await db
    .insert(logframeNodes)
    .values({ ...input, parentId: input.parentId ?? null, sort: Number(max) + 10 })
    .returning();
  await logActivity({ action: "create", entityType: "logframe", entityId: row!.id, title: `${row!.code} ${row!.title}` });
  await indexLogframeNode(row!.id);
  return row!;
}

export async function updateLogframeNode(id: string, raw: Partial<z.input<typeof nodeInputSchema>> & { sort?: number }) {
  const patch = nodeInputSchema.partial().extend({ sort: z.number().int().optional() }).parse(raw);
  if (patch.parentId === id) throw new UserError("Bir öğe kendi altına taşınamaz.");
  const db = await getDb();
  const [row] = await db.update(logframeNodes).set({ ...patch, updatedAt: new Date() }).where(eq(logframeNodes.id, id)).returning();
  if (!row) return null;
  await logActivity({ action: "update", entityType: "logframe", entityId: id, title: `${row.code} ${row.title}`, summary: Object.keys(patch).join(", ") });
  await indexLogframeNode(id);
  return row;
}

export type LogframeTreeNode = typeof logframeNodes.$inferSelect & {
  children: LogframeTreeNode[];
  indicators: { id: string; code: string; name: string }[];
  activities: { id: string; code: string; title: string; status: string; startDate: string | null; endDate: string | null }[];
};

/** Goal → outcomes → outputs, each with its indicators and (for outputs) activities. */
export async function listLogframe(): Promise<LogframeTreeNode[]> {
  const db = await getDb();
  const [nodes, inds, acts] = await Promise.all([
    db.select().from(logframeNodes).where(isNull(logframeNodes.deletedAt)).orderBy(asc(logframeNodes.sort), asc(logframeNodes.code)),
    db
      .select({ id: indicators.id, code: indicators.code, name: indicators.name, nodeId: indicators.logframeNodeId })
      .from(indicators)
      .where(isNull(indicators.deletedAt))
      .orderBy(asc(indicators.sort), asc(indicators.code)),
    db
      .select({ id: activities.id, code: activities.code, title: activities.title, status: activities.status, startDate: activities.startDate, endDate: activities.endDate, nodeId: activities.logframeNodeId })
      .from(activities)
      .where(isNull(activities.deletedAt))
      .orderBy(asc(activities.sort), asc(activities.code)),
  ]);
  const byId = new Map<string, LogframeTreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [], indicators: [], activities: [] });
  for (const i of inds) if (i.nodeId) byId.get(i.nodeId)?.indicators.push({ id: i.id, code: i.code, name: i.name });
  for (const a of acts) if (a.nodeId) byId.get(a.nodeId)?.activities.push({ id: a.id, code: a.code, title: a.title, status: a.status, startDate: a.startDate, endDate: a.endDate });
  const roots: LogframeTreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export async function listLogframeFlat() {
  const db = await getDb();
  return db
    .select({ id: logframeNodes.id, code: logframeNodes.code, title: logframeNodes.title, level: logframeNodes.level, parentId: logframeNodes.parentId })
    .from(logframeNodes)
    .where(isNull(logframeNodes.deletedAt))
    .orderBy(asc(logframeNodes.sort), asc(logframeNodes.code));
}

export async function indexLogframeNode(id: string) {
  const db = await getDb();
  const [n] = await db.select().from(logframeNodes).where(eq(logframeNodes.id, id)).limit(1);
  if (!n || n.deletedAt) return unindexRecord("logframe", id);
  await indexRecord({
    type: "logframe",
    id,
    title: `${n.code} ${n.title}`,
    body: [n.level, n.description].filter(Boolean).join("\n"),
    meta: { level: n.level },
    occurredAt: n.updatedAt,
  });
}

/* --------------------------------- Periods ---------------------------------- */

export const PERIOD_KINDS = ["month", "quarter", "half", "year", "custom"] as const;

export const periodSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    kind: z.enum(PERIOD_KINDS).default("quarter"),
    startDate: day,
    endDate: day,
  })
  .refine((p) => p.endDate >= p.startDate, { message: "Bitiş başlangıçtan önce olamaz." });

export async function listPeriods() {
  const db = await getDb();
  return db.select().from(periods).orderBy(asc(periods.startDate), asc(periods.label));
}

export type PeriodRow = typeof periods.$inferSelect;

/**
 * Quarters for every project year. A January start gives calendar quarters
 * ("2026 Q1"); any other month gives project quarters ("Y1 Q1" = Sep–Nov).
 */
export function quarterRows(startYear: number, endYear: number, startMonth = 1) {
  const years = Math.max(1, endYear - startYear + (startMonth === 1 ? 1 : 0));
  const rows: { label: string; kind: string; startDate: string; endDate: string }[] = [];
  for (let y = 0; y < years; y++) {
    for (let q = 0; q < 4; q++) {
      const first = new Date(Date.UTC(startYear + y, startMonth - 1 + q * 3, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 3, 0));
      const label = startMonth === 1 ? `${startYear + y} Q${q + 1}` : `Y${y + 1} Q${q + 1}`;
      rows.push({ label, kind: "quarter", startDate: first.toISOString().slice(0, 10), endDate: last.toISOString().slice(0, 10) });
    }
  }
  return rows;
}

/** Quarters made once, so indicators have columns from day one. */
export async function ensureProjectPeriods() {
  const db = await getDb();
  const existing = await db.select({ id: periods.id }).from(periods).limit(1);
  if (existing.length) return 0;
  const profile = await getSetting("profile");
  const rows = quarterRows(profile.startYear, profile.endYear);
  if (rows.length) await db.insert(periods).values(rows);
  return rows.length;
}

/** The IPTT's columns: the quarters (every period when there are none). Months, halves and years stay for reports. */
export function columnPeriods<T extends { kind: string }>(all: T[]) {
  return all.filter((p) => p.kind === "quarter" || all.every((q) => q.kind !== "quarter"));
}

/** A new quarter layout, for a project whose year starts in another month. Only while no quarter holds a value; their targets go. */
export async function rebuildQuarters(startMonth: number) {
  const month = z.number().int().min(1).max(12).parse(startMonth);
  const db = await getDb();
  const quarterIds = (await listPeriods()).filter((p) => p.kind === "quarter").map((p) => p.id);
  if (quarterIds.length) {
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(indicatorValues).where(inArray(indicatorValues.periodId, quarterIds));
    if (Number(used?.n ?? 0) > 0) throw new UserError("Çeyreklere girilmiş değerler var. Düzen yalnızca hiç değer yokken değişir.");
    await db.delete(periods).where(inArray(periods.id, quarterIds));
  }
  const profile = await getSetting("profile");
  const rows = quarterRows(profile.startYear, profile.endYear, month);
  await db.insert(periods).values(rows);
  return rows.length;
}

export async function savePeriod(id: string | null, raw: z.input<typeof periodSchema>) {
  const input = periodSchema.parse(raw);
  const db = await getDb();
  if (id) {
    const [row] = await db.update(periods).set(input).where(eq(periods.id, id)).returning();
    return row ?? null;
  }
  const [row] = await db.insert(periods).values(input).returning();
  return row!;
}

export async function deletePeriod(id: string) {
  const db = await getDb();
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(indicatorValues).where(eq(indicatorValues.periodId, id));
  if (Number(used?.n ?? 0) > 0) throw new UserError("Bu döneme girilmiş değerler var; önce onları taşı ya da sil.");
  await db.delete(periods).where(eq(periods.id, id));
}

/** "2026 Q3", "2026-07", "2026 H2" or "2026" to a period row, when one matches. */
export async function periodForLabel(label: string | null | undefined) {
  if (!label) return null;
  const db = await getDb();
  const norm = label.trim().toUpperCase().replace(/\s+/g, " ");
  const all = await db.select().from(periods);
  return all.find((p) => p.label.trim().toUpperCase().replace(/\s+/g, " ") === norm) ?? null;
}

export async function periodContaining(dayStr: string, kind = "quarter") {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.kind, kind), sql`${periods.startDate} <= ${dayStr}`, sql`${periods.endDate} >= ${dayStr}`))
    .limit(1);
  return row ?? null;
}

/* -------------------------------- Indicators -------------------------------- */

export const INDICATOR_UNITS = ["number", "percent", "text"] as const;

const num = z.union([z.number(), z.string().trim().regex(/^-?\d+([.,]\d+)?$/)]).transform((v) => Number(String(v).replace(",", ".")));

export const indicatorInputSchema = z.object({
  logframeNodeId: z.string().uuid().nullish(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(500),
  definition: z.string().max(10000).nullish(),
  unit: z.enum(INDICATOR_UNITS).default("number"),
  disaggregation: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  baseline: num.nullish(),
  baselineDate: day.nullish(),
  lopTarget: num.nullish(),
  dataSource: z.string().max(1000).nullish(),
  frequency: z.string().max(60).nullish(),
  responsibleOrgId: z.string().uuid().nullish(),
  meansOfVerification: z.string().max(2000).nullish(),
  direction: z.enum(["increase", "decrease"]).default("increase"),
  cumulative: z.boolean().default(true),
});
export type IndicatorInput = z.input<typeof indicatorInputSchema>;

const numText = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : String(v));

export async function createIndicator(raw: IndicatorInput, actor: Actor = "user") {
  const input = indicatorInputSchema.parse(raw);
  const db = await getDb();
  const [{ max } = { max: 0 }] = (await db.select({ max: sql<number>`coalesce(max(${indicators.sort}), 0)::int` }).from(indicators)) as { max: number }[];
  const [row] = await db
    .insert(indicators)
    .values({ ...input, baseline: numText(input.baseline), lopTarget: numText(input.lopTarget), sort: Number(max) + 10 })
    .returning();
  await logActivity({ action: "create", entityType: "indicator", entityId: row!.id, title: `${row!.code} ${row!.name}`, actor });
  await indexIndicator(row!.id);
  return row!;
}

export async function updateIndicator(id: string, raw: Partial<IndicatorInput> & { sort?: number }) {
  const patch = onlyGiven(raw, indicatorInputSchema.partial().extend({ sort: z.number().int().optional() }).parse(raw));
  const db = await getDb();
  const values: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if ("baseline" in patch) values.baseline = numText(patch.baseline);
  if ("lopTarget" in patch) values.lopTarget = numText(patch.lopTarget);
  const [row] = await db.update(indicators).set(values).where(eq(indicators.id, id)).returning();
  if (!row) return null;
  await logActivity({ action: "update", entityType: "indicator", entityId: id, title: `${row.code} ${row.name}`, summary: Object.keys(patch).join(", ") });
  await indexIndicator(id);
  return row;
}

export type IndicatorRow = typeof indicators.$inferSelect;

export async function listIndicators() {
  const db = await getDb();
  return db
    .select({ i: indicators, nodeCode: logframeNodes.code, nodeTitle: logframeNodes.title, nodeLevel: logframeNodes.level })
    .from(indicators)
    .leftJoin(logframeNodes, eq(logframeNodes.id, indicators.logframeNodeId))
    .where(isNull(indicators.deletedAt))
    .orderBy(asc(indicators.sort), asc(indicators.code));
}

export type ValueView = typeof indicatorValues.$inferSelect & {
  periodLabel: string;
  orgName: string | null;
  sourceTitle: string | null;
};

export async function getIndicator(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ i: indicators, nodeCode: logframeNodes.code, nodeTitle: logframeNodes.title })
    .from(indicators)
    .leftJoin(logframeNodes, eq(logframeNodes.id, indicators.logframeNodeId))
    .where(eq(indicators.id, id))
    .limit(1);
  if (!row) return null;
  const [targets, values] = await Promise.all([
    db.select().from(indicatorTargets).where(eq(indicatorTargets.indicatorId, id)),
    listValues({ indicatorIds: [id] }),
  ]);
  return { ...row.i, nodeCode: row.nodeCode, nodeTitle: row.nodeTitle, targets, values };
}

export async function listValues(opts: { indicatorIds?: string[]; status?: "approved" | "proposed"; documentId?: string } = {}): Promise<ValueView[]> {
  const db = await getDb();
  const where = [];
  if (opts.indicatorIds?.length) where.push(inArray(indicatorValues.indicatorId, opts.indicatorIds));
  if (opts.status) where.push(eq(indicatorValues.status, opts.status));
  if (opts.documentId) where.push(eq(indicatorValues.sourceDocumentId, opts.documentId));
  const rows = await db
    .select({ v: indicatorValues, periodLabel: periods.label, periodStart: periods.startDate, orgName: organisations.name, sourceTitle: documents.title })
    .from(indicatorValues)
    .innerJoin(periods, eq(periods.id, indicatorValues.periodId))
    .leftJoin(organisations, eq(organisations.id, indicatorValues.organisationId))
    .leftJoin(documents, eq(documents.id, indicatorValues.sourceDocumentId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(periods.startDate), desc(indicatorValues.createdAt));
  return rows.map((r) => ({ ...r.v, periodLabel: r.periodLabel, orgName: r.orgName, sourceTitle: r.sourceTitle }));
}

export async function indexIndicator(id: string) {
  const db = await getDb();
  const [i] = await db.select().from(indicators).where(eq(indicators.id, id)).limit(1);
  if (!i || i.deletedAt) return unindexRecord("indicator", id);
  await indexRecord({
    type: "indicator",
    id,
    title: `${i.code} ${i.name}`,
    body: [i.definition, i.dataSource, i.meansOfVerification, i.disaggregation.join(", ")].filter(Boolean).join("\n"),
    meta: { unit: i.unit, nodeId: i.logframeNodeId, orgIds: i.responsibleOrgId ? [i.responsibleOrgId] : [] },
    occurredAt: i.updatedAt,
  });
}

/** Replace targets for many periods at once. A null value clears the target. */
export async function setTargets(indicatorId: string, list: { periodId: string; value: number | string | null }[]) {
  const db = await getDb();
  for (const t of list) {
    const value = t.value === null || t.value === "" ? null : Number(String(t.value).replace(",", "."));
    if (value === null || Number.isNaN(value)) {
      await db.delete(indicatorTargets).where(and(eq(indicatorTargets.indicatorId, indicatorId), eq(indicatorTargets.periodId, t.periodId)));
      continue;
    }
    await db
      .insert(indicatorTargets)
      .values({ indicatorId, periodId: t.periodId, value: String(value) })
      .onConflictDoUpdate({ target: [indicatorTargets.indicatorId, indicatorTargets.periodId], set: { value: String(value) } });
  }
  await db.update(indicators).set({ updatedAt: new Date() }).where(eq(indicators.id, indicatorId));
}

/* ---------------------------------- Values ---------------------------------- */

export const valueInputSchema = z.object({
  indicatorId: z.string().uuid(),
  periodId: z.string().uuid(),
  value: num,
  disaggregation: z.record(z.string().max(40), z.string().trim().min(1).max(40)).nullish(),
  organisationId: z.string().uuid().nullish(),
  sourceDocumentId: z.string().uuid().nullish(),
  sourcePage: z.number().int().min(1).max(100000).nullish(),
  sourceNote: z.string().max(1000).nullish(),
  status: z.enum(["approved", "proposed"]).default("approved"),
});
export type ValueInput = z.input<typeof valueInputSchema>;

async function checkValue(input: z.output<typeof valueInputSchema>) {
  const db = await getDb();
  const [ind] = await db.select().from(indicators).where(eq(indicators.id, input.indicatorId)).limit(1);
  if (!ind || ind.deletedAt) throw new UserError("Gösterge bulunamadı.");
  const dims = new Set(ind.disaggregation);
  const dis = input.disaggregation && Object.keys(input.disaggregation).length ? input.disaggregation : null;
  if (dis) {
    for (const k of Object.keys(dis)) {
      if (!dims.has(k)) throw new UserError(`"${k}" bu göstergenin ayrıştırma başlıklarından biri değil.`);
    }
  }
  if (ind.unit === "percent" && (input.value < 0 || input.value > 100)) {
    throw new UserError("Yüzde 0 ile 100 arasında olmalı.");
  }
  if (input.sourceNote && checkForChildData({ text: input.sourceNote }).flag) {
    throw new UserError("Bu not bir çocuğa ait kişisel veri içeriyor gibi görünüyor. Yalnızca toplamları yaz.");
  }
  return { ind, dis };
}

export async function addIndicatorValue(raw: ValueInput, actor: Actor = "user") {
  const input = valueInputSchema.parse(raw);
  const { ind, dis } = await checkValue(input);
  const db = await getDb();
  const [row] = await db
    .insert(indicatorValues)
    .values({
      ...input,
      value: String(input.value),
      disaggregation: dis,
      organisationId: input.organisationId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      sourcePage: input.sourcePage ?? null,
      sourceNote: input.sourceNote ?? null,
      approvedAt: input.status === "approved" ? new Date() : null,
    })
    .returning();
  await db.update(indicators).set({ updatedAt: new Date() }).where(eq(indicators.id, ind.id));
  await logActivity({ action: "add_value", entityType: "indicator", entityId: ind.id, title: `${ind.code} ${ind.name}`, summary: String(input.value), actor });
  return row!;
}

export async function updateIndicatorValue(id: string, raw: Partial<ValueInput>) {
  const db = await getDb();
  const [before] = await db.select().from(indicatorValues).where(eq(indicatorValues.id, id)).limit(1);
  if (!before) return null;
  const merged = valueInputSchema.parse({
    indicatorId: before.indicatorId,
    periodId: before.periodId,
    value: Number(before.value),
    disaggregation: before.disaggregation,
    organisationId: before.organisationId,
    sourceDocumentId: before.sourceDocumentId,
    sourcePage: before.sourcePage,
    sourceNote: before.sourceNote,
    status: before.status as "approved" | "proposed",
    ...raw,
  });
  const { dis } = await checkValue(merged);
  const [row] = await db
    .update(indicatorValues)
    .set({
      periodId: merged.periodId,
      value: String(merged.value),
      disaggregation: dis,
      organisationId: merged.organisationId ?? null,
      sourceDocumentId: merged.sourceDocumentId ?? null,
      sourcePage: merged.sourcePage ?? null,
      sourceNote: merged.sourceNote ?? null,
      status: merged.status,
      approvedAt: merged.status === "approved" ? (before.approvedAt ?? new Date()) : null,
    })
    .where(eq(indicatorValues.id, id))
    .returning();
  return row ?? null;
}

export async function approveIndicatorValues(ids: string[]) {
  if (!ids.length) return 0;
  const db = await getDb();
  const rows = await db
    .update(indicatorValues)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(inArray(indicatorValues.id, ids), eq(indicatorValues.status, "proposed")))
    .returning({ id: indicatorValues.id });
  return rows.length;
}

export async function deleteIndicatorValue(id: string) {
  const db = await getDb();
  const [row] = await db.delete(indicatorValues).where(eq(indicatorValues.id, id)).returning();
  if (row) await logActivity({ action: "delete_value", entityType: "indicator", entityId: row.indicatorId, summary: row.value });
  return row ?? null;
}

/* ----------------------------------- IPTT ----------------------------------- */

type RawValue = { organisationId: string | null; value: number; disaggregation: Record<string, string> | null; status: string };

/**
 * The total one partner reported for one period. Values can come as a total,
 * by one dimension (sex) or as a full cross-table (sex × age); the most
 * aggregated level present is used so nothing is counted twice.
 */
export function totalOf(rows: RawValue[], dims: string[], unit: string): number | null {
  if (!rows.length) return null;
  const pick = (list: RawValue[]) => (unit === "percent" ? list.reduce((a, r) => a + r.value, 0) / list.length : list.reduce((a, r) => a + r.value, 0));
  const keysOf = (r: RawValue) => Object.keys(r.disaggregation ?? {});
  const totals = rows.filter((r) => keysOf(r).length === 0);
  if (totals.length) return pick(totals);
  if (unit === "percent") return null; // a percentage per group has no single total without weights
  for (const d of dims) {
    const single = rows.filter((r) => {
      const k = keysOf(r);
      return k.length === 1 && k[0] === d;
    });
    if (single.length) return pick(single);
  }
  const maxKeys = Math.max(...rows.map((r) => keysOf(r).length));
  return pick(rows.filter((r) => keysOf(r).length === maxKeys));
}

/** Period total across partners: partner totals are summed (averaged for percentages). */
export function periodActual(rows: RawValue[], dims: string[], unit: string): number | null {
  const byOrg = new Map<string, RawValue[]>();
  for (const r of rows) byOrg.set(r.organisationId ?? "-", [...(byOrg.get(r.organisationId ?? "-") ?? []), r]);
  const parts = [...byOrg.values()].map((list) => totalOf(list, dims, unit)).filter((v): v is number => v !== null);
  if (!parts.length) return null;
  return unit === "percent" ? parts.reduce((a, b) => a + b, 0) / parts.length : parts.reduce((a, b) => a + b, 0);
}

export type IpttCell = { periodId: string; target: number | null; actual: number | null; proposed: number; percent: number | null };

export type IpttRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  nodeCode: string | null;
  nodeId: string | null;
  baseline: number | null;
  lopTarget: number | null;
  direction: string;
  cumulative: boolean;
  responsibleOrgId: string | null;
  cells: IpttCell[];
  toDateTarget: number | null;
  toDateActual: number | null;
  percentToDate: number | null;
  percentOfLop: number | null;
  status: "on_track" | "behind" | "ahead" | "no_data";
  proposedCount: number;
};

const ON_TRACK = 0.9;

export async function ipttTable(opts: { periodIds?: string[]; today?: string } = {}) {
  const today = opts.today ?? todayStr();
  const db = await getDb();
  const allPeriods = await listPeriods();
  const shown = opts.periodIds?.length ? allPeriods.filter((p) => opts.periodIds!.includes(p.id)) : columnPeriods(allPeriods);
  const list = await listIndicators();
  const ids = list.map((r) => r.i.id);
  const [targets, values] = ids.length
    ? await Promise.all([
        db.select().from(indicatorTargets).where(inArray(indicatorTargets.indicatorId, ids)),
        db.select().from(indicatorValues).where(inArray(indicatorValues.indicatorId, ids)),
      ])
    : [[], []];
  const rows: IpttRow[] = list.map(({ i, nodeCode }) => {
    const myTargets = new Map(targets.filter((t) => t.indicatorId === i.id).map((t) => [t.periodId, Number(t.value)]));
    const mine = values.filter((v) => v.indicatorId === i.id);
    const cells: IpttCell[] = shown.map((p) => {
      const inPeriod = mine.filter((v) => v.periodId === p.id);
      const approved = inPeriod
        .filter((v) => v.status === "approved")
        .map((v) => ({ organisationId: v.organisationId, value: Number(v.value), disaggregation: v.disaggregation, status: v.status }));
      const actual = i.unit === "text" ? null : periodActual(approved, i.disaggregation, i.unit);
      const target = myTargets.get(p.id) ?? null;
      const percent = target && actual !== null ? actual / target : null;
      return { periodId: p.id, target, actual, proposed: inPeriod.filter((v) => v.status === "proposed").length, percent };
    });
    // Compare like with like: targets up to the last period that has a reported
    // value, or up to the last ended period when nothing is reported yet.
    let lastReported = -1;
    let lastEnded = -1;
    cells.forEach((c, idx) => {
      if (c.actual !== null) lastReported = idx;
      if (shown[idx]!.endDate < today) lastEnded = idx;
    });
    const cutoff = lastReported >= 0 ? lastReported : lastEnded;
    const upTo = cells.slice(0, cutoff + 1);
    const sum = (list: (number | null)[]) => (list.some((v) => v !== null) ? list.reduce<number>((a, v) => a + (v ?? 0), 0) : null);
    let toDateTarget: number | null;
    let toDateActual: number | null;
    if (i.cumulative) {
      toDateTarget = sum(upTo.map((c) => c.target));
      toDateActual = sum(cells.map((c) => c.actual));
    } else {
      const last = cutoff >= 0 ? cells[cutoff]! : null;
      toDateTarget = last?.target ?? null;
      toDateActual = lastReported >= 0 ? cells[lastReported]!.actual : null;
    }
    const lop = i.lopTarget === null ? null : Number(i.lopTarget);
    const percentToDate = toDateTarget && toDateActual !== null ? toDateActual / toDateTarget : null;
    const percentOfLop = lop && toDateActual !== null ? toDateActual / lop : null;
    let status: IpttRow["status"] = "no_data";
    if (percentToDate !== null) {
      const ratio = i.direction === "decrease" ? 1 / Math.max(percentToDate, 0.0001) : percentToDate;
      status = ratio < ON_TRACK ? "behind" : ratio > 1.1 ? "ahead" : "on_track";
    }
    return {
      id: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      nodeCode,
      nodeId: i.logframeNodeId,
      baseline: i.baseline === null ? null : Number(i.baseline),
      lopTarget: lop,
      direction: i.direction,
      cumulative: i.cumulative,
      responsibleOrgId: i.responsibleOrgId,
      cells,
      toDateTarget,
      toDateActual,
      percentToDate,
      percentOfLop,
      status,
      proposedCount: cells.reduce((a, c) => a + c.proposed, 0),
    };
  });
  return { periods: shown, rows };
}

/** Actual totals by partner and period, for the "by partner" chart. */
export async function actualsByPartner(indicatorId: string) {
  const ind = await getIndicator(indicatorId);
  if (!ind) return null;
  const approved = ind.values.filter((v) => v.status === "approved");
  const out = new Map<string, { orgId: string | null; orgName: string; byPeriod: Map<string, number> }>();
  const byKey = new Map<string, RawValue[]>();
  for (const v of approved) {
    const key = `${v.organisationId ?? "-"}|${v.periodId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), { organisationId: v.organisationId, value: Number(v.value), disaggregation: v.disaggregation, status: v.status }]);
    if (!out.has(v.organisationId ?? "-")) out.set(v.organisationId ?? "-", { orgId: v.organisationId, orgName: v.orgName ?? "—", byPeriod: new Map() });
  }
  for (const [key, list] of byKey) {
    const [org, periodId] = key.split("|") as [string, string];
    const total = totalOf(list, ind.disaggregation, ind.unit);
    if (total !== null) out.get(org)!.byPeriod.set(periodId, total);
  }
  return [...out.values()].map((o) => ({ orgId: o.orgId, orgName: o.orgName, byPeriod: Object.fromEntries(o.byPeriod) }));
}

/** IPTT rows as spreadsheet columns, for the Excel export and report sources. */
export async function ipttSheet(locale: "tr" | "en" = "tr") {
  const { periods: ps, rows } = await ipttTable();
  const L = locale === "en"
    ? { code: "Code", name: "Indicator", unit: "Unit", baseline: "Baseline", lop: "LoP target", target: "target", actual: "actual", pct: "%", toDate: "Actual to date", pctToDate: "% of target to date", pctLop: "% of LoP", status: "Status" }
    : { code: "Kod", name: "Gösterge", unit: "Birim", baseline: "Başlangıç", lop: "Proje hedefi", target: "hedef", actual: "gerçekleşen", pct: "%", toDate: "Bugüne kadar", pctToDate: "Bugünkü hedefe göre %", pctLop: "Proje hedefine göre %", status: "Durum" };
  const statusText: Record<IpttRow["status"], string> =
    locale === "en"
      ? { on_track: "On track", behind: "Behind", ahead: "Ahead", no_data: "No data" }
      : { on_track: "Yolunda", behind: "Geride", ahead: "Önde", no_data: "Veri yok" };
  const columns = [
    { header: L.code, key: "code", width: 10 },
    { header: L.name, key: "name", width: 48 },
    { header: L.unit, key: "unit", width: 10 },
    { header: L.baseline, key: "baseline", width: 12 },
    { header: L.lop, key: "lop", width: 12 },
    ...ps.flatMap((p) => [
      { header: `${p.label} ${L.target}`, key: `t_${p.id}`, width: 12 },
      { header: `${p.label} ${L.actual}`, key: `a_${p.id}`, width: 12 },
    ]),
    { header: L.toDate, key: "toDate", width: 14 },
    { header: L.pctToDate, key: "pctToDate", width: 14, numFmt: "0%" },
    { header: L.pctLop, key: "pctLop", width: 14, numFmt: "0%" },
    { header: L.status, key: "status", width: 12 },
  ];
  const data = rows.map((r) => {
    const row: Record<string, unknown> = {
      code: r.code,
      name: r.name,
      unit: r.unit,
      baseline: r.baseline,
      lop: r.lopTarget,
      toDate: r.toDateActual,
      pctToDate: r.percentToDate,
      pctLop: r.percentOfLop,
      status: statusText[r.status],
    };
    for (const c of r.cells) {
      row[`t_${c.periodId}`] = c.target;
      row[`a_${c.periodId}`] = c.actual;
    }
    return row;
  });
  return { name: "IPTT", columns, rows: data };
}

/** A short plain-text IPTT for Claude (report drafts, number check). */
export async function ipttText(periodId?: string | null) {
  const { periods: ps, rows } = await ipttTable();
  const label = new Map(ps.map((p) => [p.id, p.label]));
  return rows
    .map((r) => {
      const cells = r.cells
        .filter((c) => (periodId ? c.periodId === periodId : c.actual !== null || c.target !== null))
        .map((c) => `${label.get(c.periodId)}: target ${c.target ?? "-"}, actual ${c.actual ?? "-"}`)
        .join("; ");
      return `${r.code} ${r.name} [${r.unit}] baseline ${r.baseline ?? "-"}, LoP target ${r.lopTarget ?? "-"}, to date ${r.toDateActual ?? "-"} of ${r.toDateTarget ?? "-"} (${r.status}). ${cells}`;
    })
    .join("\n");
}

/** One indicator as plain text for Claude: definition, numbers per period and where each value came from. */
export async function indicatorFactsText(id: string) {
  const ind = await getIndicator(id);
  if (!ind || ind.deletedAt) return null;
  const { periods: ps, rows } = await ipttTable();
  const row = rows.find((r) => r.id === id);
  const label = new Map(ps.map((p) => [p.id, p.label]));
  const groups = (d: Record<string, string> | null) => (d ? ` (${Object.entries(d).map(([k, g]) => `${k}: ${g}`).join(", ")})` : "");
  const lines = [
    `${ind.code} ${ind.name}`,
    ind.nodeCode ? `Under ${ind.nodeCode} ${ind.nodeTitle ?? ""}`.trim() : null,
    ind.definition ? `Definition: ${ind.definition}` : null,
    `Unit: ${ind.unit}; ${ind.cumulative ? "cumulative (period values add up)" : "not cumulative (the latest value counts)"}; ${ind.direction === "decrease" ? "lower is better" : "higher is better"}`,
    ind.disaggregation.length ? `Disaggregation: ${ind.disaggregation.join(", ")}` : null,
    `Baseline: ${ind.baseline ?? "-"}${ind.baselineDate ? ` (${ind.baselineDate})` : ""}; life-of-project target: ${ind.lopTarget ?? "-"}`,
    ind.dataSource ? `Data source: ${ind.dataSource}` : null,
    ind.frequency ? `Frequency: ${ind.frequency}` : null,
    ind.meansOfVerification ? `Means of verification: ${ind.meansOfVerification}` : null,
    row ? `To date: ${row.toDateActual ?? "-"} of a target of ${row.toDateTarget ?? "-"} so far (${row.status.replace("_", " ")})` : null,
    row
      ? `Per period: ${
          row.cells
            .filter((c) => c.target !== null || c.actual !== null)
            .map((c) => `${label.get(c.periodId)} target ${c.target ?? "-"}, actual ${c.actual ?? "-"}`)
            .join("; ") || "nothing yet"
        }`
      : null,
    ind.values.length ? "Values:" : "No values yet.",
    ...ind.values.map(
      (v) =>
        `- ${v.periodLabel}: ${Number(v.value)}${groups(v.disaggregation)}${v.orgName ? ` from ${v.orgName}` : ""}${v.sourceTitle ? `, source "${v.sourceTitle}"${v.sourcePage ? ` p. ${v.sourcePage}` : ""}` : ""}${v.sourceNote ? `: "${v.sourceNote}"` : ""}${v.status === "proposed" ? " (proposed, not approved yet)" : ""}`,
    ),
  ];
  return { title: `${ind.code} ${ind.name}`, text: lines.filter(Boolean).join("\n"), date: null as string | null, nodeId: ind.logframeNodeId };
}
