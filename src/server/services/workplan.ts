import "server-only";
import type { ActivityItem } from "@/components/workplan/types";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { addDaysStr, daysBetween, todayStr } from "@/lib/dates";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { activities, activityDependencies, holidays, logframeNodes, seasons } from "@/server/db/schema";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { linkedIds, setLinks } from "./links";

export const ACTIVITY_STATUSES = ["planned", "ongoing", "done", "delayed", "canceled"] as const;

export const activityInputSchema = z.object({
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000).nullish(),
  logframeNodeId: z.string().uuid().nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  provinces: z.array(z.string().max(60)).max(81).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  isMilestone: z.boolean().optional(),
  orgIds: z.array(z.string().uuid()).max(20).optional(),
});
export type ActivityInput = z.input<typeof activityInputSchema>;

export async function createActivity(raw: ActivityInput, actor: Actor = "user") {
  const input = activityInputSchema.parse(raw);
  const db = await getDb();
  const [{ max } = { max: 0 }] = (await db.select({ max: sql<number>`coalesce(max(${activities.sort}), 0)::int` }).from(activities)) as { max: number }[];
  const { orgIds, ...values } = input;
  const [row] = await db
    .insert(activities)
    .values({ ...values, provinces: values.provinces ?? [], sort: Number(max) + 10, endDate: values.isMilestone ? (values.startDate ?? null) : (values.endDate ?? null) })
    .returning();
  if (orgIds?.length) await setLinks({ type: "activity", id: row!.id }, "partner", orgIds.map((id) => ({ type: "organisation" as const, id })));
  await logActivity({ action: "create", entityType: "activity", entityId: row!.id, title: `${row!.code} ${row!.title}`, actor });
  await indexActivity(row!.id);
  return row!;
}

export async function updateActivity(id: string, raw: Partial<ActivityInput> & { sort?: number }, opts: { shiftDependents?: boolean } = {}) {
  const patch = activityInputSchema.partial().extend({ sort: z.number().int().optional() }).parse(raw);
  const db = await getDb();
  const [before] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!before) return null;
  const { orgIds, ...values } = patch;
  const start = values.startDate !== undefined ? values.startDate : before.startDate;
  const end = values.endDate !== undefined ? values.endDate : before.endDate;
  if (start && end && end < start) throw new UserError("Bitiş tarihi başlangıçtan önce olamaz.");
  const [row] = await db.update(activities).set({ ...values, updatedAt: new Date() }).where(eq(activities.id, id)).returning();
  if (orgIds) await setLinks({ type: "activity", id }, "partner", orgIds.map((o) => ({ type: "organisation" as const, id: o })));
  // Moving an activity can push the ones that wait for it (Gantt "shift dependents").
  if (opts.shiftDependents && before.endDate && row!.endDate && row!.endDate > before.endDate) {
    await shiftDependents(id);
  }
  await logActivity({ action: "update", entityType: "activity", entityId: id, title: `${row!.code} ${row!.title}`, summary: Object.keys(patch).join(", ") });
  await indexActivity(id);
  return row!;
}

/**
 * Activities that wait for this one move only when they would now start
 * before it ends, to its next working day (Asana's "consume buffer"):
 * a gap she planned, such as waiting for the harvest to end, stays.
 */
async function shiftDependents(id: string, seen = new Set<string>()) {
  if (seen.has(id)) return;
  seen.add(id);
  const db = await getDb();
  const [self] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!self?.endDate) return;
  const deps = await db.select({ id: activityDependencies.activityId }).from(activityDependencies).where(eq(activityDependencies.dependsOnId, id));
  for (const d of deps) {
    const [a] = await db.select().from(activities).where(eq(activities.id, d.id)).limit(1);
    if (!a?.startDate || a.status === "done" || a.status === "canceled" || a.startDate > self.endDate) continue;
    const days = daysBetween(a.startDate, await nextWorkingDay(addDaysStr(self.endDate, 1)));
    await db
      .update(activities)
      .set({ startDate: addDaysStr(a.startDate, days), endDate: a.endDate ? addDaysStr(a.endDate, days) : null, updatedAt: new Date() })
      .where(eq(activities.id, a.id));
    await shiftDependents(a.id, seen);
  }
}

type Dates = { id: string; startDate: string | null; endDate: string | null };

