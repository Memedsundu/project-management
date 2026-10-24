import "server-only";
import type {
  IndicatorPageData,
  IndicatorStatus,
  IndicatorsData,
  IpttItem,
  LogframeData,
  LogframeIndicator,
  LogframeItem,
  NodeOption,
  OrgOption,
  PeriodItem,
} from "@/components/indicators/types";
import { todayStr } from "@/lib/dates";
import { aiStatus } from "@/server/ai/client";
import { actualsByPartner, ensureProjectPeriods, getIndicator, ipttTable, listLogframe, listLogframeFlat, listPeriods, type IpttRow, type LogframeTreeNode, type PeriodRow } from "@/server/services/indicators";
import { listLinks } from "@/server/services/links";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { decorateActivities, listActivities, openTaskCounts } from "@/server/services/workplan";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: IndicatorStatus[] = ["behind", "on_track", "ahead", "no_data"];

/** The project year a column belongs to: "Y2" for project quarters, else the calendar year. */
const yearKey = (p: { label: string; startDate: string }) => /^(Y\d+)\b/.exec(p.label)?.[1] ?? p.startDate.slice(0, 4);

const periodItem = (p: PeriodRow): PeriodItem => ({ id: p.id, label: p.label, kind: p.kind, startDate: p.startDate, endDate: p.endDate });

function toItem(r: IpttRow, periods: PeriodRow[], today: string, only?: Set<string>): IpttItem {
  const ended = new Map(periods.map((p) => [p.id, p.endDate < today]));
  return {
    ...r,
    unit: r.unit as IpttItem["unit"],
    direction: r.direction === "decrease" ? "decrease" : "increase",
    cells: r.cells.filter((c) => !only || only.has(c.periodId)).map((c) => ({ ...c, ended: ended.get(c.periodId) ?? false })),
  };
}

function nodeOptions(rows: Awaited<ReturnType<typeof listLogframeFlat>>): NodeOption[] {
  return rows.map((n) => ({ id: n.id, code: n.code, title: n.title, level: n.level as NodeOption["level"], parentId: n.parentId }));
}

function orgOptions(rows: Awaited<ReturnType<typeof listOrganisationsLite>>): OrgOption[] {
  // Partners first: they own most indicators.
  return rows
    .map((o) => ({ id: o.id, name: o.name, shortName: o.shortName, kind: o.kind }))
    .sort((a, b) => Number(b.kind === "partner") - Number(a.kind === "partner") || a.name.localeCompare(b.name, "tr"));
}

/** Göstergeler: the IPTT for one project year (or all), with the to-date totals over every period. */
export async function loadIndicators(sp: SP): Promise<IndicatorsData> {
  await ensureProjectPeriods();
  const today = todayStr();
  const [table, all, nodes, orgs, ai] = await Promise.all([ipttTable({ today }), listPeriods(), listLogframeFlat(), listOrganisationsLite(), aiStatus()]);
  const years = [...new Set(table.periods.map(yearKey))];
  const yearParam = str(sp.year);
  const current = table.periods.find((p) => p.startDate <= today && p.endDate >= today);
  const year = yearParam && (yearParam === "all" || years.includes(yearParam)) ? yearParam : current ? yearKey(current) : (years[0] ?? "all");
  const shown = year === "all" ? table.periods : table.periods.filter((p) => yearKey(p) === year);
  const only = new Set(shown.map((p) => p.id));
  const statusParam = str(sp.status) as IndicatorStatus | undefined;
  const status = statusParam && STATUSES.includes(statusParam) ? statusParam : null;
  const partner = UUID.test(str(sp.partner) ?? "") ? str(sp.partner)! : null;
  const rows = table.rows
    .filter((r) => (!status || r.status === status) && (!partner || r.responsibleOrgId === partner))
    .map((r) => toItem(r, table.periods, today, only));
  return {
    today,
    years,
    year,
    periods: shown.map(periodItem),
    allPeriods: all.map(periodItem),
    periodsLocked: table.rows.some((r) => r.cells.some((c) => c.actual !== null || c.proposed > 0)),
    rows,
    codes: table.rows.map((r) => r.code),
    total: table.rows.length,
    nodes: nodeOptions(nodes),
    orgs: orgOptions(orgs),
    filters: { status, partner },
    aiReady: ai.configured && ai.enabled && !ai.capReached,
  };
}

