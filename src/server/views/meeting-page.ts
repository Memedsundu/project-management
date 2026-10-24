import "server-only";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { MeetingPageData, PrepFacts } from "@/components/meetings/types";
import type { Block } from "@/lib/blocks";
import { addDaysStr, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { decisions, meetings, organisations, tasks } from "@/server/db/schema";
import { getMeeting } from "@/server/services/meetings";
import { reportDueDates } from "@/server/services/partners";
import { listContactsLite, listOrganisationsLite } from "@/server/services/partners-lite";
import { listPendingSuggestions } from "@/server/services/suggestions";
import { tasksLinkedTo } from "@/server/services/tasks";
import { listTemplates } from "@/server/services/templates";
import { latePartnerReports } from "@/server/services/today";
import { listKeyDates } from "@/server/services/documents";
import { toInboxSuggestions } from "./files";

function taskIdsIn(blocks: Block[] | undefined, out: Set<string>) {
  for (const b of blocks ?? []) {
    if (b.type === "task" && typeof b.props?.taskId === "string" && b.props.taskId) out.add(b.props.taskId);
    taskIdsIn(b.children, out);
  }
  return out;
}

/** Fellow's prep: what is open with these partners, what was decided last time, what is coming. */
export async function prepFacts(meetingId: string): Promise<PrepFacts> {
  const db = await getDb();
  const m = await getMeeting(meetingId);
  if (!m) return { previous: null, openActions: [], waiting: [], myTasks: [], late: [], coming: [] };
  const today = todayStr();
  const orgIds = m.orgIds;

  // The meeting before this one: the series first, otherwise the last one with the same partner.
  let previous: { id: string; title: string; startsAt: Date } | null = m.previous;
  if (!previous && orgIds.length) {
    const [row] = await db
      .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
      .from(meetings)
      .where(
        and(
          isNull(meetings.deletedAt),
          lt(meetings.startsAt, m.startsAt),
          sql`exists (select 1 from links l where l.from_type = 'meeting' and l.from_id = ${meetings.id} and l.to_type = 'organisation' and l.to_id in (${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)}))`,
        ),
      )
      .orderBy(desc(meetings.startsAt))
      .limit(1);
    previous = row ?? null;
  }
  const [prevDecisions, prevActions] = previous
    ? await Promise.all([
        db.select({ id: decisions.id, text: decisions.text }).from(decisions).where(and(eq(decisions.meetingId, previous.id), isNull(decisions.deletedAt))),
        tasksLinkedTo({ type: "meeting", id: previous.id }, { open: true }),
      ])
    : [[], []];

  // Open work with these partners: what they owe her and what she owes them.
  const partnerTasks = orgIds.length
    ? await db
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, ownerKind: tasks.ownerKind, ownerOrgId: tasks.ownerOrgId })
        .from(tasks)
        .where(
          and(
            isNull(tasks.deletedAt),
            inArray(tasks.status, ["todo", "doing", "waiting"]),
            sql`(${tasks.ownerOrgId} in (${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)}) or exists (select 1 from links l where l.from_type = 'task' and l.from_id = ${tasks.id} and l.to_type = 'organisation' and l.to_id in (${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)})))`,
          ),
        )
        .orderBy(sql`coalesce(${tasks.dueDate}, '9999-12-31')`)
        .limit(40)
    : [];
  // Tasks from this meeting show in its own list, and last meeting's in "openActions".
  const ownTasks = await tasksLinkedTo({ type: "meeting", id: meetingId });
  const skip = new Set([...prevActions.map((t) => t.id), ...ownTasks.map((t) => t.id)]);
  const waiting = partnerTasks.filter((t) => t.ownerKind !== "me" && !skip.has(t.id)).slice(0, 8);
  const myTasks = partnerTasks.filter((t) => t.ownerKind === "me" && !skip.has(t.id)).slice(0, 8);

  // Late and coming partner reports, and key dates in files about these partners.
  const late = orgIds.length ? (await latePartnerReports(today)).filter((r) => orgIds.includes(r.orgId)) : [];
  const coming: PrepFacts["coming"] = [];
  if (orgIds.length) {
    const orgs = await db.select().from(organisations).where(inArray(organisations.id, orgIds));
    for (const o of orgs) {
      for (const d of reportDueDates(o.reportingRhythm, o.reportDueDays, today, 2, o.agreementEnd)) {
        if (d.due >= today && d.due <= addDaysStr(today, 45)) coming.push({ date: d.due, label: `${o.shortName || o.name}: ${d.label}`, kind: "report", href: `/partners/${o.id}` });
      }
    }
    const docOrg = (await db.execute(sql`
      select from_id as doc from links where from_type = 'document' and to_type = 'organisation' and to_id in (${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)})`)) as unknown as { rows: { doc: string }[] };
    const docIds = new Set((docOrg.rows ?? []).map((r) => r.doc));
    for (const k of await listKeyDates(today, addDaysStr(today, 45))) {
      if (docIds.has(k.documentId)) coming.push({ date: k.date, label: `${k.label} (${k.title})`, kind: "file", href: `/files/d/${k.documentId}` });
    }
  }
  for (const t of partnerTasks) {
    if (skip.has(t.id)) continue;
    if (t.dueDate && t.dueDate >= today && t.dueDate <= addDaysStr(today, 14) && !coming.some((c) => c.href === `/tasks?open=${t.id}`)) {
      coming.push({ date: t.dueDate, label: t.title, kind: "task", href: `/tasks?open=${t.id}` });
    }
  }
  coming.sort((a, b) => a.date.localeCompare(b.date));

  return {
    previous: previous
      ? {
          id: previous.id,
          title: previous.title,
          startsAt: previous.startsAt.toISOString(),
          decisions: prevDecisions.map((d) => ({ id: d.id, text: d.text })),
        }
      : null,
    openActions: prevActions.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, owner: t.ownerLabel, overdue: t.overdue })),
    waiting: waiting.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, owner: null, overdue: Boolean(t.dueDate && t.dueDate < today) })),
    myTasks: myTasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, owner: null, overdue: Boolean(t.dueDate && t.dueDate < today) })),
    late: late.map((r) => ({ label: `${r.orgName}: ${r.label}`, due: r.due, daysLate: r.daysLate, orgId: r.orgId })),
    coming: coming.slice(0, 10),
  };
}

