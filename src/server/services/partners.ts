import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { addDaysStr, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { contacts, decisions, documents, meetings, notes, organisations, tasks } from "@/server/db/schema";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity } from "./activity";
import { indexDocument } from "./documents";
import { addLink } from "./links";

export const ORG_KINDS = ["partner", "donor", "government", "un", "ngo", "other"] as const;
export const RHYTHMS = ["none", "monthly", "quarterly", "biannual", "annual"] as const;

export const orgInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().max(40).nullish(),
  kind: z.enum(ORG_KINDS).optional(),
  provinces: z.array(z.string().max(60)).max(81).optional(),
  agreementStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  agreementEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  focalContactId: z.string().uuid().nullish(),
  reportingRhythm: z.enum(RHYTHMS).optional(),
  reportDueDays: z.number().int().min(0).max(120).optional(),
  statusLine: z.string().max(500).nullish(),
  notes: z.string().max(20000).nullish(),
  website: z.string().max(300).nullish(),
});
export type OrgInput = z.input<typeof orgInputSchema>;

export async function createOrganisation(raw: OrgInput) {
  const input = orgInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .insert(organisations)
    .values({ ...input, shortName: input.shortName || null, provinces: input.provinces ?? [] })
    .returning();
  await logActivity({ action: "create", entityType: "organisation", entityId: row!.id, title: row!.name });
  await indexOrganisation(row!.id);
  return row!;
}

export async function updateOrganisation(id: string, raw: Partial<OrgInput>) {
  const patch = orgInputSchema.partial().parse(raw);
  const db = await getDb();
  const [row] = await db
    .update(organisations)
    .set({ ...patch, ...(patch.shortName !== undefined ? { shortName: patch.shortName || null } : {}), updatedAt: new Date() })
    .where(eq(organisations.id, id))
    .returning();
  if (!row) return null;
  await logActivity({ action: "update", entityType: "organisation", entityId: id, title: row.name, summary: Object.keys(patch).join(", ") });
  await indexOrganisation(id);
  return row;
}

export const contactInputSchema = z.object({
  organisationId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(200),
  role: z.string().max(200).nullish(),
  email: z.string().max(200).nullish(),
  phone: z.string().max(60).nullish(),
  notes: z.string().max(5000).nullish(),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export async function createContact(raw: ContactInput) {
  const input = contactInputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db.insert(contacts).values(input).returning();
  await logActivity({ action: "create", entityType: "contact", entityId: row!.id, title: row!.name });
  await indexContact(row!.id);
  return row!;
}

export async function updateContact(id: string, raw: Partial<ContactInput>) {
  const patch = contactInputSchema.partial().parse(raw);
  const db = await getDb();
  const [row] = await db.update(contacts).set({ ...patch, updatedAt: new Date() }).where(eq(contacts.id, id)).returning();
  if (!row) return null;
  await indexContact(id);
  return row;
}

export async function indexOrganisation(id: string) {
  const db = await getDb();
  const [o] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
  if (!o || o.deletedAt) return unindexRecord("organisation", id);
  await indexRecord({
    type: "organisation",
    id,
    title: o.shortName ? `${o.name} (${o.shortName})` : o.name,
    body: [o.statusLine, o.notes, o.provinces.join(", "), o.website].filter(Boolean).join("\n"),
    meta: { kind: o.kind, orgIds: [id] },
    occurredAt: o.updatedAt,
  });
}

export async function indexContact(id: string) {
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c || c.deletedAt) return unindexRecord("contact", id);
  const [org] = c.organisationId ? await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, c.organisationId)).limit(1) : [];
  await indexRecord({
    type: "contact",
    id,
    title: c.name,
    body: [c.role, org?.name, c.email, c.phone, c.notes].filter(Boolean).join("\n"),
    meta: { orgIds: c.organisationId ? [c.organisationId] : [], organisationId: c.organisationId },
    occurredAt: c.updatedAt,
  });
}

