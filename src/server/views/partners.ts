import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { ContactRow, PartnerCardData, PartnerPageData } from "@/components/partners/types";
import { todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { contacts, documents, organisations } from "@/server/db/schema";
import { listLinks } from "@/server/services/links";
import { listDecisions } from "@/server/services/meetings";
import { getOrganisation, listPartnerCards, meetingsWith, partnerReportDocs, partnerTimeline, reportSlots, type TimelineItem } from "@/server/services/partners";
import { tasksLinkedTo } from "@/server/services/tasks";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const TIMELINE_TYPES = ["meeting", "document", "decision", "task", "note"] as const;

async function allContacts(): Promise<ContactRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: contacts.id, name: contacts.name, role: contacts.role, email: contacts.email, phone: contacts.phone, notes: contacts.notes, organisationId: contacts.organisationId, orgName: organisations.name, orgShort: organisations.shortName })
    .from(contacts)
    .leftJoin(organisations, eq(organisations.id, contacts.organisationId))
    .where(isNull(contacts.deletedAt))
    .orderBy(asc(contacts.name));
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, email: r.email, phone: r.phone, notes: r.notes, organisationId: r.organisationId, orgName: r.orgShort || r.orgName || null }));
}

/** "Ortaklar": partner cards, the lighter stakeholder pages and every contact. */
export async function loadPartnersScreen(sp: SP) {
  const tab = sp.tab === "stakeholders" ? "stakeholders" : sp.tab === "contacts" ? "contacts" : "partners";
  const today = todayStr();
  const [cards, docs, people] = await Promise.all([listPartnerCards(), partnerReportDocs(), allContacts()]);
  const toCard = (c: (typeof cards)[number]): PartnerCardData => {
    const slots = reportSlots(c, docs.filter((d) => d.org === c.id), today, { aheadDays: 120 });
    const late = slots.filter((s) => s.status === "late").slice(-2);
    const next = slots.find((s) => s.status === "due" || s.status === "upcoming") ?? null;
    return {
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      kind: c.kind,
      provinces: c.provinces,
      statusLine: c.statusLine,
      agreementEnd: c.agreementEnd,
      openTasks: c.openTasks,
      waitingOn: c.waitingOn,
      overdue: c.overdue,
      nextMeeting: c.nextMeeting ? { id: c.nextMeeting.id, title: c.nextMeeting.title, startsAt: c.nextMeeting.startsAt.toISOString() } : null,
      nextReport: next ? { label: next.label, due: next.due } : null,
      lateReports: late.map((s) => ({ label: s.label, daysLate: s.daysLate })),
      focal: c.focal,
      contacts: people.filter((p) => p.organisationId === c.id).length,
    };
  };
  const partners = cards.filter((c) => c.kind === "partner");
  const stakeholders = cards.filter((c) => c.kind !== "partner");
  const newKind = str(sp.new);
  return {
    tab: tab as "partners" | "stakeholders" | "contacts",
    today,
    cards: (tab === "stakeholders" ? stakeholders : partners).map(toCard),
    counts: { partners: partners.length, stakeholders: stakeholders.length, contacts: people.length },
    contacts: tab === "contacts" ? people : [],
    orgs: cards.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName })),
    newOrg: newKind === "1" || newKind === "partner" ? "partner" : newKind === "stakeholder" ? "other" : null,
  };
}
export type PartnersScreenData = Awaited<ReturnType<typeof loadPartnersScreen>>;

/** One organisation, Attio-style: the header, what is owed, reports, the timeline and the people. */
export async function loadPartnerPage(id: string, sp: SP): Promise<PartnerPageData | null> {
  const org = await getOrganisation(id);
  if (!org || org.deletedAt) return null;
  const today = todayStr();
  const typeParam = str(sp.type);
  const filter = (TIMELINE_TYPES as readonly string[]).includes(typeParam ?? "") ? (typeParam as TimelineItem["type"]) : null;
  const db = await getDb();
  const [open, upcoming, past, decs, docs, timeline, links, docCount, orgs] = await Promise.all([
    tasksLinkedTo({ type: "organisation", id }, { open: true }),
    meetingsWith(id, { upcoming: true, limit: 4 }),
    meetingsWith(id, { limit: 1 }),
    listDecisions({ orgId: id, limit: 6 }),
    partnerReportDocs([id]),
    partnerTimeline(id, { type: filter, limit: 80 }),
    listLinks({ type: "organisation", id }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(isNull(documents.deletedAt), sql`exists (select 1 from links l where l.from_type = 'document' and l.from_id = ${documents.id} and l.to_type = 'organisation' and l.to_id = ${id}::uuid)`)),
    db.select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName }).from(organisations).where(isNull(organisations.deletedAt)).orderBy(asc(organisations.name)),
  ]);
  const lastHeld = past.find((m) => m.startsAt.getTime() < Date.now()) ?? null;
  const toTask = (t: (typeof open)[number]) => ({ id: t.id, title: t.title, dueDate: t.dueDate, overdue: t.overdue, owner: t.ownerLabel });
  return {
    org: {
      id: org.id,
      name: org.name,
      shortName: org.shortName,
      kind: org.kind,
      provinces: org.provinces,
      agreementStart: org.agreementStart,
      agreementEnd: org.agreementEnd,
      focalContactId: org.focalContactId,
      reportingRhythm: org.reportingRhythm,
      reportDueDays: org.reportDueDays,
      statusLine: org.statusLine,
      notes: org.notes,
      website: org.website,
      updatedAt: org.updatedAt.toISOString(),
    },
    contacts: org.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone, notes: c.notes, organisationId: c.organisationId, orgName: null })),
    waiting: open.filter((t) => t.ownerKind !== "me").map(toTask),
    mine: open.filter((t) => t.ownerKind === "me").map(toTask),
    upcoming: upcoming.map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt.toISOString(), status: m.status })),
    lastMeeting: lastHeld ? { id: lastHeld.id, title: lastHeld.title, startsAt: lastHeld.startsAt.toISOString(), status: lastHeld.status } : null,
    decisions: decs.map((d) => ({ id: d.id, text: d.text, decidedOn: d.decidedOn, meetingId: d.meetingId, meetingTitle: d.meetingTitle })),
    reports: reportSlots(org, docs, today, { aheadDays: 200 }),
    timeline,
    filter,
    docCount: Number(docCount[0]?.n ?? 0),
    links: links
      .filter((l) => ["activity", "indicator", "collection", "report", "logframe"].includes(l.type))
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    orgs,
    today,
    highlight: str(sp.contact) ?? null,
  };
}