/** A drag on the timeline. Activities that wait for this one move along; the old dates come back for undo. */
export async function moveActivity(id: string, startDate: string | null, endDate: string | null, opts: { shiftDependents?: boolean } = {}) {
  const db = await getDb();
  const snapshot = () => db.select({ id: activities.id, startDate: activities.startDate, endDate: activities.endDate }).from(activities).where(isNull(activities.deletedAt));
  const before = await snapshot();
  const row = await updateActivity(id, { startDate, endDate }, { shiftDependents: opts.shiftDependents ?? true });
  if (!row) return null;
  const prev = new Map(before.map((b) => [b.id, b]));
  const previous: Dates[] = (await snapshot()).flatMap((a) => {
    const b = prev.get(a.id);
    return b && (b.startDate !== a.startDate || b.endDate !== a.endDate) ? [b] : [];
  });
  for (const p of previous) if (p.id !== id) await indexActivity(p.id);
  return { previous, shifted: previous.filter((p) => p.id !== id).length };
}

/** Undo of a move: every activity back to the dates it had. */
export async function restoreDates(list: Dates[]) {
  const db = await getDb();
  for (const d of list) {
    await db.update(activities).set({ startDate: d.startDate, endDate: d.endDate, updatedAt: new Date() }).where(eq(activities.id, d.id));
    await indexActivity(d.id);
  }
}

export async function addDependency(activityId: string, dependsOnId: string) {
  if (activityId === dependsOnId) throw new UserError("Bir faaliyet kendine bağlı olamaz.");
  const db = await getDb();
  // Refuse cycles: dependsOn must not (transitively) depend on activityId.
  const res = (await db.execute(sql`
    with recursive up as (
      select depends_on_id as id from activity_dependencies where activity_id = ${dependsOnId}::uuid
      union
      select d.depends_on_id from activity_dependencies d join up on d.activity_id = up.id
    ) select 1 as hit from up where id = ${activityId}::uuid limit 1`)) as unknown as { rows: unknown[] };
  if (res.rows?.length) throw new UserError("Bu bağlantı bir döngü oluşturur.");
  await db.insert(activityDependencies).values({ activityId, dependsOnId }).onConflictDoNothing();
}

export async function removeDependency(activityId: string, dependsOnId: string) {
  const db = await getDb();
  await db.delete(activityDependencies).where(and(eq(activityDependencies.activityId, activityId), eq(activityDependencies.dependsOnId, dependsOnId)));
}

export type ActivityView = typeof activities.$inferSelect & {
  orgIds: string[];
  dependsOn: string[];
  nodeCode: string | null;
  late: boolean;
};

export async function listActivities(): Promise<ActivityView[]> {
  const db = await getDb();
  const today = todayStr();
  const rows = await db
    .select({ a: activities, nodeCode: logframeNodes.code })
    .from(activities)
    .leftJoin(logframeNodes, eq(logframeNodes.id, activities.logframeNodeId))
    .where(isNull(activities.deletedAt))
    .orderBy(asc(activities.sort), asc(activities.code));
  const deps = await db.select().from(activityDependencies);
  const links = (await db.execute(sql`select from_id, to_id from links where from_type = 'activity' and to_type = 'organisation'`)) as unknown as { rows: { from_id: string; to_id: string }[] };
  const orgsBy = new Map<string, string[]>();
  for (const l of links.rows ?? []) orgsBy.set(l.from_id, [...(orgsBy.get(l.from_id) ?? []), l.to_id]);
  const depsBy = new Map<string, string[]>();
  for (const d of deps) depsBy.set(d.activityId, [...(depsBy.get(d.activityId) ?? []), d.dependsOnId]);
  return rows.map(({ a, nodeCode }) => ({
    ...a,
    nodeCode,
    orgIds: orgsBy.get(a.id) ?? [],
    dependsOn: depsBy.get(a.id) ?? [],
    late: Boolean(a.endDate && a.endDate < today && a.status !== "done" && a.status !== "canceled"),
  }));
}

/** Open tasks linked to each activity, in either direction. */
export async function openTaskCounts() {
  const db = await getDb();
  const res = (await db.execute(sql`
    select x.a_id as id, count(distinct x.t_id)::int as n from (
      select l.to_id as a_id, l.from_id as t_id from links l where l.from_type = 'task' and l.to_type = 'activity'
      union
      select l.from_id, l.to_id from links l where l.from_type = 'activity' and l.to_type = 'task'
    ) x join tasks t on t.id = x.t_id
    where t.deleted_at is null and t.status in ('todo','doing','waiting')
    group by x.a_id`)) as unknown as { rows: { id: string; n: number }[] };
  return new Map((res.rows ?? []).map((r) => [r.id, Number(r.n)]));
}

/**
 * Late: past its end and not finished, or marked delayed. At risk: anything
 * that waits (directly or further down the chain) for a late activity, or
 * starts before the one it waits for has ended (Notion's dependency warning).
 */
