import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDaysStr, todayStr, weekRange } from "@/lib/dates";
import { describeRule, nextOccurrence } from "@/lib/parse-task";
import { getDb } from "@/server/db/client";
import { contacts, organisations, tasks } from "@/server/db/schema";
import type { EntityRef } from "@/server/entities";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { logActivity, type Actor } from "./activity";
import { addLink, linkedIds, setLinks } from "./links";
import { idsWithTag, setTags, tagsFor, addTags } from "./tags";

export const TASK_STATUSES = ["todo", "doing", "waiting", "done", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
const OPEN: TaskStatus[] = ["todo", "doing", "waiting"];

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000).nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  estimateMin: z.number().int().min(1).max(24 * 60).nullish(),
  ownerKind: z.enum(["me", "contact", "organisation", "person"]).optional(),
  ownerContactId: z.string().uuid().nullish(),
  ownerOrgId: z.string().uuid().nullish(),
  ownerName: z.string().max(120).nullish(),
  parentId: z.string().uuid().nullish(),
  recurrence: z.string().max(200).nullish(),
  recurrenceLabel: z.string().max(200).nullish(),
  reminderAt: z.coerce.date().nullish(),
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  inbox: z.boolean().optional(),
  sourceType: z.string().max(40).nullish(),
  sourceId: z.string().uuid().nullish(),
  templateId: z.string().uuid().nullish(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  orgIds: z.array(z.string().uuid()).max(10).optional(),
  links: z.array(z.object({ type: z.string(), id: z.string().uuid() })).max(20).optional(),
});
export type TaskInput = z.input<typeof taskInputSchema>;

export type TaskRow = typeof tasks.$inferSelect;

export type TaskView = TaskRow & {
  ownerLabel: string | null;
  tags: { name: string; slug: string }[];
  subtaskCount: number;
  subtaskDone: number;
  subtasks?: { id: string; title: string; status: string }[];
  overdue: boolean;
  orgIds: string[];
};

/** Who owns the task, normalised from the input. */
function ownerFields(input: TaskInput) {
  if (input.ownerOrgId) return { ownerKind: "organisation", ownerOrgId: input.ownerOrgId, ownerContactId: null, ownerName: null };
  if (input.ownerContactId) return { ownerKind: "contact", ownerContactId: input.ownerContactId, ownerOrgId: null, ownerName: null };
  if (input.ownerName) return { ownerKind: "person", ownerName: input.ownerName, ownerOrgId: null, ownerContactId: null };
  return { ownerKind: input.ownerKind ?? "me", ownerOrgId: null, ownerContactId: null, ownerName: null };
}

export async function createTask(raw: TaskInput, actor: Actor = "user") {
  const input = taskInputSchema.parse(raw);
  const db = await getDb();
  const owner = ownerFields(input);
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      notes: input.notes ?? null,
      status: input.status ?? "todo",
      priority: input.priority ?? 4,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      estimateMin: input.estimateMin ?? null,
      ...owner,
      parentId: input.parentId ?? null,
      recurrence: input.recurrence ?? null,
      recurrenceLabel: input.recurrence ? (input.recurrenceLabel ?? describeRule(input.recurrence)) : null,
      reminderAt: input.reminderAt ?? null,
      planDate: input.planDate ?? null,
      inbox: input.inbox ?? false,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      templateId: input.templateId ?? null,
      completedAt: input.status === "done" ? new Date() : null,
    })
    .returning();
  const task = row!;
  const ref: EntityRef = { type: "task", id: task.id };
  if (input.tags?.length) await setTags(ref, input.tags);
  const orgIds = new Set(input.orgIds ?? []);
  if (task.ownerOrgId) orgIds.add(task.ownerOrgId);
  for (const orgId of orgIds) await addLink(ref, { type: "organisation", id: orgId }, "partner", actor === "ai" ? "ai" : "user");
  for (const l of input.links ?? []) await addLink(ref, { type: l.type as EntityRef["type"], id: l.id }, "related", actor === "ai" ? "ai" : "user");
  if (input.sourceType && input.sourceId) {
    await addLink(ref, { type: input.sourceType as EntityRef["type"], id: input.sourceId }, "source", actor === "ai" ? "ai" : "user");
  }
  await logActivity({ action: "create", entityType: "task", entityId: task.id, title: task.title, actor });
  await indexTask(task.id);
  return task;
}

