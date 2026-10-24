import "server-only";
import { and, asc, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { ActivityDetail, ActivityItem, CalendarEvent, GroupBy, Milestone, TimelineScale, WorkplanData, WorkplanViewKind } from "@/components/workplan/types";
import { addDaysStr, daysBetween, dayOf, formatTime, isDateStr, istanbulInstant, todayStr, weekRange } from "@/lib/dates";
import { aiStatus } from "@/server/ai/client";
import { getDb } from "@/server/db/client";
import { organisations, reports, tasks } from "@/server/db/schema";
import { listActivity } from "@/server/services/activity";
import { listKeyDates } from "@/server/services/documents";
import { listLogframeFlat } from "@/server/services/indicators";
import { listLinks } from "@/server/services/links";
import { listMeetings } from "@/server/services/meetings";
import { partnerReportDocs, reportSlots } from "@/server/services/partners";
import { getSetting } from "@/server/services/settings";
import { listPendingSuggestions } from "@/server/services/suggestions";
import { tasksLinkedTo } from "@/server/services/tasks";
import { decorateActivities, listActivities, listHolidays, listSeasons, openTaskCounts, seasonBands } from "@/server/services/workplan";
import { toInboxSuggestions } from "./files";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN = ["todo", "doing", "waiting"];

/** Partner report dates, donor report deadlines and key dates read from files, as diamonds. */
async function loadMilestones(from: string, to: string, today: string): Promise<Milestone[]> {
  const db = await getDb();
  const [orgs, docs, donor, keyDates] = await Promise.all([
    db.select().from(organisations).where(and(isNull(organisations.deletedAt), sql`${organisations.kind} = 'partner'`)),
    partnerReportDocs(),
    db.select({ id: reports.id, title: reports.title, dueDate: reports.dueDate, status: reports.status }).from(reports).where(and(isNull(reports.deletedAt), isNotNull(reports.dueDate))),
    listKeyDates(from, to),
  ]);
  const out: Milestone[] = [];
  const ahead = Math.max(30, daysBetween(today, to));
  for (const o of orgs) {
    for (const s of reportSlots(o, docs.filter((d) => d.org === o.id), today, { aheadDays: ahead })) {
      if (s.due < from || s.due > to) continue;
      out.push({ id: `pr-${o.id}-${s.label}`, date: s.due, label: `${o.shortName || o.name} · ${s.label}`, kind: "partner_report", href: `/partners/${o.id}`, status: s.status });
    }
  }
  for (const r of donor) {
    if (!r.dueDate || r.dueDate < from || r.dueDate > to) continue;
    const status = r.status === "final" ? "received" : r.dueDate < today ? "late" : daysBetween(today, r.dueDate) <= 14 ? "due" : "upcoming";
    out.push({ id: `dr-${r.id}`, date: r.dueDate, label: r.title, kind: "donor_report", href: `/reports/${r.id}`, status });
  }
  for (const k of keyDates) out.push({ id: `kd-${k.documentId}-${k.date}`, date: k.date, label: `${k.label} (${k.title})`, kind: "key_date", href: `/files/d/${k.documentId}`, status: null });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function calendarWindow(sp: SP, today: string) {
  const mode = str(sp.cal) === "week" ? ("week" as const) : ("month" as const);
  if (mode === "week") {
    const anchor = isDateStr(str(sp.week)) ? str(sp.week)! : today;
    const { start, end } = weekRange(anchor);
    return { mode, anchor: start, from: start, to: end };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(str(sp.month) ?? "");
  const first = m ? `${m[1]}-${m[2]}-01` : `${today.slice(0, 7)}-01`;
  const next = addDaysStr(first, 32).slice(0, 7) + "-01";
  const last = addDaysStr(next, -1);
  return { mode, anchor: first, from: weekRange(first).start, to: weekRange(last).end };
}

async function loadCalendar(sp: SP, today: string, activities: ActivityItem[], milestones: Milestone[], holidays: { id: string; date: string; nameTr: string; nameEn: string }[], locale: "tr" | "en") {
  const win = calendarWindow(sp, today);
  const db = await getDb();
  const [meets, due] = await Promise.all([
    listMeetings({ from: istanbulInstant(win.from, "00:00"), to: istanbulInstant(addDaysStr(win.to, 1), "00:00"), limit: 400 }),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, OPEN), gte(tasks.dueDate, win.from), lte(tasks.dueDate, win.to)))
      .orderBy(asc(tasks.dueDate))
      .limit(400),
  ]);
  const events: CalendarEvent[] = [];
  for (const h of holidays) if (h.date >= win.from && h.date <= win.to) events.push({ id: `h-${h.id}`, date: h.date, title: locale === "en" ? h.nameEn : h.nameTr, kind: "holiday", href: null });
  for (const m of meets) {
    if (m.status === "canceled") continue;
    events.push({ id: `m-${m.id}`, date: dayOf(m.startsAt), time: formatTime(m.startsAt), title: m.title, kind: "meeting", href: `/meetings/${m.id}` });
  }
  for (const t of due) events.push({ id: `t-${t.id}`, date: t.dueDate!, title: t.title, kind: "task", href: `/tasks?open=${t.id}`, late: t.dueDate! < today });
  for (const a of activities) {
    const href = `/workplan?view=calendar&open=${a.id}`;
    const label = `${a.code} ${a.title}`;
    if (a.isMilestone && a.startDate && a.startDate >= win.from && a.startDate <= win.to) {
      events.push({ id: `am-${a.id}`, date: a.startDate, title: label, kind: "milestone", href, late: a.late });
      continue;
    }
    if (a.startDate && a.startDate >= win.from && a.startDate <= win.to) events.push({ id: `as-${a.id}`, date: a.startDate, title: label, kind: "activity_start", href, late: a.late });
    if (a.endDate && a.endDate !== a.startDate && a.endDate >= win.from && a.endDate <= win.to) events.push({ id: `ae-${a.id}`, date: a.endDate, title: label, kind: "activity_end", href, late: a.late });
  }
  for (const m of milestones) if (m.date >= win.from && m.date <= win.to) events.push({ id: `ms-${m.id}`, date: m.date, title: m.label, kind: "report", href: m.href, late: m.status === "late" });
  const order: Record<CalendarEvent["kind"], number> = { holiday: 0, report: 1, milestone: 2, meeting: 3, activity_start: 4, activity_end: 5, task: 6 };
  events.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || (a.time ?? "").localeCompare(b.time ?? ""));
  return { ...win, events };
}