/** The facts above as plain text for Claude's brief. */
export function prepFactsText(f: PrepFacts, partnerNames: string[]) {
  const lines: string[] = [];
  if (partnerNames.length) lines.push(`Partners in this meeting: ${partnerNames.join(", ")}`);
  if (f.previous) {
    lines.push(`Previous meeting: ${f.previous.title} on ${f.previous.startsAt.slice(0, 10)}`);
    if (f.previous.decisions.length) lines.push(`Decisions then:\n${f.previous.decisions.map((d) => `- ${d.text}`).join("\n")}`);
  }
  if (f.openActions.length) lines.push(`Actions from the previous meeting still open:\n${f.openActions.map((t) => `- ${t.title}${t.owner ? ` (${t.owner})` : ""}${t.dueDate ? `, due ${t.dueDate}${t.overdue ? " OVERDUE" : ""}` : ""}`).join("\n")}`);
  if (f.waiting.length) lines.push(`Waiting on the partner:\n${f.waiting.map((t) => `- ${t.title}${t.dueDate ? `, due ${t.dueDate}${t.overdue ? " OVERDUE" : ""}` : ""}`).join("\n")}`);
  if (f.myTasks.length) lines.push(`Her own open tasks with them:\n${f.myTasks.map((t) => `- ${t.title}${t.dueDate ? `, due ${t.dueDate}` : ""}`).join("\n")}`);
  if (f.late.length) lines.push(`Late partner reports:\n${f.late.map((r) => `- ${r.label}, due ${r.due}, ${r.daysLate} days late`).join("\n")}`);
  if (f.coming.length) lines.push(`Coming dates:\n${f.coming.map((c) => `- ${c.date}: ${c.label}`).join("\n")}`);
  return lines.join("\n\n") || "No open items.";
}

/** Everything the meeting screen needs. */
export async function loadMeetingPage(id: string): Promise<MeetingPageData | null> {
  const m = await getMeeting(id);
  if (!m || m.deletedAt) return null;
  const db = await getDb();
  const content = (m.notesContent as Block[]) ?? [];
  const blockTaskIds = [...taskIdsIn(content, new Set())];
  const [orgs, contacts, prep, pending, fromMeeting, templates, blockTasks] = await Promise.all([
    listOrganisationsLite(),
    listContactsLite(),
    prepFacts(id),
    listPendingSuggestions({ source: { type: "meeting", id }, limit: 10 }),
    tasksLinkedTo({ type: "meeting", id }),
    listTemplates("meeting"),
    blockTaskIds.length
      ? db.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, deletedAt: tasks.deletedAt }).from(tasks).where(inArray(tasks.id, blockTaskIds))
      : Promise.resolve([]),
  ]);
  const suggestions = await toInboxSuggestions(pending);
  return {
    meeting: {
      id: m.id,
      title: m.title,
      kind: m.kind,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt?.toISOString() ?? null,
      location: m.location,
      onlineUrl: m.onlineUrl,
      status: m.status,
      aiOff: m.aiOff,
      agenda: m.agenda ?? [],
      notesContent: content,
      transcript: m.transcript,
      recap: m.recap ?? null,
      prepBrief: m.prepBrief,
      followupEmail: m.followupEmail,
      updatedAt: m.updatedAt.toISOString(),
    },
    series: m.series ? { id: m.series.id, title: m.series.title, recurrenceLabel: m.series.recurrenceLabel } : null,
    previous: m.previous ? { id: m.previous.id, title: m.previous.title, startsAt: m.previous.startsAt.toISOString() } : null,
    next: m.next ? { id: m.next.id, title: m.next.title, startsAt: m.next.startsAt.toISOString() } : null,
    orgIds: m.orgIds,
    contactIds: m.contactIds,
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, organisationId: c.organisationId, role: c.role })),
    decisions: m.decisions.map((d) => ({ id: d.id, text: d.text, decidedOn: d.decidedOn })),
    tasks: fromMeeting.map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, owner: t.ownerLabel, overdue: t.overdue })),
    prep,
    recapSuggestion: suggestions.find((s) => s.kind === "meeting_recap") ?? null,
    suggestions: suggestions.filter((s) => s.kind !== "meeting_recap"),
    links: m.links
      .filter((l) => !(l.type === "organisation" && l.kind === "partner") && !(l.type === "contact" && l.kind === "attendee"))
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    templates: templates.map((t) => ({ id: t.id, name: t.name, agenda: t.content.agenda ?? [] })),
    today: todayStr(),
    partners: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    taskStates: Object.fromEntries(blockTasks.map((r) => [r.id, { title: r.title, status: r.status, dueDate: r.dueDate, deleted: Boolean(r.deletedAt) }])),
  };
}