export const taskPatchSchema = taskInputSchema.partial().extend({ title: z.string().trim().min(1).max(500).optional() });
export type TaskPatch = z.input<typeof taskPatchSchema>;

export async function updateTask(id: string, raw: TaskPatch, actor: Actor = "user") {
  const patch = taskPatchSchema.parse(raw);
  const db = await getDb();
  const [before] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!before) return null;
  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  const changed: string[] = [];
  const assign = <K extends keyof typeof tasks.$inferInsert>(key: K, value: (typeof tasks.$inferInsert)[K]) => {
    set[key] = value;
    changed.push(String(key));
  };
  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.notes !== undefined) assign("notes", patch.notes ?? null);
  if (patch.priority !== undefined) assign("priority", patch.priority);
  if (patch.startDate !== undefined) assign("startDate", patch.startDate ?? null);
  if (patch.dueDate !== undefined) assign("dueDate", patch.dueDate ?? null);
  if (patch.dueTime !== undefined) assign("dueTime", patch.dueTime ?? null);
  if (patch.estimateMin !== undefined) assign("estimateMin", patch.estimateMin ?? null);
  if (patch.reminderAt !== undefined) assign("reminderAt", patch.reminderAt ?? null);
  if (patch.planDate !== undefined) assign("planDate", patch.planDate ?? null);
  if (patch.parentId !== undefined && patch.parentId !== id) assign("parentId", patch.parentId ?? null);
  if (patch.inbox !== undefined) assign("inbox", patch.inbox);
  if (patch.recurrence !== undefined) {
    assign("recurrence", patch.recurrence || null);
    set.recurrenceLabel = patch.recurrence ? (patch.recurrenceLabel ?? describeRule(patch.recurrence)) : null;
  }
  if (
    patch.ownerKind !== undefined ||
    patch.ownerOrgId !== undefined ||
    patch.ownerContactId !== undefined ||
    patch.ownerName !== undefined
  ) {
    Object.assign(set, ownerFields(patch as TaskInput));
    changed.push("owner");
  }
  // Dating or planning a task files it out of the inbox.
  if ((patch.dueDate || patch.startDate || patch.planDate) && before.inbox && patch.inbox === undefined) set.inbox = false;
  let spawned: TaskRow | null = null;
  if (patch.status !== undefined && patch.status !== before.status) {
    assign("status", patch.status);
    set.completedAt = patch.status === "done" ? new Date() : null;
    if (patch.status === "done") set.inbox = false;
  }
  const [row] = await db.update(tasks).set(set).where(eq(tasks.id, id)).returning();
  if (!row) return null;
  if (patch.tags) await setTags({ type: "task", id }, patch.tags);
  if (patch.orgIds) {
    const ids = new Set(patch.orgIds);
    if (row.ownerOrgId) ids.add(row.ownerOrgId);
    await setLinks({ type: "task", id }, "partner", [...ids].map((o) => ({ type: "organisation" as const, id: o })));
  } else if (set.ownerOrgId) {
    await addLink({ type: "task", id }, { type: "organisation", id: set.ownerOrgId }, "partner");
  }
  if (patch.status === "done" && before.status !== "done") {
    await logActivity({ action: "complete", entityType: "task", entityId: id, title: row.title, actor });
    if (row.recurrence) spawned = await spawnNextOccurrence(row);
  } else if (patch.status && patch.status !== before.status && before.status === "done") {
    await logActivity({ action: "reopen", entityType: "task", entityId: id, title: row.title, actor });
  } else if (changed.length) {
    await logActivity({ action: "update", entityType: "task", entityId: id, title: row.title, summary: changed.join(", "), actor });
  }
  await indexTask(id);
  return { task: row, spawned };
}

