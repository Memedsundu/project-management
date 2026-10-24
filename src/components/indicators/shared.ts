import type { IndicatorStatus, IndicatorUnit, IpttItem, LogframeLevel, NodeOption, OrgOption } from "./types";

const nf = (locale: string, digits = 1) => new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR", { maximumFractionDigits: digits });

/** A value in its unit: 1.240 kişi stays a number, 45 in a percent indicator reads "%45". */
export function fmtValue(v: number | null | undefined, unit: IndicatorUnit, locale: string) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (unit === "percent") return new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR", { style: "percent", maximumFractionDigits: 1 }).format(v / 100);
  return nf(locale).format(v);
}

/** Axis ticks: 0, 500, 1K, 1,5K. */
export function fmtCompact(v: number, unit: IndicatorUnit, locale: string) {
  if (unit === "percent") return fmtValue(v, unit, locale);
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

/** A ratio (0.87) as "%87". */
export function fmtRatio(r: number | null | undefined, locale: string) {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "tr-TR", { style: "percent", maximumFractionDigits: 0 }).format(r);
}

export const STATUS_ORDER: IndicatorStatus[] = ["behind", "on_track", "ahead", "no_data"];

export function orgLabel(orgs: OrgOption[], id: string | null | undefined) {
  if (!id) return null;
  const o = orgs.find((x) => x.id === id);
  return o ? o.shortName || o.name : null;
}

/** "1.2" after "1.1" under the same output; "2.1" for a new output "2". */
export function nextIndicatorCode(existing: string[], node: NodeOption | null) {
  const prefix = node ? `${node.code}.` : "";
  const nums = existing.filter((c) => c.startsWith(prefix) && /^\d+$/.test(c.slice(prefix.length))).map((c) => Number(c.slice(prefix.length)));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return node ? `${node.code}.${next}` : `G${existing.length + 1}`;
}

export type IpttGroup = { key: string; node: NodeOption | null; rows: IpttItem[] };

/** Rows under their logframe item, in logframe order; the rest at the end. */
export function groupByNode(rows: IpttItem[], nodes: NodeOption[]): IpttGroup[] {
  const groups: IpttGroup[] = [];
  for (const n of nodes) {
    const mine = rows.filter((r) => r.nodeId === n.id);
    if (mine.length) groups.push({ key: n.id, node: n, rows: mine });
  }
  const known = new Set(nodes.map((n) => n.id));
  const rest = rows.filter((r) => !r.nodeId || !known.has(r.nodeId));
  if (rest.length) groups.push({ key: "none", node: null, rows: rest });
  return groups;
}

/** Running totals for cumulative indicators: what was reached by the end of each period. */
export function runningTotals(values: (number | null)[]) {
  let sum = 0;
  let seen = false;
  return values.map((v) => {
    if (v !== null) {
      sum += v;
      seen = true;
    }
    return seen ? sum : null;
  });
}

/**
 * A number as she types it, in either convention: "1.240" and "1,240" are
 * thousands, "12,5" and "12.5" are decimals, "1.240,5" and "1,240.5" both work.
 * Returns null for an empty box and undefined for something that is not a number.
 */
export function parseNumber(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return undefined;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let norm = s;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    norm = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const parts = s.split(lastDot >= 0 ? "." : ",");
    const lead = parts[0]!.replace("-", "");
    const thousands = parts.length > 2 || (parts[1]!.length === 3 && lead !== "" && lead !== "0");
    norm = thousands ? parts.join("") : parts.join(".");
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A number for an input box, with the decimal mark of her language and no
 * grouping. Two decimals at most, so "12,125" never comes back as thousands.
 */
export function numInput(v: number | null | undefined, locale: string) {
  if (v === null || v === undefined) return "";
  const s = String(Math.round(v * 100) / 100);
  return locale === "en" ? s : s.replace(".", ",");
}

/**
 * Even targets from the life-of-project target: a count is split over the
 * periods (the last one takes the remainder); a level or a percentage climbs
 * in equal steps from the baseline.
 */
export function spreadTargets(n: number, lop: number, baseline: number | null, cumulative: boolean, unit: string) {
  if (n <= 0) return [];
  if (cumulative && unit === "number") {
    const each = Math.floor(lop / n);
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? lop - each * (n - 1) : each));
  }
  const from = baseline ?? 0;
  const round = (v: number) => (unit === "percent" ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
  return Array.from({ length: n }, (_, i) => round(from + ((lop - from) * (i + 1)) / n));
}

/** "1", "2" for outcomes; "1.1", "1.2" for outputs under outcome 1; "G" for the goal. */
export function nextNodeCode(all: { code: string; level: LogframeLevel; parentId: string | null }[], level: LogframeLevel, parent: { id: string; code: string; level: LogframeLevel } | null) {
  if (level === "goal") return all.some((n) => n.level === "goal") ? `G${all.filter((n) => n.level === "goal").length + 1}` : "G";
  const siblings = all.filter((n) => n.level === level && (parent ? n.parentId === parent.id : true));
  const prefix = parent && parent.level !== "goal" ? `${parent.code}.` : "";
  const nums = siblings.map((n) => n.code.slice(prefix.length)).filter((c) => /^\d+$/.test(c)).map(Number);
  return `${prefix}${nums.length ? Math.max(...nums) + 1 : siblings.length + 1}`;
}