export function decorateActivities(list: ActivityView[], counts: Map<string, number>, today = todayStr()): ActivityItem[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const closed = (a: ActivityView) => a.status === "done" || a.status === "canceled";
  const late = new Set(list.filter((a) => !closed(a) && (a.status === "delayed" || Boolean(a.endDate && a.endDate < today))).map((a) => a.id));
  const dependents = new Map<string, string[]>();
  for (const a of list) for (const d of a.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), a.id]);
  const risk = new Set<string>();
  const queue = [...late];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of dependents.get(id) ?? []) {
      if (risk.has(next)) continue;
      risk.add(next);
      queue.push(next);
    }
  }
  for (const a of list) {
    if (!a.startDate) continue;
    for (const d of a.dependsOn) {
      const pred = byId.get(d);
      if (pred && !closed(pred) && pred.endDate && pred.endDate >= a.startDate) risk.add(a.id);
    }
  }
  return list.map((a) => ({
    id: a.id,
    code: a.code,
    title: a.title,
    description: a.description,
    logframeNodeId: a.logframeNodeId,
    startDate: a.startDate,
    endDate: a.endDate,
    status: a.status as ActivityItem["status"],
    provinces: a.provinces,
    progress: a.progress,
    isMilestone: a.isMilestone,
    orgIds: a.orgIds,
    dependsOn: a.dependsOn,
    late: late.has(a.id),
    atRisk: !closed(a) && !late.has(a.id) && risk.has(a.id),
    openTasks: counts.get(a.id) ?? 0,
  }));
}

/** One activity as plain facts, for Claude (read_record and the assistant's screen context). */
export async function activityFactsText(id: string) {
  const list = decorateActivities(await listActivities(), await openTaskCounts());
  const a = list.find((x) => x.id === id);
  if (!a) return null;
  const db = await getDb();
  const [node] = a.logframeNodeId ? await db.select().from(logframeNodes).where(eq(logframeNodes.id, a.logframeNodeId)).limit(1) : [];
  const { organisations, tasks, links } = await import("@/server/db/schema");
  const orgs = a.orgIds.length ? await db.select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName }).from(organisations) : [];
  const name = (oid: string) => {
    const o = orgs.find((x) => x.id === oid);
    return o ? o.shortName || o.name : "?";
  };
  const byId = new Map(list.map((x) => [x.id, x]));
  const open = await db
    .select({ title: tasks.title, dueDate: tasks.dueDate, status: tasks.status })
    .from(tasks)
    .innerJoin(links, and(eq(links.fromType, "task"), eq(links.fromId, tasks.id), eq(links.toType, "activity"), eq(links.toId, id)))
    .where(isNull(tasks.deletedAt));
  const lines = [
    `Activity ${a.code}: ${a.title}`,
    `Status: ${a.status}, ${a.progress}% done${a.late ? ", LATE" : ""}${a.atRisk ? ", AT RISK (waits for something late)" : ""}${a.isMilestone ? ", milestone" : ""}`,
    `Dates: ${a.startDate ?? "?"} to ${a.endDate ?? "?"}`,
    node ? `Output: ${node.code} ${node.title}` : "",
    a.orgIds.length ? `Partners: ${a.orgIds.map(name).join(", ")}` : "",
    a.provinces.length ? `Provinces: ${a.provinces.join(", ")}` : "",
    a.description ? `Description:\n${a.description}` : "",
    ...a.dependsOn.map((d) => {
      const p = byId.get(d);
      return p ? `Waits for ${p.code} ${p.title} (${p.status}, ends ${p.endDate ?? "?"}${p.late ? ", late" : ""})` : "";
    }),
    ...list.filter((x) => x.dependsOn.includes(id)).map((x) => `Waited for by ${x.code} ${x.title} (starts ${x.startDate ?? "?"})`),
    ...open.filter((t) => t.status !== "canceled").map((t) => `Task: ${t.title} (${t.status}${t.dueDate ? `, due ${t.dueDate}` : ""})`),
  ];
  return { title: `${a.code} ${a.title}`, text: lines.filter(Boolean).join("\n"), date: a.startDate };
}

export async function activitiesInRange(from: string, to: string) {
  const db = await getDb();
  return db
    .select()
    .from(activities)
    .where(and(isNull(activities.deletedAt), lte(activities.startDate, to), gte(activities.endDate, from)))
    .orderBy(asc(activities.startDate));
}