/** A repeating task makes its next copy when it is done (Todoist behaviour). */
async function spawnNextOccurrence(task: TaskRow) {
  const anchor = task.dueDate ?? task.startDate ?? todayStr();
  const nextDue = nextOccurrence(task.recurrence!, anchor, false);
  if (!nextDue) return null;
  const offset =
    task.startDate && task.dueDate ? Math.round((Date.parse(task.dueDate) - Date.parse(task.startDate)) / 86_400_000) : null;
  const db = await getDb();
  const [row] = await db
    .insert(tasks)
    .values({
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      dueDate: task.dueDate ? nextDue : null,
      startDate: task.dueDate ? (offset !== null ? addDaysStr(nextDue, -offset) : null) : nextDue,
      dueTime: task.dueTime,
      estimateMin: task.estimateMin,
      ownerKind: task.ownerKind,
      ownerContactId: task.ownerContactId,
      ownerOrgId: task.ownerOrgId,
      ownerName: task.ownerName,
      recurrence: task.recurrence,
      recurrenceLabel: task.recurrenceLabel,
      sourceType: task.sourceType,
      sourceId: task.sourceId,
      templateId: task.templateId,
    })
    .returning();
  const next = row!;
  const tagsMap = await tagsFor("task", [task.id]);
  const tagNames = (tagsMap.get(task.id) ?? []).map((t) => t.name);
  if (tagNames.length) await addTags({ type: "task", id: next.id }, tagNames);
  const orgIds = await linkedIds({ type: "task", id: task.id }, "organisation", "partner");
  for (const o of orgIds) await addLink({ type: "task", id: next.id }, { type: "organisation", id: o }, "partner");
  await indexTask(next.id);
  return next;
}

export async function deleteTaskForGood(id: string) {
  const db = await getDb();
  await db.delete(tasks).where(eq(tasks.id, id));
  await unindexRecord("task", id);
}

/** Search index entry for one task. */
export async function indexTask(id: string) {
  const db = await getDb();
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!t || t.deletedAt) {
    await unindexRecord("task", id);
    return;
  }
  const orgIds = await linkedIds({ type: "task", id }, "organisation");
  if (t.ownerOrgId && !orgIds.includes(t.ownerOrgId)) orgIds.push(t.ownerOrgId);
  const tagsMap = await tagsFor("task", [id]);
  const tagText = (tagsMap.get(id) ?? []).map((x) => `#${x.name}`).join(" ");
  await indexRecord({
    type: "task",
    id,
    title: t.title,
    body: [t.notes, t.ownerName, tagText, t.recurrenceLabel].filter(Boolean).join("\n"),
    meta: {
      status: t.status,
      owner: t.ownerKind === "me" ? "me" : "other",
      orgIds,
      dueDate: t.dueDate,
      priority: t.priority,
    },
    occurredAt: t.dueDate ? new Date(t.dueDate) : t.startDate ? new Date(t.startDate) : t.createdAt,
  });
}

/* ------------------------------ Reading ------------------------------ */

export type TaskFilters = {
  ownerKind?: "me" | "others";
  orgId?: string;
  tag?: string;
  priority?: number;
  due?: "overdue" | "today" | "week" | "month" | "none";
  text?: string;
  status?: TaskStatus | "open";
};

