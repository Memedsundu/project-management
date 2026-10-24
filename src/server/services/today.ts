import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { addDaysStr, istanbulInstant, todayStr, weekRange } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { briefs, documents, indicatorValues, organisations, tasks } from "@/server/db/schema";
import { listDocumentsToCheck, listKeyDates } from "./documents";
import { listMeetings, meetingsNeedingNotes, type MeetingListItem } from "./meetings";
import { reportDueDates } from "./partners";
import { getSetting } from "./settings";
import { listPendingSuggestions } from "./suggestions";
import { listGrouped, listWaiting, type TaskView } from "./tasks";

/**
 * Everything Bugün needs, also used by the daily brief so the brief and
 * the screen never disagree.
 */

export type LateReport = { orgId: string; orgName: string; label: string; due: string; daysLate: number };

/** Partner reports whose due date has passed with no partner report filed for that period. */
export async function latePartnerReports(today = todayStr()): Promise<LateReport[]> {
  const db = await getDb();
  const orgs = await db
    .select()
    .from(organisations)
    .where(and(isNull(organisations.deletedAt), sql`${organisations.reportingRhythm} <> 'none'`));
  if (!orgs.length) return [];
  const docs = (await db.execute(sql`
    select d.period_label, d.created_at, l.to_id as org
    from documents d
    join links l on l.from_type = 'document' and l.from_id = d.id and l.to_type = 'organisation'
    where d.deleted_at is null and d.doc_type = 'partner_report'`)) as unknown as { rows: { period_label: string | null; created_at: string; org: string }[] };
  const byOrg = new Map<string, { period: string | null; created: string }[]>();
  for (const r of docs.rows ?? []) byOrg.set(r.org, [...(byOrg.get(r.org) ?? []), { period: r.period_label, created: String(r.created_at).slice(0, 10) }]);
  const out: LateReport[] = [];
  for (const o of orgs) {
    // Look back far enough to see the last two due dates.
    const due = reportDueDates(o.reportingRhythm, o.reportDueDays, addDaysStr(today, -400), 16, o.agreementEnd)
      .filter((d) => d.due < today && (!o.agreementStart || d.periodEnd >= o.agreementStart))
      .slice(-2);
    const filed = byOrg.get(o.id) ?? [];
    for (const d of due) {
      const has = filed.some((f) => (f.period && f.period.replace(/\s+/g, " ").toUpperCase() === d.label.toUpperCase()) || f.created > d.periodEnd);
      if (!has) {
        const daysLate = Math.round((Date.parse(today) - Date.parse(d.due)) / 86_400_000);
        out.push({ orgId: o.id, orgName: o.shortName || o.name, label: d.label, due: d.due, daysLate });
      }
    }
  }
  return out.sort((a, b) => b.daysLate - a.daysLate);
}

export type Attention = {
  overdue: TaskView[];
  lateReports: LateReport[];
  filesToCheck: { id: string; title: string; status: string }[];
  suggestions: { id: string; kind: string; title: string; summary: string | null; sourceType: string | null; sourceId: string | null; createdAt: Date }[];
  meetingsNeedingNotes: { id: string; title: string; startsAt: Date }[];
  proposedValues: number;
};

export async function attentionItems(today = todayStr()): Promise<Attention> {
  const db = await getDb();
  const [groups, lateReports, toCheck, suggestions, needNotes, proposed] = await Promise.all([
    listGrouped({ ownerKind: "me" }, today),
    latePartnerReports(today),
    listDocumentsToCheck(),
    listPendingSuggestions({ kinds: ["tasks", "key_dates", "meeting_recap", "link", "note", "agenda", "workplan", "organize", "indicator_values"], limit: 30 }),
    meetingsNeedingNotes(),
    db.select({ n: sql<number>`count(*)::int` }).from(indicatorValues).where(eq(indicatorValues.status, "proposed")),
  ]);
  return {
    overdue: groups.today.filter((t) => t.overdue),
    lateReports,
    filesToCheck: toCheck.map((d) => ({ id: d.id, title: d.title, status: d.classificationStatus })),
    suggestions: suggestions.map((s) => ({ id: s.id, kind: s.kind, title: s.title, summary: s.summary, sourceType: s.sourceType, sourceId: s.sourceId, createdAt: s.createdAt })),
    meetingsNeedingNotes: needNotes,
    proposedValues: Number(proposed[0]?.n ?? 0),
  };
}

export type TodayData = {
  day: string;
  tasks: TaskView[];
  weekTasks: TaskView[];
  meetings: MeetingListItem[];
  waitingThisWeek: TaskView[];
  keyDates: { documentId: string; title: string; date: string; label: string }[];
  attention: Attention;
  plannedMinutes: number;
  workMinutes: number;
};

function minutesBetween(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return Math.max(0, bh! * 60 + bm! - (ah! * 60 + am!));
}

