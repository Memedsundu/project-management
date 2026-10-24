import "server-only";
import { todayStr } from "@/lib/dates";
import { chartSpecSchema, INDICATORS_FOR, onePagerSpecSchema, TYPES_FOR, type ChartData, type ChartSeries, type ChartSpec, type ChartUnit, type OnePagerStat } from "@/lib/visuals";
import { actualsByPartner, ipttTable, type IpttRow } from "./indicators";
import { listOrganisationsLite } from "./partners-lite";
import { getVisual } from "./reports";
import { listActivities } from "./workplan";

/** Running totals; null until the first value and after the last reported one. */
function running(values: (number | null)[]) {
  const last = values.reduce<number>((l, v, i) => (v !== null ? i : l), -1);
  let sum = 0;
  let seen = false;
  return values.map((v, i) => {
    if (v !== null) {
      sum += v;
      seen = true;
    }
    return seen && i <= last ? sum : null;
  });
}

/** The stretch of periods where any of these value lists has a number. */
function stretch(lists: (number | null)[][]) {
  const used = lists[0]?.map((_, i) => (lists.some((l) => l[i] !== null && l[i] !== undefined) ? i : -1)).filter((i) => i >= 0) ?? [];
  return used.length ? { from: used[0]!, to: used.at(-1)! } : null;
}

const unitOf = (row: IpttRow): ChartUnit => (row.unit === "percent" ? "percent" : "number");

/**
 * A chart's numbers from its spec, always from the live IPTT and workplan
 * (approved values only), so a chart never goes stale.
 */