async function decorate(rows: TaskRow[], today = todayStr(), withSubtasks = true): Promise<TaskView[]> {
  if (!rows.length) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const orgIdsWanted = [...new Set(rows.map((r) => r.ownerOrgId).filter(Boolean))] as string[];
  const contactIds = [...new Set(rows.map((r) => r.ownerContactId).filter(Boolean))] as string[];
  const [orgRows, contactRows, tagMap, subRows, partnerLinks] = await Promise.all([
    orgIdsWanted.length
      ? db.select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName }).from(organisations).where(inArray(organisations.id, orgIdsWanted))
      : Promise.resolve([]),
    contactIds.length
      ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, contactIds))
      : Promise.resolve([]),
    tagsFor("task", ids),
    withSubtasks
      ? db
          .select({ id: tasks.id, parentId: tasks.parentId, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(and(inArray(tasks.parentId, ids), isNull(tasks.deletedAt)))
          .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      : Promise.resolve([]),
    db.execute(sql`
      select from_id, to_id from links
      where from_type = 'task' and to_type = 'organisation' and from_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`),
  ]);
  const orgName = new Map(orgRows.map((o) => [o.id, o.shortName || o.name]));
  const contactName = new Map(contactRows.map((c) => [c.id, c.name]));
  const subsByParent = new Map<string, { id: string; title: string; status: string }[]>();
  for (const s of subRows) {
    const list = subsByParent.get(s.parentId!) ?? [];
    list.push({ id: s.id, title: s.title, status: s.status });
    subsByParent.set(s.parentId!, list);
  }
  const orgLinks = new Map<string, string[]>();
  for (const r of (partnerLinks as unknown as { rows: { from_id: string; to_id: string }[] }).rows ?? []) {
    const list = orgLinks.get(r.from_id) ?? [];
    list.push(r.to_id);
    orgLinks.set(r.from_id, list);
  }
  return rows.map((r) => {
    const subs = subsByParent.get(r.id) ?? [];
    return {
      ...r,
      ownerLabel:
        r.ownerKind === "organisation"
          ? (orgName.get(r.ownerOrgId ?? "") ?? null)
          : r.ownerKind === "contact"
            ? (contactName.get(r.ownerContactId ?? "") ?? null)
            : r.ownerKind === "person"
              ? r.ownerName
              : null,
      tags: (tagMap.get(r.id) ?? []).map((t) => ({ name: t.name, slug: t.slug })),
      subtaskCount: subs.length,
      subtaskDone: subs.filter((s) => s.status === "done").length,
      subtasks: subs,
      overdue: Boolean(r.dueDate && r.dueDate < today && OPEN.includes(r.status as TaskStatus)),
      orgIds: [...new Set([...(orgLinks.get(r.id) ?? []), ...(r.ownerOrgId ? [r.ownerOrgId] : [])])],
    };
  });
}

async function filterSql(f: TaskFilters, today: string): Promise<SQL[]> {
  const where: SQL[] = [isNull(tasks.deletedAt), isNull(tasks.parentId)];
  if (f.status === "open" || !f.status) where.push(inArray(tasks.status, OPEN));
  else where.push(eq(tasks.status, f.status));
  if (f.ownerKind === "me") where.push(eq(tasks.ownerKind, "me"));
  if (f.ownerKind === "others") where.push(ne(tasks.ownerKind, "me"));
  if (f.priority) where.push(eq(tasks.priority, f.priority));
  if (f.due === "overdue") where.push(lt(tasks.dueDate, today));
  if (f.due === "today") where.push(or(lte(tasks.dueDate, today), lte(tasks.startDate, today), eq(tasks.planDate, today))!);
  if (f.due === "week") where.push(lte(tasks.dueDate, weekRange(today).end));
  if (f.due === "month") where.push(lte(tasks.dueDate, addDaysStr(today, 31)));
  if (f.due === "none") where.push(and(isNull(tasks.dueDate), isNull(tasks.startDate))!);
  if (f.text) where.push(sql`${tasks.title} ilike ${"%" + f.text + "%"}`);
  if (f.tag) {
    const ids = await idsWithTag("task", f.tag);
    where.push(ids.length ? inArray(tasks.id, ids) : sql`false`);
  }
  if (f.orgId) {
    where.push(
      or(
        eq(tasks.ownerOrgId, f.orgId),
        sql`exists (select 1 from links l where l.from_type = 'task' and l.from_id = ${tasks.id} and l.to_type = 'organisation' and l.to_id = ${f.orgId}::uuid)`,
        sql`exists (select 1 from contacts c where c.id = ${tasks.ownerContactId} and c.organisation_id = ${f.orgId}::uuid)`,
      )!,
    );
  }
  return where;
}

