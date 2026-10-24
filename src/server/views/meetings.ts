import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DecisionRow, MeetingRow, SeriesRow } from "@/components/meetings/types";
import { istanbulInstant, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { aiSuggestions, decisions, meetings, meetingSeries } from "@/server/db/schema";
import { listDecisions, listMeetings, type MeetingListItem } from "@/server/services/meetings";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { listTemplates } from "@/server/services/templates";

type SP = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function pendingRecapIds() {
  const db = await getDb();
  const rows = await db
    .select({ id: aiSuggestions.sourceId })
    .from(aiSuggestions)
    .where(and(eq(aiSuggestions.kind, "meeting_recap"), eq(aiSuggestions.status, "pending"), eq(aiSuggestions.sourceType, "meeting")));
  return new Set(rows.map((r) => r.id).filter(Boolean) as string[]);
}

function toRow(m: MeetingListItem, pending: Set<string>): MeetingRow {
  return {
    id: m.id,
    title: m.title,
    kind: m.kind,
    startsAt: m.startsAt.toISOString(),
    endsAt: m.endsAt?.toISOString() ?? null,
    status: m.status,
    location: m.location,
    online: Boolean(m.onlineUrl),
    seriesId: m.seriesId,
    orgIds: m.orgIds,
    hasNotes: m.hasNotes,
    hasRecap: m.hasRecap,
    pendingRecap: pending.has(m.id),
  };
}

/** Every series with its count, next and last meeting. */
export async function listSeriesRows(): Promise<SeriesRow[]> {
  const db = await getDb();
  const [series, rows] = await Promise.all([
    db.select().from(meetingSeries).where(isNull(meetingSeries.deletedAt)).orderBy(asc(meetingSeries.title)),
    db
      .select({ id: meetings.id, seriesId: meetings.seriesId, startsAt: meetings.startsAt })
      .from(meetings)
      .where(and(isNull(meetings.deletedAt), sql`${meetings.seriesId} is not null`))
      .orderBy(asc(meetings.startsAt)),
  ]);
  const now = Date.now();
  return series.map((s) => {
    const own = rows.filter((r) => r.seriesId === s.id);
    const next = own.find((r) => r.startsAt.getTime() >= now);
    const last = [...own].reverse().find((r) => r.startsAt.getTime() < now);
    return {
      id: s.id,
      title: s.title,
      recurrenceLabel: s.recurrenceLabel,
      organisationId: s.organisationId,
      count: own.length,
      next: next ? { id: next.id, startsAt: next.startsAt.toISOString() } : null,
      last: last ? { id: last.id, startsAt: last.startsAt.toISOString() } : null,
    };
  });
}

/** "Toplantılar": upcoming by day, past by month, or the series. */
export async function loadMeetingsScreen(sp: SP) {
  const tab = sp.tab === "past" ? "past" : sp.tab === "series" ? "series" : "upcoming";
  const orgParam = str(sp.org);
  const org = orgParam && UUID.test(orgParam) ? orgParam : null;
  const today = todayStr();
  const startOfToday = istanbulInstant(today, "00:00");
  const [orgs, templates, pending, upcoming, past, series] = await Promise.all([
    listOrganisationsLite(),
    listTemplates("meeting"),
    pendingRecapIds(),
    listMeetings({ from: startOfToday, orgId: org ?? undefined, order: "asc", limit: 300 }),
    tab === "past" ? listMeetings({ to: startOfToday, orgId: org ?? undefined, order: "desc", limit: 300 }) : Promise.resolve([]),
    tab === "series" ? listSeriesRows() : Promise.resolve([]),
  ]);
  const newParam = str(sp.new);
  const day = str(sp.day);
  return {
    tab: tab as "upcoming" | "past" | "series",
    org,
    today,
    rows: (tab === "past" ? past : upcoming).map((m) => toRow(m, pending)),
    upcomingCount: upcoming.filter((m) => m.status !== "canceled").length,
    series: org ? series.filter((s) => s.organisationId === org) : series,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    newMeeting:
      newParam === "1"
        ? {
            day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today,
            orgIds: org ? [org] : [],
            title: str(sp.title) ?? "",
            links: (() => {
              const l = str(sp.link);
              const [type, id] = l?.split(":") ?? [];
              return type && id && UUID.test(id) ? [{ type, id }] : undefined;
            })(),
          }
        : null,
  };
}
export type MeetingsScreenData = Awaited<ReturnType<typeof loadMeetingsScreen>>;

/** "Kararlar": every decision, newest first, with its meeting and partners. */
export async function loadDecisionsScreen(sp: SP) {
  const orgParam = str(sp.org);
  const org = orgParam && UUID.test(orgParam) ? orgParam : null;
  const q = str(sp.q)?.trim().slice(0, 200) || null;
  const db = await getDb();
  const [orgs, list] = await Promise.all([listOrganisationsLite(), listDecisions({ orgId: org ?? undefined, q: q ?? undefined, limit: 500 })]);
  const meetingIds = [...new Set(list.map((d) => d.meetingId).filter(Boolean) as string[])];
  const linkRows = meetingIds.length
    ? ((await db.execute(sql`
        select from_id, to_id from links where from_type = 'meeting' and to_type = 'organisation' and kind = 'partner'
        and from_id in (${sql.join(meetingIds.map((m) => sql`${m}::uuid`), sql`, `)})`)) as unknown as { rows: { from_id: string; to_id: string }[] }).rows ?? []
    : [];
  const byMeeting = new Map<string, string[]>();
  for (const r of linkRows) byMeeting.set(r.from_id, [...(byMeeting.get(r.from_id) ?? []), r.to_id]);
  const rows: DecisionRow[] = list.map((d) => ({
    id: d.id,
    text: d.text,
    decidedOn: d.decidedOn,
    meetingId: d.meetingId,
    meetingTitle: d.meetingTitle,
    orgIds: [...new Set([...(d.meetingId ? (byMeeting.get(d.meetingId) ?? []) : []), ...(d.organisationId ? [d.organisationId] : [])])],
  }));
  return { rows, org, q, orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })), today: todayStr() };
}
export type DecisionsScreenData = Awaited<ReturnType<typeof loadDecisionsScreen>>;