export async function chartData(raw: unknown): Promise<ChartData> {
  const spec: ChartSpec = chartSpecSchema.parse(raw);
  const type = TYPES_FOR[spec.source].includes(spec.type) ? spec.type : TYPES_FOR[spec.source][0]!;
  const base: ChartData = { source: spec.source, type, categories: [], categoryKind: "label", categoryTitles: null, series: [], unit: "number", horizontal: false, reference: null, notes: [], asOf: todayStr() };

  if (spec.source === "workplan_status") {
    const list = await listActivities();
    const order = ["done", "ongoing", "planned", "delayed", "canceled"] as const;
    const counts = new Map<string, number>(order.map((s) => [s, 0]));
    for (const a of list) {
      // Past its end and not finished counts as delayed, as on the timeline.
      const s = a.late && a.status !== "done" && a.status !== "canceled" ? "delayed" : a.status;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const shown = order.filter((s) => s !== "canceled" || counts.get(s));
    return { ...base, categories: [...shown], categoryKind: "status", horizontal: true, series: [{ key: "count", name: "count", role: "actual", slot: 0, values: shown.map((s) => counts.get(s) ?? 0) }] };
  }

  const { periods, rows } = await ipttTable(spec.periodIds.length ? { periodIds: spec.periodIds } : {});
  const byId = new Map(rows.map((r) => [r.id, r]));
  const picked = spec.indicatorIds.map((id) => byId.get(id)).filter((r): r is IpttRow => Boolean(r));
  const numeric = picked.filter((r) => r.unit !== "text");
  if (numeric.length < picked.length) base.notes.push("text_indicator");
  const limits = INDICATORS_FOR[spec.source];

  if (spec.source === "indicator_progress") {
    const pool = (numeric.length ? numeric : rows.filter((r) => r.unit !== "text" && r.percentToDate !== null)).slice(0, limits.max);
    const withData = pool.filter((r) => r.percentToDate !== null);
    if (!withData.length) base.notes.push("no_indicators");
    return {
      ...base,
      unit: "percent",
      horizontal: true,
      reference: 100,
      categories: withData.map((r) => r.code),
      categoryTitles: withData.map((r) => r.name),
      series: [{ key: "progress", name: "progress", role: "actual", slot: 0, values: withData.map((r) => Math.round((r.percentToDate ?? 0) * 1000) / 10) }],
    };
  }

  if (!numeric.length) return { ...base, notes: [...base.notes, "no_indicators"] };
  const labels = periods.map((p) => p.label);

  if (spec.source === "indicator_partners") {
    const row = numeric[0]!;
    const parts = (await actualsByPartner(row.id)) ?? [];
    const lists = parts.map((p) => periods.map((per) => p.byPeriod[per.id] ?? null));
    const span = spec.periodIds.length ? { from: 0, to: periods.length - 1 } : stretch(lists);
    if (!span || !parts.length) return { ...base, unit: unitOf(row), notes: [...base.notes, "no_periods"] };
    const total = (l: (number | null)[]) => l.reduce<number>((a, v) => a + (v ?? 0), 0);
    const ranked = parts.map((p, i) => ({ p, values: lists[i]!.slice(span.from, span.to + 1) })).sort((a, b) => total(b.values) - total(a.values));
    // A partner keeps its colour in every chart: slots go by her partner list, not by size.
    const order = (await listOrganisationsLite()).filter((o) => o.kind === "partner").map((o) => o.id);
    const slotOf = (orgId: string | null) => {
      const i = orgId ? order.indexOf(orgId) : -1;
      return i >= 0 && i < 3 ? i : 3;
    };
    // Up to three named partners keep their own colour; the rest fold into "Diğer" (never a generated colour).
    const own = ranked.filter((r) => r.p.orgId && slotOf(r.p.orgId) < 3);
    const rest = ranked.filter((r) => !own.includes(r));
    const series: ChartSeries[] = own
      .sort((a, b) => slotOf(a.p.orgId) - slotOf(b.p.orgId))
      .map(({ p, values }) => ({ key: p.orgId!, name: p.orgName, role: "series", slot: slotOf(p.orgId), values }));
    if (rest.length === 1 && rest[0]!.p.orgId) series.push({ key: rest[0]!.p.orgId, name: rest[0]!.p.orgName, role: "series", slot: 3, values: rest[0]!.values });
    else if (rest.length) series.push({ key: "other", name: "", role: "other", slot: 3, values: rest[0]!.values.map((_, i) => rest.reduce<number | null>((a, r) => (r.values[i] === null ? a : (a ?? 0) + r.values[i]!), null)) });
    // Percentages do not add up, so they stand side by side.
    const chartType = row.unit === "percent" ? "bar" : type;
    return {
      ...base,
      type: chartType,
      unit: unitOf(row),
      categories: labels.slice(span.from, span.to + 1),
      series,
      notes: rest.length > 1 ? [...base.notes, "too_many_partners"] : base.notes,
    };
  }

  // indicator_periods: one indicator with its target, or up to three side by side in one unit.
  const unit = unitOf(numeric[0]!);
  const same = numeric.filter((r) => unitOf(r) === unit).slice(0, limits.max);
  if (same.length < numeric.length) base.notes.push("mixed_units");
  const actuals = same.map((r) => r.cells.map((c) => c.actual));
  const targets = same.length === 1 ? [same[0]!.cells.map((c) => c.target)] : [];
  const span = spec.periodIds.length ? { from: 0, to: periods.length - 1 } : stretch([...actuals, ...targets]);
  if (!span) return { ...base, unit, notes: [...base.notes, "no_periods"] };
  const cut = <T,>(l: T[]) => l.slice(span.from, span.to + 1);
  const cumulative = spec.cumulative && same.every((r) => r.cumulative);
  const prep = (l: (number | null)[]) => (cumulative ? running(cut(l)) : cut(l));
  const prepTarget = (l: (number | null)[]) => {
    if (!cumulative) return cut(l);
    let sum = 0;
    let seen = false;
    return cut(l).map((v) => {
      if (v !== null) {
        sum += v;
        seen = true;
      }
      return seen ? sum : null;
    });
  };
  const series: ChartSeries[] =
    same.length === 1
      ? [
          { key: "actual", name: "", role: "actual", slot: 0, values: prep(actuals[0]!) },
          { key: "target", name: "", role: "target", slot: 2, values: prepTarget(targets[0]!) },
        ]
      : same.map((r, i) => ({ key: r.id, name: `${r.code} ${r.name}`, role: "series", slot: i, values: prep(actuals[i]!) }));
  return { ...base, unit, categories: cut(labels), series, type: cumulative ? "line" : type };
}

/** The live figures of a one-pager and its chart. */
export async function onePagerData(raw: unknown) {
  const spec = onePagerSpecSchema.parse(raw);
  const { periods, rows } = await ipttTable();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const period = spec.periodId ? (periods.find((p) => p.id === spec.periodId) ?? null) : null;
  const stats: OnePagerStat[] = spec.stats.flatMap((s): OnePagerStat[] => {
    const r = byId.get(s.indicatorId);
    if (!r || r.unit === "text") return [];
    const label = s.label.trim() || r.name;
    if (s.show === "percent") return [{ indicatorId: r.id, code: r.code, label, value: r.percentToDate === null ? null : Math.round(r.percentToDate * 100), unit: "percent", show: s.show, target: 100, periodLabel: null }];
    if (s.show === "period" && period) {
      const cell = r.cells.find((c) => c.periodId === period.id);
      return [{ indicatorId: r.id, code: r.code, label, value: cell?.actual ?? null, unit: unitOf(r), show: s.show, target: cell?.target ?? null, periodLabel: period.label }];
    }
    return [{ indicatorId: r.id, code: r.code, label, value: r.toDateActual, unit: unitOf(r), show: "to_date", target: r.lopTarget, periodLabel: null }];
  });
  let chart: { title: string; data: ChartData } | null = null;
  if (spec.chartId) {
    const v = await getVisual(spec.chartId);
    if (v && !v.deletedAt && v.kind === "chart") chart = { title: v.title, data: await chartData(v.spec) };
  }
  return { spec, stats, chart, periodLabel: period?.label ?? null, asOf: todayStr() };
}
export type OnePagerData = Awaited<ReturnType<typeof onePagerData>>;