/** Next report due dates from the reporting rhythm: period end + N days. */
export function reportDueDates(rhythm: string, dueDays: number, from: string, count = 4, agreementEnd?: string | null) {
  const months = rhythm === "monthly" ? 1 : rhythm === "quarterly" ? 3 : rhythm === "biannual" ? 6 : rhythm === "annual" ? 12 : 0;
  if (!months) return [] as { periodEnd: string; due: string; label: string }[];
  const out: { periodEnd: string; due: string; label: string }[] = [];
  const [y0, m0] = from.split("-").map(Number);
  // Walk period ends on the calendar grid (Mar/Jun/Sep/Dec for quarters).
  let y = y0!;
  let m = Math.ceil(m0! / months) * months; // month index 1..12 of the current period end
  for (let i = 0; out.length < count && i < 40; i++) {
    if (m > 12) {
      m -= 12;
      y++;
    }
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const due = addDaysStr(end, dueDays);
    if (due >= addDaysStr(from, -dueDays) && (!agreementEnd || end <= agreementEnd || out.length === 0)) {
      const label = months === 3 ? `${y} Q${Math.ceil(m / 3)}` : months === 6 ? `${y} H${m <= 6 ? 1 : 2}` : months === 12 ? `${y}` : `${y}-${String(m).padStart(2, "0")}`;
      out.push({ periodEnd: end, due, label });
    }
    m += months;
  }
  return out;
}

export type PartnerCard = typeof organisations.$inferSelect & {
  openTasks: number;
  waitingOn: number;
  overdue: number;
  nextMeeting: { id: string; title: string; startsAt: Date } | null;
  nextReport: { due: string; label: string } | null;
  focal: { id: string; name: string } | null;
};