const ORDER = [
  sql`case when ${tasks.dueDate} is null and ${tasks.startDate} is null then 1 else 0 end`,
  sql`least(coalesce(${tasks.dueDate}, '9999-12-31'), coalesce(${tasks.startDate}, '9999-12-31'))`,
  asc(tasks.dueTime),
  asc(tasks.priority),
  asc(tasks.sortOrder),
  asc(tasks.createdAt),
];

/** Liste: open tasks grouped Bugün / Bu hafta / Daha sonra. */
export async function listGrouped(filters: TaskFilters = {}, today = todayStr()) {
  const db = await getDb();
  const where = await filterSql({ ownerKind: "me", ...filters }, today);
  where.push(eq(tasks.inbox, false));
  const rows = await db.select().from(tasks).where(and(...where)).orderBy(...ORDER).limit(800);
  const items = await decorate(rows, today);
  const week = weekRange(today);
  const groups = { today: [] as TaskView[], week: [] as TaskView[], later: [] as TaskView[] };
  for (const t of items) {
    const when = earliest(t.startDate, t.dueDate);
    if (t.planDate === today || (when && when <= today)) groups.today.push(t);
    else if (when && when <= week.end) groups.week.push(t);
    else groups.later.push(t);
  }
  // Planned order first in Bugün (the morning plan), then overdue, then the rest.
  groups.today.sort((a, b) => {
    const pa = a.planDate === today ? (a.planOrder ?? 0) : 10_000;
    const pb = b.planDate === today ? (b.planOrder ?? 0) : 10_000;
    if (pa !== pb) return pa - pb;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") || a.priority - b.priority;
  });
  return groups;
}

function earliest(a: string | null, b: string | null) {
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

/** Yaklaşan: the next days, one list per day (Things Upcoming). */
export async function listUpcoming(days = 28, today = todayStr()) {
  const db = await getDb();
  const end = addDaysStr(today, days);
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        isNull(tasks.parentId),
        inArray(tasks.status, OPEN),
        or(and(gte(tasks.dueDate, today), lte(tasks.dueDate, end)), and(gte(tasks.startDate, today), lte(tasks.startDate, end)))!,
      ),
    )
    .orderBy(...ORDER);
  const items = await decorate(rows, today);
  const byDay = new Map<string, TaskView[]>();
  for (const t of items) {
    // Show a task on its start day, and again on its deadline when they differ.
    const days = new Set<string>();
    if (t.startDate && t.startDate >= today && t.startDate <= end) days.add(t.startDate);
    if (t.dueDate && t.dueDate >= today && t.dueDate <= end) days.add(t.dueDate);
    for (const d of days) {
      const list = byDay.get(d) ?? [];
      list.push(t);
      byDay.set(d, list);
    }
  }
  return byDay;
}

/** Pano: open tasks by status, plus what was finished in the last two weeks. */
export async function listBoard(filters: TaskFilters = {}, today = todayStr()) {
  const db = await getDb();
  const where = await filterSql({ ...filters, status: "open" }, today);
  const open = await db.select().from(tasks).where(and(...where)).orderBy(...ORDER).limit(600);
  const done = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNull(tasks.parentId), eq(tasks.status, "done"), gte(tasks.completedAt, new Date(Date.now() - 14 * 86_400_000))))
    .orderBy(desc(tasks.completedAt))
    .limit(100);
  const items = await decorate([...open, ...done], today);
  return {
    todo: items.filter((t) => t.status === "todo"),
    doing: items.filter((t) => t.status === "doing"),
    waiting: items.filter((t) => t.status === "waiting"),
    done: items.filter((t) => t.status === "done"),
  };
}