export async function indexActivity(id: string) {
  const db = await getDb();
  const [a] = await db.select().from(activities).where(eq(activities.id, id)).limit(1);
  if (!a || a.deletedAt) return unindexRecord("activity", id);
  const orgIds = await linkedIds({ type: "activity", id }, "organisation");
  await indexRecord({
    type: "activity",
    id,
    title: `${a.code} ${a.title}`,
    body: [a.description, a.provinces.join(", "), a.status].filter(Boolean).join("\n"),
    meta: { status: a.status, orgIds, startDate: a.startDate, endDate: a.endDate },
    occurredAt: a.startDate ? new Date(a.startDate) : a.createdAt,
  });
}

/* ------------------------------ Seasons and holidays ------------------------------ */

export const SEASON_PRESETS = [
  { name: "Fındık hasadı", crop: "Fındık", provinces: ["Ordu", "Giresun", "Sakarya", "Düzce", "Samsun"], startMonth: 8, startDay: 1, endMonth: 9, endDay: 30 },
  { name: "Pamuk hasadı", crop: "Pamuk", provinces: ["Şanlıurfa", "Adana", "Hatay", "Diyarbakır", "Aydın"], startMonth: 9, startDay: 1, endMonth: 11, endDay: 30 },
  { name: "Kayısı hasadı", crop: "Kayısı", provinces: ["Malatya"], startMonth: 6, startDay: 15, endMonth: 7, endDay: 31 },
  { name: "Şeker pancarı", crop: "Şeker pancarı", provinces: ["Konya", "Eskişehir", "Yozgat"], startMonth: 9, startDay: 15, endMonth: 11, endDay: 15 },
  { name: "Narenciye", crop: "Narenciye", provinces: ["Adana", "Mersin", "Hatay", "Antalya"], startMonth: 10, startDay: 15, endMonth: 3, endDay: 31 },
  { name: "Çay hasadı", crop: "Çay", provinces: ["Rize", "Trabzon", "Artvin"], startMonth: 5, startDay: 1, endMonth: 10, endDay: 15 },
] as const;

export async function listSeasons() {
  const db = await getDb();
  return db.select().from(seasons).orderBy(asc(seasons.startMonth), asc(seasons.name));
}

export const seasonSchema = z.object({
  name: z.string().trim().min(1).max(120),
  crop: z.string().max(80).nullish(),
  provinces: z.array(z.string().max(60)).max(81).default([]),
  startMonth: z.number().int().min(1).max(12),
  startDay: z.number().int().min(1).max(31).default(1),
  endMonth: z.number().int().min(1).max(12),
  endDay: z.number().int().min(1).max(31).default(28),
  notes: z.string().max(2000).nullish(),
  active: z.boolean().default(true),
});

export async function saveSeason(id: string | null, raw: z.input<typeof seasonSchema>) {
  const input = seasonSchema.parse(raw);
  const db = await getDb();
  if (id) {
    const [row] = await db.update(seasons).set({ ...input, updatedAt: new Date() }).where(eq(seasons.id, id)).returning();
    return row ?? null;
  }
  const [row] = await db.insert(seasons).values(input).returning();
  return row!;
}

export async function deleteSeason(id: string) {
  const db = await getDb();
  await db.delete(seasons).where(eq(seasons.id, id));
}

/**
 * Public holidays of Türkiye. Religious holidays follow the lunar calendar;
 * dates for later years are best estimates and should be checked against
 * the Diyanet calendar (she can edit them in İş planı → Tatiller).
 */