/** "Ortaklar": one card per organisation with what is open, owed and next. */
export async function listPartnerCards(): Promise<PartnerCard[]> {
  const db = await getDb();
  const today = todayStr();
  const orgs = await db.select().from(organisations).where(isNull(organisations.deletedAt)).orderBy(asc(organisations.kind), asc(organisations.name));
  if (!orgs.length) return [];
  const ids = orgs.map((o) => o.id);
  const linked = sql`(t.owner_org_id = o.id or exists (select 1 from links l where l.from_type = 'task' and l.from_id = t.id and l.to_type = 'organisation' and l.to_id = o.id))`;
  const counts = (await db.execute(sql`
    select o.id,
      (select count(*)::int from tasks t where t.deleted_at is null and t.parent_id is null and t.status in ('todo','doing','waiting') and ${linked}) as open,
      (select count(*)::int from tasks t where t.deleted_at is null and t.parent_id is null and t.status in ('todo','doing','waiting') and t.owner_org_id = o.id) as waiting,
      (select count(*)::int from tasks t where t.deleted_at is null and t.parent_id is null and t.status in ('todo','doing','waiting') and ${linked} and t.due_date < ${today}) as overdue
    from organisations o where o.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as {
    rows: { id: string; open: number; waiting: number; overdue: number }[];
  };
  const byId = new Map((counts.rows ?? []).map((r) => [r.id, r]));
  const next = (await db.execute(sql`
    select distinct on (l.to_id) l.to_id as org, m.id, m.title, m.starts_at
    from meetings m join links l on l.from_type = 'meeting' and l.from_id = m.id and l.to_type = 'organisation'
    where m.deleted_at is null and m.status = 'planned' and m.starts_at >= now()
    order by l.to_id, m.starts_at asc`)) as unknown as { rows: { org: string; id: string; title: string; starts_at: string }[] };
  const nextByOrg = new Map((next.rows ?? []).map((r) => [r.org, { id: r.id, title: r.title, startsAt: new Date(r.starts_at) }]));
  const focalIds = orgs.map((o) => o.focalContactId).filter(Boolean) as string[];
  const focals = focalIds.length ? await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, focalIds)) : [];
  const focalById = new Map(focals.map((f) => [f.id, f]));
  return orgs.map((o) => {
    const c = byId.get(o.id);
    const due = reportDueDates(o.reportingRhythm, o.reportDueDays, today, 1, o.agreementEnd)[0];
    return {
      ...o,
      openTasks: Number(c?.open ?? 0),
      waitingOn: Number(c?.waiting ?? 0),
      overdue: Number(c?.overdue ?? 0),
      nextMeeting: nextByOrg.get(o.id) ?? null,
      nextReport: due ? { due: due.due, label: due.label } : null,
      focal: o.focalContactId ? (focalById.get(o.focalContactId) ?? null) : null,
    };
  });
}

export async function getOrganisation(id: string) {
  const db = await getDb();
  const [o] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
  if (!o) return null;
  const people = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.organisationId, id), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.name));
  return { ...o, contacts: people };
}

export async function meetingsWith(orgId: string, opts: { upcoming?: boolean; limit?: number } = {}) {
  const db = await getDb();
  return db
    .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt, status: meetings.status, kind: meetings.kind })
    .from(meetings)
    .where(
      and(
        isNull(meetings.deletedAt),
        sql`exists (select 1 from links l where l.from_type = 'meeting' and l.from_id = ${meetings.id} and l.to_type = 'organisation' and l.to_id = ${orgId}::uuid)`,
        opts.upcoming ? gte(meetings.startsAt, new Date()) : undefined,
      ),
    )
    .orderBy(opts.upcoming ? asc(meetings.startsAt) : desc(meetings.startsAt))
    .limit(opts.limit ?? 20);
}

/** Tasks she is waiting on from this partner, oldest promise first. */
export async function waitingFrom(orgId: string) {
  const db = await getDb();
  return db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        inArray(tasks.status, ["todo", "doing", "waiting"]),
        or(eq(tasks.ownerOrgId, orgId), sql`exists (select 1 from contacts c where c.id = ${tasks.ownerContactId} and c.organisation_id = ${orgId}::uuid)`),
        ne(tasks.ownerKind, "me"),
      ),
    )
    .orderBy(asc(tasks.dueDate));
}

/* ---------------------------- Reporting calendar ---------------------------- */

export type ReportDoc = { id: string; title: string; period: string | null; created: string; org: string };
export type ReportSlot = {
  label: string;
  periodEnd: string;
  due: string;
  status: "received" | "late" | "due" | "upcoming";
  daysLate: number;
  doc: { id: string; title: string } | null;
};

/** Partner reports on file: documents of type "Ortak raporu" linked to the organisation. */
export async function partnerReportDocs(orgIds?: string[]): Promise<ReportDoc[]> {
  const db = await getDb();
  const rows = (await db.execute(sql`
    select d.id, d.title, d.period_label, d.created_at, l.to_id as org
    from documents d
    join links l on l.from_type = 'document' and l.from_id = d.id and l.to_type = 'organisation'
    where d.deleted_at is null and d.doc_type = 'partner_report'
    ${orgIds?.length ? sql`and l.to_id in (${sql.join(orgIds.map((o) => sql`${o}::uuid`), sql`, `)})` : sql``}
    order by d.created_at asc`)) as unknown as { rows: { id: string; title: string; period_label: string | null; created_at: string | Date; org: string }[] };
  return (rows.rows ?? []).map((r) => ({ id: r.id, title: r.title, period: r.period_label, created: new Date(r.created_at).toISOString().slice(0, 10), org: r.org }));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Expected reports from the agreement start (or a year back) to a few months
 * ahead. A report counts for a period when its period label matches, or when
 * it arrived after that period ended and before the next one did.
 */
export function reportSlots(
  org: { reportingRhythm: string; reportDueDays: number; agreementStart: string | null; agreementEnd: string | null },
  docs: ReportDoc[],
  today = todayStr(),
  opts: { aheadDays?: number } = {},
): ReportSlot[] {
  if (org.reportingRhythm === "none") return [];
  const from = org.agreementStart ?? addDaysStr(today, -365);
  const until = addDaysStr(today, opts.aheadDays ?? 200);
  const dates = reportDueDates(org.reportingRhythm, org.reportDueDays, from, 60, org.agreementEnd).filter(
    (d) => d.periodEnd >= from && d.periodEnd <= until,
  );
  const used = new Set<string>();
  const byLabel = new Map<string, ReportDoc>();
  for (const d of docs) if (d.period && !byLabel.has(norm(d.period))) byLabel.set(norm(d.period), d);
  const slots = dates.map((d) => {
    const doc = byLabel.get(norm(d.label)) ?? null;
    if (doc) used.add(doc.id);
    return { ...d, doc };
  });
  // Reports without a matching label fill the period they arrived after.
  slots.forEach((s, i) => {
    if (s.doc) return;
    const nextEnd = slots[i + 1]?.periodEnd ?? until;
    const doc = docs.find((d) => !used.has(d.id) && d.created > s.periodEnd && d.created <= addDaysStr(nextEnd, org.reportDueDays));
    if (doc) {
      used.add(doc.id);
      s.doc = doc;
    }
  });
  return slots.map((s) => {
    const daysLate = s.due < today ? Math.round((Date.parse(today) - Date.parse(s.due)) / 86_400_000) : 0;
    const status: ReportSlot["status"] = s.doc ? "received" : s.due < today ? "late" : s.periodEnd <= today || s.due <= addDaysStr(today, 30) ? "due" : "upcoming";
    return { label: s.label, periodEnd: s.periodEnd, due: s.due, status, daysLate: s.doc ? 0 : daysLate, doc: s.doc ? { id: s.doc.id, title: s.doc.title } : null };
  });
}

/** She marks a file as the partner's report for a period. */
export async function markPartnerReport(orgId: string, documentId: string, periodLabel: string) {
  const db = await getDb();
  const [doc] = await db
    .update(documents)
    .set({ docType: "partner_report", periodLabel, classificationStatus: "confirmed", updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .returning();
  if (!doc) return null;
  await addLink({ type: "document", id: documentId }, { type: "organisation", id: orgId }, "partner");
  await logActivity({ action: "update", entityType: "document", entityId: documentId, title: doc.title, summary: "docType, periodLabel" });
  await indexDocument(documentId);
  return doc;
}

/* --------------------------------- Timeline --------------------------------- */

export type TimelineItem = {
  key: string;
  type: "meeting" | "document" | "decision" | "task" | "note";
  date: string;
  title: string;
  href: string;
  meta: string | null;
  state?: string | null;
};

/** Attio's activity timeline: everything that happened with this organisation, newest first. */
export async function partnerTimeline(orgId: string, opts: { type?: TimelineItem["type"] | null; limit?: number } = {}): Promise<TimelineItem[]> {
  const db = await getDb();
  const want = (t: TimelineItem["type"]) => !opts.type || opts.type === t;
  const linkedTo = (fromType: string, col: unknown) =>
    sql`exists (select 1 from links l where l.from_type = ${fromType} and l.from_id = ${col} and l.to_type = 'organisation' and l.to_id = ${orgId}::uuid)`;
  const limit = opts.limit ?? 80;
  const [ms, ds, decs, ts, ns] = await Promise.all([
    want("meeting")
      ? db
          .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt, status: meetings.status })
          .from(meetings)
          .where(and(isNull(meetings.deletedAt), linkedTo("meeting", meetings.id), sql`${meetings.startsAt} <= now() + interval '60 days'`))
          .orderBy(desc(meetings.startsAt))
          .limit(limit)
      : [],
    want("document")
      ? db
          .select({ id: documents.id, title: documents.title, createdAt: documents.createdAt, docType: documents.docType, periodLabel: documents.periodLabel })
          .from(documents)
          .where(and(isNull(documents.deletedAt), linkedTo("document", documents.id)))
          .orderBy(desc(documents.createdAt))
          .limit(limit)
      : [],
    want("decision")
      ? db
          .select({ id: decisions.id, text: decisions.text, decidedOn: decisions.decidedOn, meetingId: decisions.meetingId })
          .from(decisions)
          .where(
            and(
              isNull(decisions.deletedAt),
              sql`(${decisions.organisationId} = ${orgId}::uuid or exists (select 1 from links l where l.from_type = 'meeting' and l.from_id = ${decisions.meetingId} and l.to_type = 'organisation' and l.to_id = ${orgId}::uuid))`,
            ),
          )
          .orderBy(desc(decisions.decidedOn))
          .limit(limit)
      : [],
    want("task")
      ? db
          .select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt, completedAt: tasks.completedAt, status: tasks.status, dueDate: tasks.dueDate })
          .from(tasks)
          .where(and(isNull(tasks.deletedAt), sql`(${tasks.ownerOrgId} = ${orgId}::uuid or ${linkedTo("task", tasks.id)})`))
          .orderBy(desc(tasks.createdAt))
          .limit(limit)
      : [],
    want("note")
      ? db
          .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt, dailyDate: notes.dailyDate })
          .from(notes)
          .where(and(isNull(notes.deletedAt), linkedTo("note", notes.id)))
          .orderBy(desc(notes.updatedAt))
          .limit(limit)
      : [],
  ]);
  const items: TimelineItem[] = [
    ...ms.map((m) => ({ key: `m:${m.id}`, type: "meeting" as const, date: m.startsAt.toISOString(), title: m.title, href: `/meetings/${m.id}`, meta: null, state: m.status })),
    ...ds.map((d) => ({ key: `d:${d.id}`, type: "document" as const, date: d.createdAt.toISOString(), title: d.title, href: `/files/d/${d.id}`, meta: d.periodLabel, state: d.docType })),
    ...decs.map((d) => ({ key: `c:${d.id}`, type: "decision" as const, date: `${d.decidedOn}T12:00:00.000Z`, title: d.text, href: d.meetingId ? `/meetings/${d.meetingId}` : `/meetings/decisions#${d.id}`, meta: null })),
    ...ts.map((t) => ({
      key: `t:${t.id}`,
      type: "task" as const,
      date: (t.completedAt ?? t.createdAt).toISOString(),
      title: t.title,
      href: `/tasks?open=${t.id}`,
      meta: t.dueDate,
      state: t.status,
    })),
    ...ns.map((n) => ({ key: `n:${n.id}`, type: "note" as const, date: n.updatedAt.toISOString(), title: n.title || n.dailyDate || "", href: `/notes/${n.id}`, meta: null })),
  ];
  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