/** Tamamlananlar: the logbook of finished work, newest first. */
export async function listLogbook(opts: { month?: string; limit?: number } = {}) {
  const db = await getDb();
  const where: SQL[] = [isNull(tasks.deletedAt), eq(tasks.status, "done"), isNotNull(tasks.completedAt)];
  if (opts.month && /^\d{4}-\d{2}$/.test(opts.month)) {
    const [y, m] = opts.month.split("-").map(Number);
    const from = new Date(Date.UTC(y!, m! - 1, 1, -3));
    const to = new Date(Date.UTC(y!, m!, 1, -3));
    where.push(gte(tasks.completedAt, from), lt(tasks.completedAt, to));
  }
  const rows = await db.select().from(tasks).where(and(...where)).orderBy(desc(tasks.completedAt)).limit(opts.limit ?? 400);
  return decorate(rows, todayStr(), false);
}

/** Beklediğimler: what others owe her, grouped by who owes it. */
export async function listWaiting(today = todayStr()) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), isNull(tasks.parentId), inArray(tasks.status, OPEN), ne(tasks.ownerKind, "me")))
    .orderBy(...ORDER)
    .limit(500);
  const items = await decorate(rows, today);
  const groups = new Map<string, { label: string; orgId: string | null; items: TaskView[] }>();
  for (const t of items) {
    const key = t.ownerOrgId ?? t.ownerContactId ?? `p:${(t.ownerName ?? "").toLowerCase()}`;
    const g = groups.get(key) ?? { label: t.ownerLabel ?? "—", orgId: t.ownerOrgId, items: [] };
    g.items.push(t);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "tr"));
}

export async function listFiltered(filters: TaskFilters, today = todayStr()) {
  const db = await getDb();
  const where = await filterSql(filters, today);
  const rows = await db.select().from(tasks).where(and(...where)).orderBy(...ORDER).limit(600);
  return decorate(rows, today);
}

export async function listInboxTasks() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), eq(tasks.inbox, true), inArray(tasks.status, OPEN)))
    .orderBy(desc(tasks.createdAt))
    .limit(200);
  return decorate(rows);
}

export async function getTask(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!row) return null;
  const [view] = await decorate([row]);
  return view ?? null;
}

/** Tasks linked to any record (a partner, a meeting, a note ...). */
export async function tasksLinkedTo(ref: EntityRef, opts: { open?: boolean } = {}) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        opts.open ? inArray(tasks.status, OPEN) : undefined,
        or(
          sql`exists (select 1 from links l where l.from_type = 'task' and l.from_id = ${tasks.id} and l.to_type = ${ref.type} and l.to_id = ${ref.id}::uuid)`,
          sql`exists (select 1 from links l where l.to_type = 'task' and l.to_id = ${tasks.id} and l.from_type = ${ref.type} and l.from_id = ${ref.id}::uuid)`,
          ref.type === "organisation" ? eq(tasks.ownerOrgId, ref.id) : undefined,
        ),
      ),
    )
    .orderBy(...ORDER)
    .limit(300);
  return decorate(rows);
}

export async function completedBetween(from: Date, to: Date) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), eq(tasks.status, "done"), gte(tasks.completedAt, from), lt(tasks.completedAt, to)))
    .orderBy(desc(tasks.completedAt));
  return decorate(rows, todayStr(), false);
}

export async function reorderTasks(ids: string[], field: "sortOrder" | "planOrder" = "sortOrder") {
  const db = await getDb();
  for (const [i, id] of ids.entries()) {
    await db.update(tasks).set({ [field]: i }).where(eq(tasks.id, id));
  }
}

export async function bulkUpdate(ids: string[], patch: TaskPatch) {
  const results = [];
  for (const id of ids.slice(0, 300)) results.push(await updateTask(id, patch));
  return results.filter(Boolean).length;
}
