import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { blocksToPlainText, markdownToBlocks, type Block } from "@/lib/blocks";
import { dayOf, todayStr } from "@/lib/dates";
import { nextOccurrence } from "@/lib/parse-task";
import { getDb } from "@/server/db/client";
import { decisions, meetings, meetingSeries } from "@/server/db/schema";
import type { AgendaItem, MeetingRecap } from "@/server/db/schema/work";
import type { EntityRef } from "@/server/entities";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { addLink, linkedIds, listLinks, setLinks } from "./links";

export const MEETING_KINDS = ["partner", "donor", "steering", "field", "internal", "other"] as const;

export const meetingInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(MEETING_KINDS).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
  location: z.string().max(300).nullish(),
  onlineUrl: z.string().max(500).nullish(),
  seriesId: z.string().uuid().nullish(),
  orgIds: z.array(z.string().uuid()).max(20).optional(),
  contactIds: z.array(z.string().uuid()).max(60).optional(),
  agenda: z.array(z.object({ id: z.string().optional(), text: z.string().max(500), done: z.boolean().optional(), carriedFrom: z.string().nullish(), notes: z.string().max(4000).optional() })).max(60).optional(),
  notesMarkdown: z.string().max(200_000).optional(),
  templateId: z.string().uuid().nullish(),
  links: z.array(z.object({ type: z.string(), id: z.string().uuid() })).max(20).optional(),
});
export type MeetingInput = z.input<typeof meetingInputSchema>;

function normaliseAgenda(items: MeetingInput["agenda"]): AgendaItem[] {
  return (items ?? [])
    .filter((a) => a.text.trim())
    .map((a) => ({ id: a.id ?? randomUUID(), text: a.text.trim(), done: Boolean(a.done), carriedFrom: a.carriedFrom ?? null, notes: a.notes ?? "" }));
}

export async function createMeeting(raw: MeetingInput, actor: Actor = "user") {
  const input = meetingInputSchema.parse(raw);
  const db = await getDb();
  let agenda = normaliseAgenda(input.agenda);
  // A meeting in a series starts with what was left open last time (Fellow).
  if (input.seriesId && !input.agenda) agenda = await carriedAgenda(input.seriesId, input.startsAt);
  const content: Block[] = input.notesMarkdown ? markdownToBlocks(input.notesMarkdown) : [];
  const [row] = await db
    .insert(meetings)
    .values({
      title: input.title,
      kind: input.kind ?? "partner",
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? new Date(input.startsAt.getTime() + 60 * 60 * 1000),
      location: input.location ?? null,
      onlineUrl: input.onlineUrl ?? null,
      seriesId: input.seriesId ?? null,
      agenda,
      notesContent: content,
      notesText: blocksToPlainText(content),
    })
    .returning();
  const m = row!;
  const ref: EntityRef = { type: "meeting", id: m.id };
  const orgIds = new Set(input.orgIds ?? []);
  if (input.seriesId && !input.orgIds) {
    const [s] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, input.seriesId)).limit(1);
    if (s?.organisationId) orgIds.add(s.organisationId);
  }
  for (const o of orgIds) await addLink(ref, { type: "organisation", id: o }, "partner", actor === "ai" ? "ai" : "user");
  for (const c of input.contactIds ?? []) await addLink(ref, { type: "contact", id: c }, "attendee");
  for (const l of input.links ?? []) await addLink(ref, { type: l.type as EntityRef["type"], id: l.id }, "related");
  await logActivity({ action: "create", entityType: "meeting", entityId: m.id, title: m.title, actor });
  await indexMeeting(m.id);
  return m;
}

export const meetingPatchSchema = meetingInputSchema.partial().extend({
  status: z.enum(["planned", "done", "canceled"]).optional(),
  notesContent: z.array(z.any()).max(5000).optional(),
  transcript: z.string().max(600_000).nullish(),
  prepBrief: z.string().max(40_000).nullish(),
  followupEmail: z.string().max(40_000).nullish(),
  aiOff: z.boolean().optional(),
  recap: z.any().optional(),
});
export type MeetingPatch = z.input<typeof meetingPatchSchema>;

