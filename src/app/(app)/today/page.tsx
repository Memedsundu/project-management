import { getLocale, getTranslations } from "next-intl/server";
import { TodayScreen, type TodaySuggestion } from "@/components/today/today-screen";
import { formatLongDay, nowTz, todayStr } from "@/lib/dates";
import { aiStatus } from "@/server/ai/client";
import { unreadBriefs } from "@/server/services/briefs";
import { listContactsLite, listOrganisationsLite } from "@/server/services/partners-lite";
import { getSetting } from "@/server/services/settings";
import { latestBrief, recentItems, todayData, wrapUpData } from "@/server/services/today";
import { loadTaskDetail } from "@/server/views/task-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("today");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

const HREF: Record<string, string> = { document: "/files/d/", note: "/notes/", meeting: "/meetings/" };

function suggestionHref(s: { kind: string; sourceType: string | null; sourceId: string | null; id: string }) {
  if (s.kind === "classification") return "/files/check";
  if (s.kind === "organize") return s.sourceId ? `/files/f/${s.sourceId}?organize=${s.id}` : `/files?organize=${s.id}`;
  if (s.kind === "indicator_values" && s.sourceId) return `/files/d/${s.sourceId}`;
  if (s.kind === "meeting_recap" && s.sourceId) return `/meetings/${s.sourceId}`;
  return `/inbox#s-${s.id}`;
}

export default async function TodayPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const day = todayStr();
  const locale = await getLocale();
  const [data, brief, recent, wrap, orgs, contacts, detail, ai, unread, helpers] = await Promise.all([
    todayData(day),
    latestBrief("daily", { day }),
    recentItems(8),
    wrapUpData(day),
    listOrganisationsLite(),
    listContactsLite(),
    loadTaskDetail(typeof sp.open === "string" ? sp.open : null),
    aiStatus(),
    unreadBriefs(3),
    getSetting("scheduledHelpers"),
  ]);
  const hour = nowTz().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "day" : "evening";
  const suggestions: TodaySuggestion[] = data.attention.suggestions.slice(0, 6).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    summary: s.summary,
    href: suggestionHref(s),
  }));
  const briefLines = brief ? ((brief.data as { lines?: string[] } | null)?.lines ?? brief.content.split("\n").filter(Boolean)) : null;
  return (
    <TodayScreen
      day={day}
      longDate={formatLongDay(day, locale)}
      part={part}
      brief={briefLines ? { lines: briefLines, ai: Boolean(brief!.model), at: brief!.createdAt.toISOString() } : null}
      aiReady={ai.configured && ai.enabled && !ai.capReached}
      briefAuto={helpers.dailyBrief}
      otherBriefs={{ items: unread.items.map((b) => ({ id: b.id, kind: b.kind, title: b.title })), total: unread.total }}
      tasks={data.tasks}
      planCandidates={[...data.tasks, ...data.weekTasks]}
      meetings={data.meetings.map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt?.toISOString() ?? null, location: m.location, status: m.status }))}
      waitingThisWeek={data.waitingThisWeek}
      keyDates={data.keyDates}
      attention={{
        overdue: data.attention.overdue.length,
        lateReports: data.attention.lateReports,
        filesToCheck: data.attention.filesToCheck,
        suggestions,
        meetingsNeedingNotes: data.attention.meetingsNeedingNotes.map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt.toISOString() })),
      }}
      recent={recent.map((r) => ({ type: r.type, id: r.id, title: r.title, href: `${HREF[r.type] ?? "/"}${r.id}` }))}
      plannedMinutes={data.plannedMinutes}
      workMinutes={data.workMinutes}
      wrapUp={{ done: wrap.done, leftovers: wrap.leftovers }}
      partners={orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName }))}
      orgs={orgs}
      contacts={contacts}
      detail={detail}
    />
  );
}