export async function todayData(day = todayStr()): Promise<TodayData> {
  const [groups, meetings, waiting, keyDates, attention, hours] = await Promise.all([
    listGrouped({ ownerKind: "me" }, day),
    listMeetings({ from: istanbulInstant(day, "00:00"), to: istanbulInstant(addDaysStr(day, 1), "00:00"), order: "asc" }),
    listWaiting(day),
    listKeyDates(day, addDaysStr(day, 7)),
    attentionItems(day),
    getSetting("workingHours"),
  ]);
  const week = weekRange(day);
  const waitingThisWeek = waiting.flatMap((g) => g.items).filter((t) => t.dueDate && t.dueDate <= week.end);
  const meetingMinutes = meetings
    .filter((m) => m.status !== "canceled")
    .reduce((a, m) => a + (m.endsAt ? Math.max(0, (m.endsAt.getTime() - m.startsAt.getTime()) / 60_000) : 60), 0);
  const taskMinutes = groups.today.reduce((a, t) => a + (t.estimateMin ?? 0), 0);
  return {
    day,
    tasks: groups.today,
    weekTasks: groups.week,
    meetings,
    waitingThisWeek,
    keyDates,
    attention,
    plannedMinutes: Math.round(meetingMinutes + taskMinutes),
    workMinutes: minutesBetween(hours.start, hours.end),
  };
}

/** Plain-text digest of a day for Claude (brief, recipes, assistant). */
export function digestText(d: TodayData) {
  const lines: string[] = [`Date: ${d.day}`];
  lines.push(`Meetings today (${d.meetings.length}):`);
  for (const m of d.meetings) lines.push(`- ${m.startsAt.toISOString().slice(11, 16)}Z ${m.title}${m.location ? ` @ ${m.location}` : ""}`);
  lines.push(`Her tasks for today (${d.tasks.length}):`);
  for (const t of d.tasks.slice(0, 25)) lines.push(`- ${t.title}${t.dueDate ? ` (due ${t.dueDate}${t.overdue ? ", OVERDUE" : ""})` : ""}${t.priority < 4 ? ` p${t.priority}` : ""}`);
  if (d.waitingThisWeek.length) {
    lines.push("Waiting on others, due this week:");
    for (const t of d.waitingThisWeek.slice(0, 15)) lines.push(`- ${t.ownerLabel ?? "?"}: ${t.title} (due ${t.dueDate})`);
  }
  if (d.attention.lateReports.length) {
    lines.push("Late partner reports:");
    for (const r of d.attention.lateReports) lines.push(`- ${r.orgName} ${r.label}, due ${r.due} (${r.daysLate} days late)`);
  }
  if (d.keyDates.length) {
    lines.push("Deadlines found in files (next 7 days):");
    for (const k of d.keyDates) lines.push(`- ${k.date}: ${k.label} (${k.title})`);
  }
  lines.push(`Files to check: ${d.attention.filesToCheck.length}. Suggestions waiting: ${d.attention.suggestions.length}. Meetings without notes: ${d.attention.meetingsNeedingNotes.length}.`);
  lines.push(`Planned time: ${d.plannedMinutes} min of ${d.workMinutes} working minutes.`);
  return lines.join("\n");
}

export async function latestBrief(kind: "daily" | "weekly" | "partner_check" | "recipe", opts: { day?: string } = {}) {
  const db = await getDb();
  const where = [eq(briefs.kind, kind)];
  if (opts.day) where.push(eq(briefs.day, opts.day));
  const [row] = await db.select().from(briefs).where(and(...where)).orderBy(desc(briefs.createdAt)).limit(1);
  return row ?? null;
}

export async function listBriefs(limit = 30) {
  const db = await getDb();
  return db.select().from(briefs).orderBy(desc(briefs.createdAt)).limit(limit);
}

export async function markBriefRead(id: string) {
  const db = await getDb();
  await db.update(briefs).set({ readAt: new Date() }).where(eq(briefs.id, id));
}

/** Kaldığın yerden devam: last opened or edited files, pages and meetings. */
export async function recentItems(limit = 8) {
  const db = await getDb();
  const res = (await db.execute(sql`
    select * from (
      select 'document' as type, id, title, greatest(updated_at, coalesce(last_opened_at, updated_at)) as at from documents where deleted_at is null
      union all
      select 'note' as type, id, coalesce(nullif(title, ''), 'Adsız') as title, updated_at as at from notes where deleted_at is null and inbox = false
      union all
      select 'meeting' as type, id, title, updated_at as at from meetings where deleted_at is null
    ) r order by at desc limit ${limit}`)) as unknown as { rows: { type: "document" | "note" | "meeting"; id: string; title: string; at: string }[] };
  return (res.rows ?? []).map((r) => ({ type: r.type, id: r.id, title: r.title, at: new Date(r.at) }));
}

/** Tasks she finished today and the open ones left for the evening wrap-up. */
export async function wrapUpData(day = todayStr()) {
  const db = await getDb();
  const from = istanbulInstant(day, "00:00");
  const done = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), gte(tasks.completedAt, from)))
    .orderBy(desc(tasks.completedAt));
  const groups = await listGrouped({ ownerKind: "me" }, day);
  const leftovers = groups.today.filter((t) => !t.overdue || t.planDate === day);
  return { done, leftovers };
}

export async function docsFiledSince(since: Date) {
  const db = await getDb();
  return db
    .select({ id: documents.id, title: documents.title, docType: documents.docType })
    .from(documents)
    .where(and(isNull(documents.deletedAt), gte(documents.createdAt, since), inArray(documents.classificationStatus, ["confirmed", "suggested"])))
    .orderBy(desc(documents.createdAt))
    .limit(50);
}
