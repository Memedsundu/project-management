import type { ActivityItem, GroupBy, HolidayItem, OrgOption, OutputOption } from "./types";

/** Calendar days as whole numbers (UTC), so a drag never lands between two days. */
export function dayNum(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export function dayStr(n: number) {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const shiftDay = (day: string, n: number) => dayStr(dayNum(day) + n);

export function isWeekend(day: string) {
  const w = new Date(dayNum(day) * 86_400_000).getUTCDay();
  return w === 0 || w === 6;
}

/** Working days between two dates, without weekends and full-day public holidays. */
export function workingDays(start: string, end: string, holidays: HolidayItem[]) {
  const off = new Set(holidays.filter((h) => !h.halfDay).map((h) => h.date));
  let n = 0;
  for (let d = dayNum(start); d <= dayNum(end); d++) {
    const s = dayStr(d);
    if (!isWeekend(s) && !off.has(s)) n++;
  }
  return n;
}

export const orgName = (orgs: OrgOption[], id: string) => {
  const o = orgs.find((x) => x.id === id);
  return o ? o.shortName || o.name : "";
};

/** Natural order of activity codes: 1.2 before 1.10. */
export function compareCodes(a: string, b: string) {
  return a.localeCompare(b, "tr", { numeric: true, sensitivity: "base" });
}

export type ActivityGroup = { key: string; label: string; items: ActivityItem[] };

export function groupActivities(list: ActivityItem[], group: GroupBy, outputs: OutputOption[], orgs: OrgOption[], labels: { noOutput: string; noPartner: string; all: string }): ActivityGroup[] {
  if (group === "none") return [{ key: "all", label: labels.all, items: list }];
  if (group === "output") {
    const groups: ActivityGroup[] = outputs.map((o) => ({ key: o.id, label: `${o.code} · ${o.title}`, items: list.filter((a) => a.logframeNodeId === o.id) }));
    const rest = list.filter((a) => !a.logframeNodeId || !outputs.some((o) => o.id === a.logframeNodeId));
    if (rest.length) groups.push({ key: "none", label: labels.noOutput, items: rest });
    return groups.filter((g) => g.items.length);
  }
  const groups: ActivityGroup[] = orgs.map((o) => ({ key: o.id, label: o.shortName ? `${o.shortName} · ${o.name}` : o.name, items: list.filter((a) => a.orgIds.includes(o.id)) }));
  const rest = list.filter((a) => !a.orgIds.length);
  if (rest.length) groups.push({ key: "none", label: labels.noPartner, items: rest });
  return groups.filter((g) => g.items.length);
}

/** Tailwind classes of a bar by status. Late and at risk use amber, the one colour Peni keeps for attention. */
export function barTone(a: Pick<ActivityItem, "status" | "late" | "atRisk">) {
  if (a.status === "canceled") return "border border-dashed border-line-strong bg-transparent text-faint";
  if (a.status === "done") return "border border-line bg-panel-2 text-muted";
  if (a.late) return "border border-accent bg-accent-soft text-accent-ink";
  const risk = a.atRisk ? " outline-2 outline-dashed outline-offset-2 outline-accent" : "";
  if (a.status === "ongoing") return "border border-ink bg-ink text-on-ink" + risk;
  return "border border-ink/60 bg-bg text-ink" + risk;
}

export const STATUSES = ["planned", "ongoing", "done", "delayed", "canceled"] as const;