const HOLIDAYS: { date: string; tr: string; en: string; kind: "public" | "religious"; half?: boolean }[] = (() => {
  const out: { date: string; tr: string; en: string; kind: "public" | "religious"; half?: boolean }[] = [];
  for (const y of [2026, 2027, 2028, 2029, 2030]) {
    out.push(
      { date: `${y}-01-01`, tr: "Yılbaşı", en: "New Year's Day", kind: "public" },
      { date: `${y}-04-23`, tr: "Ulusal Egemenlik ve Çocuk Bayramı", en: "National Sovereignty and Children's Day", kind: "public" },
      { date: `${y}-05-01`, tr: "Emek ve Dayanışma Günü", en: "Labour and Solidarity Day", kind: "public" },
      { date: `${y}-05-19`, tr: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", en: "Commemoration of Atatürk, Youth and Sports Day", kind: "public" },
      { date: `${y}-07-15`, tr: "Demokrasi ve Millî Birlik Günü", en: "Democracy and National Unity Day", kind: "public" },
      { date: `${y}-08-30`, tr: "Zafer Bayramı", en: "Victory Day", kind: "public" },
      { date: `${y}-10-28`, tr: "Cumhuriyet Bayramı arifesi", en: "Republic Day eve", kind: "public", half: true },
      { date: `${y}-10-29`, tr: "Cumhuriyet Bayramı", en: "Republic Day", kind: "public" },
    );
  }
  const religious: [string, number, string, number][] = [
    // [first day of Ramazan Bayramı, days, first day of Kurban Bayramı, days]
    ["2026-03-20", 3, "2026-05-27", 4],
    ["2027-03-09", 3, "2027-05-16", 4],
    ["2028-02-26", 3, "2028-05-04", 4],
    ["2029-02-14", 3, "2029-04-23", 4],
    ["2030-02-04", 3, "2030-04-13", 4],
  ];
  for (const [rStart, rDays, kStart, kDays] of religious) {
    out.push({ date: addDaysStr(rStart, -1), tr: "Ramazan Bayramı arifesi", en: "Eid al-Fitr eve", kind: "religious", half: true });
    for (let i = 0; i < rDays; i++) out.push({ date: addDaysStr(rStart, i), tr: `Ramazan Bayramı ${i + 1}. gün`, en: `Eid al-Fitr day ${i + 1}`, kind: "religious" });
    out.push({ date: addDaysStr(kStart, -1), tr: "Kurban Bayramı arifesi", en: "Eid al-Adha eve", kind: "religious", half: true });
    for (let i = 0; i < kDays; i++) out.push({ date: addDaysStr(kStart, i), tr: `Kurban Bayramı ${i + 1}. gün`, en: `Eid al-Adha day ${i + 1}`, kind: "religious" });
  }
  return out;
})();

export async function ensureHolidays() {
  const db = await getDb();
  const [{ n } = { n: 0 }] = (await db.select({ n: sql<number>`count(*)::int` }).from(holidays)) as { n: number }[];
  if (Number(n) > 0) return;
  await db.insert(holidays).values(HOLIDAYS.map((h) => ({ date: h.date, nameTr: h.tr, nameEn: h.en, kind: h.kind, halfDay: Boolean(h.half) })));
}

export async function listHolidays(from?: string, to?: string) {
  await ensureHolidays();
  const db = await getDb();
  return db
    .select()
    .from(holidays)
    .where(and(from ? gte(holidays.date, from) : undefined, to ? lte(holidays.date, to) : undefined))
    .orderBy(asc(holidays.date));
}

export async function saveHoliday(id: string | null, input: { date: string; nameTr: string; nameEn: string; kind?: string; halfDay?: boolean }) {
  const db = await getDb();
  if (id) {
    const [row] = await db.update(holidays).set(input).where(eq(holidays.id, id)).returning();
    return row ?? null;
  }
  const [row] = await db.insert(holidays).values({ ...input, kind: input.kind ?? "public", halfDay: input.halfDay ?? false }).returning();
  return row!;
}

export async function deleteHoliday(id: string) {
  const db = await getDb();
  await db.delete(holidays).where(eq(holidays.id, id));
}

/** Is a day a working day (not a weekend, not a full holiday)? */
export async function isWorkingDay(day: string) {
  const d = new Date(day + "T12:00:00Z").getUTCDay();
  if (d === 0 || d === 6) return false;
  const db = await getDb();
  const [h] = await db.select().from(holidays).where(and(eq(holidays.date, day), eq(holidays.halfDay, false))).limit(1);
  return !h;
}

/** The first working day on or after a date. */
export async function nextWorkingDay(day: string) {
  let d = day;
  for (let i = 0; i < 20; i++) {
    if (await isWorkingDay(d)) return d;
    d = addDaysStr(d, 1);
  }
  return day;
}

/** Seasons as dated bands within a range of years, for the Gantt background. */
export function seasonBands(list: { id: string; name: string; startMonth: number; startDay: number; endMonth: number; endDay: number; active: boolean }[], fromYear: number, toYear: number) {
  const out: { id: string; name: string; start: string; end: string }[] = [];
  for (const s of list.filter((x) => x.active)) {
    for (let y = fromYear - 1; y <= toYear; y++) {
      const start = `${y}-${String(s.startMonth).padStart(2, "0")}-${String(s.startDay).padStart(2, "0")}`;
      const endYear = s.endMonth < s.startMonth ? y + 1 : y;
      const end = `${endYear}-${String(s.endMonth).padStart(2, "0")}-${String(Math.min(s.endDay, 28 + (s.endMonth === 2 ? 0 : 3))).padStart(2, "0")}`;
      if (endYear >= fromYear && y <= toYear) out.push({ id: `${s.id}-${y}`, name: s.name, start, end });
    }
  }
  return out;
}