/** One series: its meetings, what will carry into the next one, its decisions. */
export async function loadSeriesPage(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, id)).limit(1);
  if (!s || s.deletedAt) return null;
  const [orgs, pending, all] = await Promise.all([listOrganisationsLite(), pendingRecapIds(), listMeetings({ seriesId: id, order: "asc", limit: 500 })]);
  const ids = all.map((m) => m.id);
  const now = Date.now();
  const lastPast = [...all].reverse().find((m) => m.startsAt.getTime() < now) ?? null;
  const [agendaSource] = lastPast ? await db.select({ agenda: meetings.agenda }).from(meetings).where(eq(meetings.id, lastPast.id)).limit(1) : [];
  const decs = ids.length
    ? await db
        .select({ id: decisions.id, text: decisions.text, decidedOn: decisions.decidedOn, meetingId: decisions.meetingId })
        .from(decisions)
        .where(and(inArray(decisions.meetingId, ids), isNull(decisions.deletedAt)))
        .orderBy(sql`${decisions.decidedOn} desc`)
        .limit(200)
    : [];
  const titles = new Map(all.map((m) => [m.id, m.title]));
  return {
    series: { id: s.id, title: s.title, recurrence: s.recurrence, recurrenceLabel: s.recurrenceLabel, organisationId: s.organisationId },
    meetings: all.map((m) => toRow(m, pending)),
    carried: (agendaSource?.agenda ?? []).filter((a) => !a.done).map((a) => a.text),
    lastPastId: lastPast?.id ?? null,
    decisions: decs.map((d) => ({ id: d.id, text: d.text, decidedOn: d.decidedOn, meetingId: d.meetingId, meetingTitle: d.meetingId ? (titles.get(d.meetingId) ?? null) : null, orgIds: [] })) as DecisionRow[],
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    today: todayStr(),
  };
}
export type SeriesPageData = NonNullable<Awaited<ReturnType<typeof loadSeriesPage>>>;