export async function updateMeeting(id: string, raw: MeetingPatch, actor: Actor = "user") {
  const patch = meetingPatchSchema.parse(raw);
  const db = await getDb();
  const [before] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!before) return null;
  const set: Partial<typeof meetings.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) set.endsAt = patch.endsAt ?? null;
  if (patch.location !== undefined) set.location = patch.location ?? null;
  if (patch.onlineUrl !== undefined) set.onlineUrl = patch.onlineUrl ?? null;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.agenda !== undefined) set.agenda = normaliseAgenda(patch.agenda);
  if (patch.notesContent !== undefined) {
    set.notesContent = patch.notesContent;
    set.notesText = blocksToPlainText(patch.notesContent as Block[]);
  } else if (patch.notesMarkdown !== undefined) {
    const blocks = markdownToBlocks(patch.notesMarkdown);
    set.notesContent = blocks;
    set.notesText = blocksToPlainText(blocks);
  }
  if (patch.transcript !== undefined) set.transcript = patch.transcript ?? null;
  if (patch.prepBrief !== undefined) set.prepBrief = patch.prepBrief ?? null;
  if (patch.followupEmail !== undefined) set.followupEmail = patch.followupEmail ?? null;
  if (patch.aiOff !== undefined) set.aiOff = patch.aiOff;
  if (patch.recap !== undefined) set.recap = patch.recap as MeetingRecap | null;
  if (patch.seriesId !== undefined) set.seriesId = patch.seriesId ?? null;
  const [row] = await db.update(meetings).set(set).where(eq(meetings.id, id)).returning();
  const ref: EntityRef = { type: "meeting", id };
  if (patch.orgIds) await setLinks(ref, "partner", patch.orgIds.map((o) => ({ type: "organisation" as const, id: o })));
  if (patch.contactIds) await setLinks(ref, "attendee", patch.contactIds.map((c) => ({ type: "contact" as const, id: c })));
  const quiet = patch.notesContent !== undefined && Object.keys(patch).length === 1;
  if (!quiet) {
    await logActivity({
      action: patch.status === "done" && before.status !== "done" ? "complete" : "update",
      entityType: "meeting",
      entityId: id,
      title: row!.title,
      summary: Object.keys(patch).filter((k) => k !== "notesContent").join(", ") || null,
      actor,
    });
  }
  await indexMeeting(id);
  return row!;
}

/** Open agenda items of the last meeting in a series, carried into the next. */
async function carriedAgenda(seriesId: string, before: Date): Promise<AgendaItem[]> {
  const db = await getDb();
  const [last] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.seriesId, seriesId), isNull(meetings.deletedAt), lt(meetings.startsAt, before)))
    .orderBy(desc(meetings.startsAt))
    .limit(1);
  if (!last) {
    const [s] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, seriesId)).limit(1);
    if (s?.templateId) {
      const { getTemplate } = await import("./templates");
      const tpl = await getTemplate(s.templateId);
      return (tpl?.agenda ?? []).map((text) => ({ id: randomUUID(), text, done: false, carriedFrom: null, notes: "" }));
    }
    return [];
  }
  return (last.agenda ?? [])
    .filter((a) => !a.done)
    .map((a) => ({ id: randomUUID(), text: a.text, done: false, carriedFrom: last.id, notes: "" }));
}

export async function createSeries(input: { title: string; recurrence?: string | null; recurrenceLabel?: string | null; organisationId?: string | null; templateId?: string | null }) {
  const db = await getDb();
  const [row] = await db
    .insert(meetingSeries)
    .values({ title: input.title, recurrence: input.recurrence ?? null, recurrenceLabel: input.recurrenceLabel ?? null, organisationId: input.organisationId ?? null, templateId: input.templateId ?? null })
    .returning();
  await logActivity({ action: "create", entityType: "series", entityId: row!.id, title: row!.title });
  await indexSeries(row!.id);
  return row!;
}

/** "Sonraki toplantıyı oluştur": the next date from the series rule, agenda carried over. */
export async function createNextInSeries(seriesId: string) {
  const db = await getDb();
  const [s] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, seriesId)).limit(1);
  if (!s) return null;
  const [last] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.seriesId, seriesId), isNull(meetings.deletedAt)))
    .orderBy(desc(meetings.startsAt))
    .limit(1);
  const baseDay = last ? dayOf(last.startsAt) : todayStr();
  const nextDay = s.recurrence ? (nextOccurrence(s.recurrence, baseDay, false) ?? baseDay) : baseDay;
  const time = last ? new Date(last.startsAt) : null;
  const hh = time ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul", hour12: false }).format(time) : "10:00";
  const { istanbulInstant } = await import("@/lib/dates");
  const startsAt = istanbulInstant(nextDay, hh);
  const duration = last?.endsAt ? last.endsAt.getTime() - last.startsAt.getTime() : 60 * 60 * 1000;
  return createMeeting({ title: s.title, seriesId, startsAt, endsAt: new Date(startsAt.getTime() + duration), kind: (last?.kind as "partner") ?? "partner", location: last?.location, onlineUrl: last?.onlineUrl });
}

