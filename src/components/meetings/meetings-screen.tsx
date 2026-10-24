"use client";

import { CalendarPlus, Check, Plus, Repeat, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { dayOf, formatDay, formatLongDay, formatTime, parseDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { MeetingsScreenData } from "@/server/views/meetings";
import { NewMeetingDialog } from "./meeting-form";
import type { MeetingRow, Org } from "./types";

/** Tabs shared by the meetings list, the series and the decisions log. */
export function MeetingTabs({ active, org, upcomingCount }: { active: "upcoming" | "past" | "series" | "decisions"; org: string | null; upcomingCount?: number }) {
  const t = useTranslations("meetings.tabs");
  const q = org ? `org=${org}` : "";
  return (
    <SegmentedLinks
      active={active}
      items={[
        { key: "upcoming", label: t("upcoming"), href: `/meetings${q ? `?${q}` : ""}`, count: upcomingCount },
        { key: "past", label: t("past"), href: `/meetings?tab=past${q ? `&${q}` : ""}` },
        { key: "series", label: t("series"), href: `/meetings?tab=series${q ? `&${q}` : ""}` },
        { key: "decisions", label: t("decisions"), href: `/meetings/decisions${q ? `?${q}` : ""}` },
      ]}
    />
  );
}

/** Partner filter as links, so the choice stays in the address. */
export function PartnerFilter({ orgs, active, base }: { orgs: Org[]; active: string | null; base: string }) {
  const t = useTranslations("meetings");
  if (!orgs.length) return null;
  const href = (org: string | null) => {
    const u = new URL(base, "http://x");
    if (org) u.searchParams.set("org", org);
    else u.searchParams.delete("org");
    return `${u.pathname}${u.search}`;
  };
  const cls = (on: boolean) =>
    cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors", on ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:border-ink");
  return (
    <nav aria-label={t("partnerFilter")} className="flex flex-wrap items-center gap-1.5">
      <Link href={href(null)} className={cls(!active)} aria-current={!active ? "page" : undefined}>
        {t("allPartners")}
      </Link>
      {orgs.map((o) => (
        <Link key={o.id} href={href(o.id)} className={cls(active === o.id)} aria-current={active === o.id ? "page" : undefined}>
          {active === o.id ? <Check size={13} /> : null}
          {o.shortName || o.name}
        </Link>
      ))}
    </nav>
  );
}

function monthLabel(key: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric" }).format(parseDay(`${key}-01`));
}

/** One meeting in a list: time, title, partners, and what is left to do. */
export function MeetingListRow({ m, orgs, showDay, now }: { m: MeetingRow; orgs: Org[]; showDay?: boolean; now: number }) {
  const t = useTranslations("meetings.list");
  const locale = useLocale();
  const start = new Date(m.startsAt);
  const end = m.endsAt ? new Date(m.endsAt) : null;
  const canceled = m.status === "canceled";
  const ongoing = !canceled && start.getTime() <= now && (end ?? start).getTime() > now;
  const past = (end ?? start).getTime() < now;
  const partnerNames = m.orgIds.map((id) => orgs.find((o) => o.id === id)).filter(Boolean).map((o) => o!.shortName || o!.name);
  const meta = [partnerNames.join(", "), m.location].filter(Boolean).join(" · ");
  return (
    <li>
      <Link href={`/meetings/${m.id}`} className={cn("flex items-start gap-4 rounded-xl px-3 py-2.5 hover:bg-panel", canceled && "opacity-55")}>
        <span className="w-[86px] shrink-0 pt-0.5 text-[14px] tabular-nums text-ink-2 sm:w-[104px]">
          {showDay ? <span className="block font-medium text-ink">{formatDay(dayOf(m.startsAt), locale)}</span> : null}
          {formatTime(start)}
          {end ? <span className="text-muted">–{formatTime(end)}</span> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate text-[15px] font-medium", canceled && "line-through")}>{m.title}</span>
          {meta || m.online || m.seriesId ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
              {m.seriesId ? <Repeat size={12} className="shrink-0" aria-label={t("inSeries")} /> : null}
              {m.online ? <Video size={13} className="shrink-0" aria-label={t("online")} /> : null}
              <span className="truncate">{meta}</span>
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          {canceled ? (
            <Badge variant="outline" size="sm">
              {t("canceled")}
            </Badge>
          ) : ongoing ? (
            <Badge variant="ink" size="sm">
              {t("now")}
            </Badge>
          ) : past ? (
            m.pendingRecap ? (
              <Badge variant="ai" size="sm">
                <Sparkles size={11} />
                {t("recapWaiting")}
              </Badge>
            ) : m.hasRecap ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                <Check size={12} />
                {t("recapped")}
              </span>
            ) : !m.hasNotes ? (
              <Badge variant="outline" size="sm">
                {t("noNotes")}
              </Badge>
            ) : (
              <span className="text-[12px] text-muted">{t("hasNotes")}</span>
            )
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function MeetingsScreen({ data }: { data: MeetingsScreenData }) {
  const t = useTranslations("meetings");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const [now] = useState(() => Date.now());
  const [newOpen, setNewOpen] = useState(Boolean(data.newMeeting));
  useScreenContext({ kind: "meetings", title: t("title") });

  const base = data.tab === "upcoming" ? "/meetings" : `/meetings?tab=${data.tab}`;
  const groups = new Map<string, MeetingRow[]>();
  for (const m of data.rows) {
    const key = data.tab === "past" ? dayOf(m.startsAt).slice(0, 7) : dayOf(m.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const dayHeading = (day: string) => {
    const rel = day === data.today ? t("list.today") : null;
    return rel ? `${rel} · ${formatLongDay(day, locale)}` : formatLongDay(day, locale);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/meetings/ics${data.org ? `?org=${data.org}` : ""}`}>
                <CalendarPlus size={16} />
                {t("exportIcs")}
              </a>
            </Button>
            {!shell.readOnly ? (
              <Button onClick={() => setNewOpen(true)} data-testid="new-meeting">
                <Plus size={16} />
                {t("new")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <MeetingTabs active={data.tab} org={data.org} upcomingCount={data.upcomingCount} />
        <PartnerFilter orgs={data.orgs} active={data.org} base={base} />
      </div>

      {data.tab === "series" ? (
        data.series.length ? (
          <ul className="flex flex-col gap-2">
            {data.series.map((s) => {
              const org = data.orgs.find((o) => o.id === s.organisationId);
              return (
                <li key={s.id}>
                  <Link href={`/meetings/series/${s.id}`} className="flex items-center gap-4 rounded-2xl border border-line px-4 py-3 hover:border-ink">
                    <Repeat size={18} className="shrink-0 text-muted" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-medium">{s.title}</span>
                      <span className="truncate text-[13px] text-muted">
                        {[s.recurrenceLabel, org ? org.shortName || org.name : null, t("series.count", { count: s.count })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[13px] text-muted">
                      {s.next ? t("series.next", { date: formatDay(dayOf(s.next.startsAt), locale) }) : t("series.noNext")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t("series.emptyTitle")} body={t("series.emptyBody")} icon={<Repeat size={22} />} />
        )
      ) : data.rows.length === 0 ? (
        <EmptyState
          title={data.tab === "past" ? t("list.emptyPastTitle") : t("list.emptyTitle")}
          body={data.tab === "past" ? t("list.emptyPastBody") : t("list.emptyBody")}
          icon={<CalendarPlus size={22} />}
          action={
            data.tab === "upcoming" && !shell.readOnly ? (
              <Button onClick={() => setNewOpen(true)}>
                <Plus size={16} />
                {t("new")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {[...groups.entries()].map(([key, list]) => (
            <section key={key} aria-labelledby={`g-${key}`} className="flex flex-col gap-1">
              <h2 id={`g-${key}`} className={cn("px-3 text-[14px] font-semibold", key === data.today ? "text-ink" : "text-ink-2")}>
                {data.tab === "past" ? monthLabel(key, locale) : dayHeading(key)}
              </h2>
              <ul className="flex flex-col">
                {list.map((m) => (
                  <MeetingListRow key={m.id} m={m} orgs={data.orgs} showDay={data.tab === "past"} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {newOpen ? (
        <NewMeetingDialog
          open
          onOpenChange={(v) => {
            if (v) return;
            setNewOpen(false);
            if (data.newMeeting) router.replace(base);
          }}
          orgs={data.orgs}
          templates={data.templates}
          defaults={data.newMeeting ?? { day: data.today, orgIds: data.org ? [data.org] : [] }}
        />
      ) : null}
    </div>
  );
}