/** Mantıksal çerçeve: goal → outcomes → outputs, each with its indicators and activities. */
export async function loadLogframe(): Promise<LogframeData> {
  await ensureProjectPeriods();
  const today = todayStr();
  const [tree, table, flat, orgs, acts, counts] = await Promise.all([listLogframe(), ipttTable({ today }), listLogframeFlat(), listOrganisationsLite(), listActivities(), openTaskCounts()]);
  const byId = new Map(table.rows.map((r) => [r.id, r]));
  const late = new Map(decorateActivities(acts, counts, today).map((a) => [a.id, a.late]));
  const ind = (id: string): LogframeIndicator | null => {
    const r = byId.get(id);
    return r ? { id: r.id, code: r.code, name: r.name, unit: r.unit as LogframeIndicator["unit"], status: r.status, toDateActual: r.toDateActual, toDateTarget: r.toDateTarget, lopTarget: r.lopTarget } : null;
  };
  const known = new Set(flat.map((n) => n.id));
  const map = (n: LogframeTreeNode): LogframeItem => ({
    id: n.id,
    parentId: n.parentId,
    level: n.level as LogframeItem["level"],
    code: n.code,
    title: n.title,
    description: n.description,
    indicators: n.indicators.map((i) => ind(i.id)).filter((i): i is LogframeIndicator => i !== null),
    activities: n.activities.map((a) => ({ ...a, late: late.get(a.id) ?? false })),
    children: n.children.map(map),
  });
  const loose = table.rows.filter((r) => !r.nodeId || !known.has(r.nodeId)).map((r) => ind(r.id)!);
  return {
    roots: tree.map(map),
    loose: { indicators: loose, activities: acts.filter((a) => !a.logframeNodeId || !known.has(a.logframeNodeId)).length },
    orgs: orgOptions(orgs),
    nodes: nodeOptions(flat),
  };
}

/** One indicator: its definition, every period, every value with its source, and the partner split. */
export async function loadIndicatorPage(id: string): Promise<IndicatorPageData | null> {
  await ensureProjectPeriods();
  const today = todayStr();
  const ind = await getIndicator(id);
  if (!ind || ind.deletedAt) return null;
  const [table, partners, nodes, orgs, links, ai] = await Promise.all([ipttTable({ today }), actualsByPartner(id), listLogframeFlat(), listOrganisationsLite(), listLinks({ type: "indicator", id }), aiStatus()]);
  const row = table.rows.find((r) => r.id === id);
  if (!row) return null;
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    today,
    indicator: {
      id: ind.id,
      code: ind.code,
      name: ind.name,
      definition: ind.definition,
      unit: ind.unit as IndicatorPageData["indicator"]["unit"],
      disaggregation: ind.disaggregation,
      baseline: num(ind.baseline),
      baselineDate: ind.baselineDate,
      lopTarget: num(ind.lopTarget),
      dataSource: ind.dataSource,
      frequency: ind.frequency,
      responsibleOrgId: ind.responsibleOrgId,
      meansOfVerification: ind.meansOfVerification,
      direction: ind.direction === "decrease" ? "decrease" : "increase",
      cumulative: ind.cumulative,
      logframeNodeId: ind.logframeNodeId,
      nodeCode: ind.nodeCode,
      nodeTitle: ind.nodeTitle,
    },
    row: toItem(row, table.periods, today),
    periods: table.periods.map(periodItem),
    values: ind.values.map((v) => ({
      id: v.id,
      periodId: v.periodId,
      periodLabel: v.periodLabel,
      value: Number(v.value),
      disaggregation: v.disaggregation,
      organisationId: v.organisationId,
      orgName: v.orgName,
      sourceDocumentId: v.sourceDocumentId,
      sourceTitle: v.sourceTitle,
      sourcePage: v.sourcePage,
      sourceNote: v.sourceNote,
      status: v.status === "proposed" ? "proposed" : "approved",
      createdAt: v.createdAt.toISOString(),
    })),
    byPartner: (partners ?? []).map((p) => {
      const list = Object.values(p.byPeriod);
      const total = !list.length ? null : ind.unit === "percent" || !ind.cumulative ? (p.byPeriod[[...table.periods].reverse().find((x) => x.id in p.byPeriod)!.id] ?? null) : list.reduce((a, b) => a + b, 0);
      return { orgId: p.orgId, orgName: p.orgName, total, byPeriod: p.byPeriod };
    }),
    nodes: nodeOptions(nodes),
    orgs: orgOptions(orgs),
    links: links
      .filter((l) => l.kind !== "collection_item" || l.type === "collection")
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    aiReady: ai.configured && ai.enabled && !ai.capReached,
  };
}