export async function addDecision(input: { meetingId?: string | null; text: string; decidedOn?: string; organisationId?: string | null }, actor: Actor = "user") {
  const db = await getDb();
  let day = input.decidedOn;
  if (!day && input.meetingId) {
    const [m] = await db.select({ startsAt: meetings.startsAt }).from(meetings).where(eq(meetings.id, input.meetingId)).limit(1);
    day = m ? dayOf(m.startsAt) : undefined;
  }
  const [row] = await db
    .insert(decisions)
    .values({ meetingId: input.meetingId ?? null, text: input.text.trim(), decidedOn: day ?? todayStr(), organisationId: input.organisationId ?? null })
    .returning();
  await logActivity({ action: "create", entityType: "decision", entityId: row!.id, title: row!.text.slice(0, 200), actor });
  await indexDecision(row!.id);
  return row!;
}

export async function updateDecision(id: string, patch: { text?: string; organisationId?: string | null; decidedOn?: string }) {
  const db = await getDb();
  const [row] = await db.update(decisions).set(patch).where(eq(decisions.id, id)).returning();
  if (row) await indexDecision(id);
  return row ?? null;
}

export async function listDecisions(opts: { orgId?: string; q?: string; limit?: number } = {}) {
  const db = await getDb();
  return db
    .select({
      id: decisions.id,
      text: decisions.text,
      decidedOn: decisions.decidedOn,
      meetingId: decisions.meetingId,
      organisationId: decisions.organisationId,
      meetingTitle: meetings.title,
    })
    .from(decisions)
    .leftJoin(meetings, eq(meetings.id, decisions.meetingId))
    .where(
      and(
        isNull(decisions.deletedAt),
        opts.orgId
          ? sql`(${decisions.organisationId} = ${opts.orgId}::uuid or exists (select 1 from links l where l.from_type = 'meeting' and l.from_id = ${decisions.meetingId} and l.to_type = 'organisation' and l.to_id = ${opts.orgId}::uuid))`
          : undefined,
        opts.q ? sql`${decisions.text} ilike ${"%" + opts.q + "%"}` : undefined,
      ),
    )
    .orderBy(desc(decisions.decidedOn), desc(decisions.createdAt))
    .limit(opts.limit ?? 300);
}

export async function getMeeting(id: string) {
  const db = await getDb();
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!m) return null;
  const [decs, links, series] = await Promise.all([
    db.select().from(decisions).where(and(eq(decisions.meetingId, id), isNull(decisions.deletedAt))).orderBy(asc(decisions.createdAt)),
    listLinks({ type: "meeting", id }),
    m.seriesId ? db.select().from(meetingSeries).where(eq(meetingSeries.id, m.seriesId)).limit(1) : Promise.resolve([]),
  ]);
  const prev = m.seriesId
    ? await db
        .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
        .from(meetings)
        .where(and(eq(meetings.seriesId, m.seriesId), isNull(meetings.deletedAt), lt(meetings.startsAt, m.startsAt)))
        .orderBy(desc(meetings.startsAt))
        .limit(1)
    : [];
  const next = m.seriesId
    ? await db
        .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
        .from(meetings)
        .where(and(eq(meetings.seriesId, m.seriesId), isNull(meetings.deletedAt), sql`${meetings.startsAt} > ${m.startsAt}`))
        .orderBy(asc(meetings.startsAt))
        .limit(1)
    : [];
  return {
    ...m,
    decisions: decs,
    links,
    orgIds: links.filter((l) => l.type === "organisation" && l.kind === "partner").map((l) => l.id),
    contactIds: links.filter((l) => l.type === "contact" && l.kind === "attendee").map((l) => l.id),
    series: series[0] ?? null,
    previous: prev[0] ?? null,
    next: next[0] ?? null,
  };
}

