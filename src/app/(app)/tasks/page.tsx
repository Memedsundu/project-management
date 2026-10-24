import { and, asc, count, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { TaskFilterState } from "@/components/tasks/filter-bar";
import { TasksScreen, type TasksTab } from "@/components/tasks/tasks-screen";
import type { UpcomingDay } from "@/components/tasks/upcoming";
import { addDaysStr, dayOf, istanbulInstant, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { loadTaskDetail } from "@/server/views/task-detail";
import { meetings, savedViews, tasks } from "@/server/db/schema";
import { listContactsLite, listOrganisationsLite } from "@/server/services/partners-lite";
import { listTags } from "@/server/services/tags";
import {
  listBoard,
  listGrouped,
  listLogbook,
  listUpcoming,
  listWaiting,
  type TaskFilters,
} from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("tasks");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;
const TABS: TasksTab[] = ["list", "upcoming", "board", "logbook", "waiting"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = (TABS.includes(one("tab") as TasksTab) ? one("tab") : "list") as TasksTab;
  const today = todayStr();
  const db = await getDb();

  const views = await db.select().from(savedViews).where(eq(savedViews.kind, "tasks")).orderBy(asc(savedViews.sort), asc(savedViews.createdAt));
  const viewId = one("view");
  const view = viewId ? views.find((v) => v.id === viewId) : undefined;

  const fromUrl: TaskFilterState = {};
  const owner = one("owner");
  if (owner === "me" || owner === "others") fromUrl.ownerKind = owner;
  if (one("org") && UUID.test(one("org")!)) fromUrl.orgId = one("org");
  if (one("tag")) fromUrl.tag = one("tag")!.slice(0, 60);
  const p = Number(one("p"));
  if (p >= 1 && p <= 4) fromUrl.priority = p;
  const due = one("due");
  if (due && ["overdue", "today", "week", "month", "none"].includes(due)) fromUrl.due = due as TaskFilterState["due"];
  if (one("q")) fromUrl.text = one("q")!.slice(0, 100);
  const filters: TaskFilterState = { ...((view?.filters as TaskFilterState) ?? {}), ...fromUrl };
  // The list shows her own work unless she asks for everyone's.
  const listFilters: TaskFilters = { ...filters, ownerKind: owner === "all" ? undefined : (filters.ownerKind ?? (view ? undefined : "me")) };

  const [orgs, contacts, tags, [waitingRow]] = await Promise.all([
    listOrganisationsLite(),
    listContactsLite(),
    listTags(),
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), isNull(tasks.parentId), ne(tasks.ownerKind, "me"), ne(tasks.status, "done"), ne(tasks.status, "canceled"))),
  ]);

  const data: Partial<React.ComponentProps<typeof TasksScreen>> = {};
  if (tab === "list") {
    data.list = await listGrouped(listFilters, today);
  } else if (tab === "upcoming") {
    const byDay = await listUpcoming(28, today);
    const from = istanbulInstant(today, "00:00");
    const to = istanbulInstant(addDaysStr(today, 29), "00:00");
    const mts = await db
      .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt })
      .from(meetings)
      .where(and(isNull(meetings.deletedAt), ne(meetings.status, "canceled"), gte(meetings.startsAt, from), lt(meetings.startsAt, to)))
      .orderBy(asc(meetings.startsAt));
    const days: UpcomingDay[] = [];
    for (let i = 0; i < 28; i++) {
      const day = addDaysStr(today, i);
      const items = byDay.get(day) ?? [];
      const dayMeetings = mts.filter((m) => dayOf(m.startsAt) === day);
      // Two weeks day by day, then only days that have something.
      if (i < 14 || items.length || dayMeetings.length) days.push({ day, tasks: items, meetings: dayMeetings });
    }
    data.upcoming = days;
  } else if (tab === "board") {
    data.board = await listBoard({ ...filters }, today);
  } else if (tab === "logbook") {
    const month = /^\d{4}-\d{2}$/.test(one("month") ?? "") ? one("month")! : today.slice(0, 7);
    data.logbook = { items: await listLogbook({ month }), month };
  } else if (tab === "waiting") {
    data.waiting = await listWaiting(today);
  }

  const detail = await loadTaskDetail(one("open"));

  return (
    <TasksScreen
      tab={tab}
      today={today}
      filters={filters}
      activeViewId={view?.id ?? null}
      savedViews={views.map((v) => ({ id: v.id, name: v.name, pinned: v.pinned, filters: v.filters as TaskFilterState }))}
      orgs={orgs}
      contacts={contacts}
      tags={tags.map((x) => ({ name: x.name, slug: x.slug, count: x.count }))}
      waitingCount={waitingRow?.n ?? 0}
      detail={detail}
      {...data}
    />
  );
}