async function loadDetail(id: string, items: ActivityItem[], prep: WorkplanData["prep"]): Promise<ActivityDetail | null> {
  const activity = items.find((a) => a.id === id);
  if (!activity) return null;
  const ref = { type: "activity" as const, id };
  const [links, linked, history] = await Promise.all([listLinks(ref), tasksLinkedTo(ref), listActivity({ entityType: "activity", entityId: id, limit: 30 })]);
  return {
    activity,
    links: links
      .filter((l) => l.kind !== "partner" && l.type !== "task")
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    tasks: linked
      .filter((t) => t.status !== "canceled")
      .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, overdue: t.overdue, ownerLabel: t.ownerLabel })),
    dependents: items.filter((a) => a.dependsOn.includes(id)).map((a) => a.id),
    history: history.map((h) => ({ id: h.id, at: h.at.toISOString(), action: h.action, actor: h.actor, summary: h.summary })),
    prep: prep.filter((s) => s.source?.type === "activity" && s.source.id === id),
  };
}

/** İş planı: the activities on a timeline, in a table or on a calendar, with seasons, holidays and report dates. */
export async function loadWorkplan(sp: SP, locale: "tr" | "en" = "tr"): Promise<WorkplanData> {
  const today = todayStr();
  const viewParam = str(sp.view);
  const view: WorkplanViewKind = viewParam === "table" || viewParam === "calendar" ? viewParam : "timeline";
  const scale: TimelineScale = str(sp.scale) === "quarter" ? "quarter" : "month";
  const groupParam = str(sp.group);
  const group: GroupBy = groupParam === "partner" || groupParam === "none" ? groupParam : "output";
  const partner = UUID.test(str(sp.partner) ?? "") ? str(sp.partner)! : null;
  const statusParam = str(sp.status);
  const status = ["planned", "ongoing", "done", "delayed", "canceled", "late"].includes(statusParam ?? "") ? statusParam! : null;

  const db = await getDb();
  const [profile, raw, counts, nodes, orgRows, seasons, ai, pending] = await Promise.all([
    getSetting("profile"),
    listActivities(),
    openTaskCounts(),
    listLogframeFlat(),
    db.select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName, kind: organisations.kind }).from(organisations).where(isNull(organisations.deletedAt)).orderBy(asc(organisations.name)),
    listSeasons(),
    aiStatus(),
    listPendingSuggestions({ kinds: ["workplan"], limit: 40 }),
  ]);
  const all = decorateActivities(raw, counts, today);

  // The whole project, widened to fit any activity planned outside it.
  const dates = all.flatMap((a) => [a.startDate, a.endDate]).filter((d): d is string => Boolean(d));
  let from = `${profile.startYear}-01-01`;
  let to = `${profile.endYear}-12-31`;
  for (const d of dates) {
    if (d < from) from = `${d.slice(0, 4)}-01-01`;
    if (d > to) to = `${d.slice(0, 4)}-12-31`;
  }

  const [holidays, milestones] = await Promise.all([listHolidays(from, to), loadMilestones(from, to, today)]);
  const activities = all.filter((a) => {
    if (partner && !a.orgIds.includes(partner)) return false;
    if (status === "late") return a.late || a.atRisk;
    if (status && a.status !== status) return false;
    return true;
  });
  const prep = await toInboxSuggestions(pending);
  const openId = str(sp.open);

  return {
    view,
    scale,
    group,
    today,
    range: { from, to },
    activities,
    outputs: nodes.filter((n) => n.level === "output").map((n) => ({ id: n.id, code: n.code, title: n.title })),
    orgs: orgRows.sort((a, b) => Number(b.kind === "partner") - Number(a.kind === "partner")).map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, crop: s.crop, provinces: s.provinces, startMonth: s.startMonth, startDay: s.startDay, endMonth: s.endMonth, endDay: s.endDay, active: s.active })),
    bands: seasonBands(seasons, Number(from.slice(0, 4)), Number(to.slice(0, 4))),
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, nameTr: h.nameTr, nameEn: h.nameEn, kind: h.kind, halfDay: h.halfDay })),
    milestones,
    calendar: view === "calendar" ? await loadCalendar(sp, today, all, milestones, holidays, locale) : null,
    detail: openId && UUID.test(openId) ? await loadDetail(openId, all, prep) : null,
    aiReady: ai.configured && ai.enabled && !ai.capReached,
    prep,
    filters: { partner, status },
    project: { startYear: profile.startYear, endYear: profile.endYear },
  };
}