export type MeetingListItem = { id: string; title: string; kind: string; startsAt: Date; endsAt: Date | null; status: string; location: string | null; seriesId: string | null; orgIds: string[]; hasNotes: boolean; hasRecap: boolean };

export async function listMeetings(opts: { from?: Date; to?: Date; orgId?: string; kind?: string; status?: string; limit?: number; order?: "asc" | "desc" } = {}): Promise<MeetingListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      kind: meetings.kind,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      status: meetings.status,
      location: meetings.location,
      seriesId: meetings.seriesId,
      notesText: meetings.notesText,
      recap: meetings.recap,
    })
    .from(meetings)
    .where(
      and(
        isNull(meetings.deletedAt),
        opts.from ? gte(meetings.startsAt, opts.from) : undefined,
        opts.to ? lt(meetings.startsAt, opts.to) : undefined,
        opts.kind ? eq(meetings.kind, opts.kind) : undefined,
        opts.status ? eq(meetings.status, opts.status) : undefined,
        opts.orgId
          ? sql`exists (select 1 from links l where l.from_type = 'meeting' and l.from_id = ${meetings.id} and l.to_type = 'organisation' and l.to_id = ${opts.orgId}::uuid)`
          : undefined,
      ),
    )
    .orderBy(opts.order === "desc" ? desc(meetings.startsAt) : asc(meetings.startsAt))
    .limit(opts.limit ?? 300);
  if (!rows.length) return [];
  const orgLinks = (await db.execute(sql`
    select from_id, to_id from links where from_type = 'meeting' and to_type = 'organisation' and from_id in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)})`)) as unknown as {
    rows: { from_id: string; to_id: string }[];
  };
  const byMeeting = new Map<string, string[]>();
  for (const r of orgLinks.rows ?? []) byMeeting.set(r.from_id, [...(byMeeting.get(r.from_id) ?? []), r.to_id]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    location: r.location,
    seriesId: r.seriesId,
    orgIds: byMeeting.get(r.id) ?? [],
    hasNotes: Boolean(r.notesText?.trim()),
    hasRecap: Boolean(r.recap),
  }));
}

export async function listSeries() {
  const db = await getDb();
  return db.select().from(meetingSeries).where(isNull(meetingSeries.deletedAt)).orderBy(asc(meetingSeries.title));
}

export async function indexMeeting(id: string) {
  const db = await getDb();
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!m || m.deletedAt) return unindexRecord("meeting", id);
  const orgIds = await linkedIds({ type: "meeting", id }, "organisation", "partner");
  const decs = await db.select({ text: decisions.text }).from(decisions).where(and(eq(decisions.meetingId, id), isNull(decisions.deletedAt)));
  await indexRecord({
    type: "meeting",
    id,
    title: m.title,
    body: [
      (m.agenda ?? []).map((a) => a.text).join("\n"),
      m.notesText,
      decs.map((d) => d.text).join("\n"),
      m.recap?.summary,
      m.location,
    ]
      .filter(Boolean)
      .join("\n"),
    meta: { kind: m.kind, status: m.status, orgIds, seriesId: m.seriesId },
    aiOff: m.aiOff,
    occurredAt: m.startsAt,
  });
}

export async function indexSeries(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(meetingSeries).where(eq(meetingSeries.id, id)).limit(1);
  if (!s || s.deletedAt) return unindexRecord("series", id);
  await indexRecord({ type: "series", id, title: s.title, body: s.recurrenceLabel ?? "", meta: { orgIds: s.organisationId ? [s.organisationId] : [] }, occurredAt: s.updatedAt });
}

export async function indexDecision(id: string) {
  const db = await getDb();
  const [d] = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  if (!d || d.deletedAt) return unindexRecord("decision", id);
  const orgIds = d.meetingId ? await linkedIds({ type: "meeting", id: d.meetingId }, "organisation", "partner") : [];
  if (d.organisationId && !orgIds.includes(d.organisationId)) orgIds.push(d.organisationId);
  await indexRecord({ type: "decision", id, title: d.text.slice(0, 200), body: d.text, meta: { meetingId: d.meetingId, orgIds }, occurredAt: new Date(d.decidedOn) });
}

/* ------------------------- Accepting Claude's suggestions ------------------------- */

type RecapDecision = { summary?: string; decisions?: number[] | string[]; actions?: number[]; keepRecap?: boolean; tasks?: { title: string; dueDate?: string | null; ownerName?: string | null; ownerOrgId?: string | null }[] };

/** She accepted the recap: store it, log the decisions she kept, create the tasks she kept. */
export async function applyMeetingRecap(payload: unknown, decision: unknown, source: EntityRef | null) {
  const recap = (payload as { recap: MeetingRecap; tasks?: { title: string; dueDate?: string | null; ownerName?: string | null; ownerOrgId?: string | null }[] }).recap;
  const proposedTasks = (payload as { tasks?: RecapDecision["tasks"] }).tasks ?? [];
  const d = (decision ?? {}) as RecapDecision;
  const meetingId = source?.type === "meeting" ? source.id : null;
  if (!meetingId) return { status: "accepted" as const };
  const keptDecisions = Array.isArray(d.decisions)
    ? d.decisions.map((x) => (typeof x === "number" ? recap.decisions[x] : x)).filter((x): x is string => Boolean(x))
    : recap.decisions;
  const finalRecap: MeetingRecap = { ...recap, summary: d.summary ?? recap.summary, decisions: keptDecisions };
  await updateMeeting(meetingId, { recap: finalRecap, status: "done" }, "user");
  const orgIds = await linkedIds({ type: "meeting", id: meetingId }, "organisation", "partner");
  for (const text of keptDecisions) await addDecision({ meetingId, text, organisationId: orgIds.length === 1 ? orgIds[0] : null }, "ai");
  const { createTask } = await import("./tasks");
  const tasks = d.tasks ?? (Array.isArray(d.actions) ? d.actions.map((i) => proposedTasks[i]).filter(Boolean) : proposedTasks);
  let created = 0;
  for (const t of tasks as NonNullable<RecapDecision["tasks"]>) {
    if (!t?.title?.trim()) continue;
    await createTask({ title: t.title, dueDate: t.dueDate ?? null, ownerOrgId: t.ownerOrgId ?? null, ownerName: t.ownerOrgId ? null : (t.ownerName ?? null), sourceType: "meeting", sourceId: meetingId, orgIds }, "ai");
    created++;
  }
  return { status: created === proposedTasks.length && keptDecisions.length === recap.decisions.length ? ("accepted" as const) : ("partial" as const), result: { created } };
}

/** Agenda items Claude proposed for the next meeting. */
export async function applyAgendaSuggestion(payload: unknown, decision: unknown, source: EntityRef | null) {
  const items = ((decision as { items?: string[] })?.items ?? (payload as { items: string[] }).items ?? []).filter(Boolean);
  const meetingId = source?.type === "meeting" ? source.id : null;
  if (!meetingId) return { status: "accepted" as const };
  const db = await getDb();
  const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!m) return { status: "accepted" as const };
  const agenda = [...(m.agenda ?? []), ...items.map((text) => ({ id: randomUUID(), text, done: false, carriedFrom: null, notes: "" }))];
  await updateMeeting(meetingId, { agenda });
  return { status: "accepted" as const };
}

/* ------------------------------ Calendar export ------------------------------ */

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function icsText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\;");
}

/** One meeting (or many) as an .ics file for Outlook or Google Calendar. */
export function meetingsToIcs(list: { id: string; title: string; startsAt: Date; endsAt: Date | null; location: string | null; onlineUrl?: string | null; description?: string }[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//uygulama//meetings//TR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const m of list) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${m.id}@uygulama`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(m.startsAt)}`,
      `DTEND:${icsDate(m.endsAt ?? new Date(m.startsAt.getTime() + 3600_000))}`,
      `SUMMARY:${icsText(m.title)}`,
    );
    if (m.location || m.onlineUrl) lines.push(`LOCATION:${icsText([m.location, m.onlineUrl].filter(Boolean).join(" · "))}`);
    if (m.description) lines.push(`DESCRIPTION:${icsText(m.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function meetingsNeedingNotes() {
  const db = await getDb();
  return db
    .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
    .from(meetings)
    .where(and(isNull(meetings.deletedAt), ne(meetings.status, "canceled"), lt(meetings.startsAt, new Date()), sql`${meetings.recap} is null`, gte(meetings.startsAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(desc(meetings.startsAt))
    .limit(10);
}

export async function meetingsOn(day: string) {
  const { istanbulInstant, addDaysStr } = await import("@/lib/dates");
  return listMeetings({ from: istanbulInstant(day, "00:00"), to: istanbulInstant(addDaysStr(day, 1), "00:00") });
}

