"use client";

import { AlertTriangle, CalendarClock, Check, FileSearch, Inbox, MapPin, NotebookPen, RefreshCw, Sparkles, Sun, Sunset, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/actions/suggestions";
import { refreshBriefAction } from "@/app/(app)/today/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { InfoTip } from "@/components/common/info-tip";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { InlineAdd } from "@/components/tasks/inline-add";
import { TaskList } from "@/components/tasks/task-list";
import { TaskSheet, type TaskSheetData } from "@/components/tasks/task-sheet";
import type { ContactOption, OrgOption, TaskItem } from "@/components/tasks/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, SectionTitle, StatCard } from "@/components/ui/card";
import { formatTime, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { PlanDayDialog } from "./plan-day";
import { WrapUpDialog } from "./wrap-up";

export type TodayMeeting = { id: string; title: string; startsAt: string; endsAt: string | null; location: string | null; status: string };
export type TodaySuggestion = { id: string; kind: string; title: string; summary: string | null; href: string | null };

export type TodayProps = {
  day: string;
  longDate: string;
  part: "morning" | "day" | "evening";
  brief: { lines: string[]; ai: boolean; at: string } | null;
  aiReady: boolean;
  tasks: TaskItem[];
  planCandidates: TaskItem[];
  meetings: TodayMeeting[];
  waitingThisWeek: TaskItem[];
  keyDates: { documentId: string; title: string; date: string; label: string }[];
  attention: {
    overdue: number;
    lateReports: { orgId: string; orgName: string; label: string; daysLate: number }[];
    filesToCheck: { id: string; title: string; status: string }[];
    suggestions: TodaySuggestion[];
    meetingsNeedingNotes: { id: string; title: string; startsAt: string }[];
  };
  recent: { type: string; id: string; title: string; href: string }[];
  plannedMinutes: number;
  workMinutes: number;
  wrapUp: { done: { id: string; title: string }[]; leftovers: TaskItem[] };
  partners: { id: string; name: string; shortName: string | null }[];
  orgs: OrgOption[];
  contacts: ContactOption[];
  detail: TaskSheetData | null;
};

export function TodayScreen(props: TodayProps) {
  const t = useTranslations("today");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const [planOpen, setPlanOpen] = useState(false);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const partnerNames = useMemo(() => new Map(props.orgs.map((o) => [o.id, o.shortName || o.name])), [props.orgs]);
  useScreenContext({ kind: "today", title: t("title"), detail: props.longDate });

  const overbooked = props.workMinutes > 0 && props.plannedMinutes > props.workMinutes;
  const a = props.attention;
  const attentionCount = (a.overdue ? 1 : 0) + a.lateReports.length + (a.filesToCheck.length ? 1 : 0) + a.suggestions.length + a.meetingsNeedingNotes.length;

  const refresh = async () => {
    setBriefBusy(true);
    await runAction(refreshBriefAction());
    setBriefBusy(false);
  };

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-7">
      <PageHeader
        eyebrow={props.longDate}
        title={t(`greeting.${props.part}`)}
        actions={
          shell.readOnly ? null : (
            <>
              <Button variant={props.part === "evening" ? "outline" : "primary"} onClick={() => setPlanOpen(true)}>
                <Sun size={18} />
                {t("plan.open")}
              </Button>
              <Button variant={props.part === "evening" ? "primary" : "outline"} onClick={() => setWrapOpen(true)}>
                <Sunset size={18} />
                {t("wrap.open")}
              </Button>
            </>
          )
        }
      />

      <Panel className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="ai" size="sm">
            <Sparkles size={12} />
            {t("brief.label")}
          </Badge>
          <InfoTip ask={t("brief.ask")}>{t("brief.info")}</InfoTip>
          <span className="flex-1" />
          {!shell.readOnly ? (
            <Button size="sm" variant="ghost" onClick={refresh} disabled={briefBusy} aria-label={t("brief.refresh")}>
              <RefreshCw size={14} className={cn(briefBusy && "animate-spin")} />
              {props.brief ? t("brief.refresh") : t("brief.makeNow")}
            </Button>
          ) : null}
        </div>
        {props.brief ? (
          <ul className="flex flex-col gap-1.5">
            {props.brief.lines.map((line, i) => (
              <li key={i} className={cn("text-[16px] leading-snug", i === 0 ? "text-ink" : "text-ink-2")}>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">{t("brief.none")}</p>
        )}
        {props.brief && !props.brief.ai && props.aiReady === false ? <p className="text-[13px] text-faint">{t("brief.plain")}</p> : null}
      </Panel>

      {overbooked ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-[15px] text-accent-ink">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">{t("overbooked.title")}</strong> {t("overbooked.body", { planned: hours(props.plannedMinutes, locale), work: hours(props.workMinutes, locale) })}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("stats.tasks")} value={props.tasks.length} note={props.plannedMinutes ? t("stats.planned", { time: hours(props.plannedMinutes, locale) }) : t("stats.noEstimate")} />
        <StatCard label={t("stats.meetings")} value={props.meetings.filter((m) => m.status !== "canceled").length} note={nextMeetingNote(props.meetings, t)} href="/meetings" />
        <StatCard label={t("stats.overdue")} value={a.overdue} note={a.overdue ? t("stats.overdueNote") : t("stats.overdueNone")} noteTone={a.overdue ? "overdue" : "muted"} href="/tasks?due=overdue" />
        <StatCard label={t("stats.waiting")} value={props.waitingThisWeek.length} note={t("stats.waitingNote")} href="/tasks?tab=waiting" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="flow" className="flex flex-col gap-3">
            <SectionTitle id="flow">{t("flow.title")}</SectionTitle>
            {props.meetings.length ? (
              <ol className="flex flex-col">
                {props.meetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className={cn("flex items-start gap-4 rounded-xl px-3 py-2.5 hover:bg-panel", m.status === "canceled" && "opacity-50")}>
                      <span className="w-[52px] shrink-0 pt-0.5 font-mono text-[14px] text-muted">{formatTime(m.startsAt)}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("text-[15px] font-medium", m.status === "canceled" && "line-through")}>{m.title}</span>
                        <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
                          {m.endsAt ? <span>{`${formatTime(m.startsAt)}–${formatTime(m.endsAt)}`}</span> : null}
                          {m.location ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={12} />
                              {m.location}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <CalendarClock size={16} className="mt-1 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-3 text-[15px] text-muted">{t("flow.noMeetings")}</p>
            )}
          </section>

          <section aria-labelledby="todo" className="flex flex-col gap-3">
            <SectionTitle id="todo" action={<Link href="/tasks" className="text-[14px] text-muted hover:text-ink">{t("todo.all")}</Link>}>
              {t("todo.title")}
            </SectionTitle>
            <InlineAdd today={props.day} partners={props.partners} defaults={{ startDate: props.day }} placeholder={t("todo.add")} />
            <TaskList
              partnerNames={partnerNames}
              readOnly={shell.readOnly}
              groups={[{ key: "today", label: "", items: props.tasks, empty: t("todo.empty") }]}
            />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="attention" className="flex flex-col gap-3">
            <SectionTitle id="attention">
              <span className="inline-flex items-center gap-2">
                {t("attention.title")}
                {attentionCount ? <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white dark:text-on-ink">{attentionCount}</span> : null}
              </span>
            </SectionTitle>
            {attentionCount === 0 ? (
              <p className="rounded-2xl border border-line px-4 py-4 text-[15px] text-muted">{t("attention.none")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line">
                {a.overdue ? (
                  <AttentionRow href="/tasks?due=overdue" icon={<AlertTriangle size={16} className="text-overdue" />} title={t("attention.overdue", { count: a.overdue })} />
                ) : null}
                {a.lateReports.map((r) => (
                  <AttentionRow key={`${r.orgId}-${r.label}`} href={`/partners/${r.orgId}`} icon={<EntityIcon type="organisation" className="text-overdue" />} title={t("attention.lateReport", { org: r.orgName, label: r.label })} note={t("attention.daysLate", { days: r.daysLate })} />
                ))}
                {a.filesToCheck.length ? (
                  <AttentionRow href="/files/check" icon={<FileSearch size={16} />} title={t("attention.filesToCheck", { count: a.filesToCheck.length })} note={a.filesToCheck.slice(0, 2).map((f) => f.title).join(" · ")} />
                ) : null}
                {a.meetingsNeedingNotes.map((m) => (
                  <AttentionRow key={m.id} href={`/meetings/${m.id}`} icon={<NotebookPen size={16} />} title={t("attention.meetingNotes", { title: m.title })} note={relativeDayLabel(m.startsAt.slice(0, 10), locale)} />
                ))}
                {a.suggestions.map((s) => (
                  <SuggestionRow key={s.id} s={s} readOnly={shell.readOnly} />
                ))}
              </ul>
            )}
            {a.suggestions.length ? (
              <Link href="/inbox" className="inline-flex items-center gap-1.5 self-start text-[14px] text-muted hover:text-ink">
                <Inbox size={14} />
                {t("attention.toInbox")}
              </Link>
            ) : null}
          </section>

          {props.waitingThisWeek.length ? (
            <section aria-labelledby="waiting" className="flex flex-col gap-3">
              <SectionTitle id="waiting">{t("waiting.title")}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {props.waitingThisWeek.slice(0, 8).map((w) => (
                  <li key={w.id}>
                    <Link href={`?open=${w.id}`} scroll={false} className="flex flex-col rounded-xl px-3 py-2 hover:bg-panel">
                      <span className="text-[15px]">{w.title}</span>
                      <span className={cn("text-[13px]", w.overdue ? "font-medium text-overdue" : "text-muted")}>
                        {w.ownerLabel ?? "—"}
                        {w.dueDate ? ` · ${relativeDayLabel(w.dueDate, locale)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {props.keyDates.length ? (
            <section aria-labelledby="dates" className="flex flex-col gap-3">
              <SectionTitle id="dates">{t("dates.title")}</SectionTitle>
              <ul className="flex flex-col gap-1">
                {props.keyDates.map((k) => (
                  <li key={`${k.documentId}-${k.date}-${k.label}`}>
                    <Link href={`/files/d/${k.documentId}`} className="flex flex-col rounded-xl px-3 py-2 hover:bg-panel">
                      <span className="text-[15px]">{k.label}</span>
                      <span className="text-[13px] text-muted">
                        {relativeDayLabel(k.date, locale)} · {k.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="recent" className="flex flex-col gap-3">
            <SectionTitle id="recent">{t("recent.title")}</SectionTitle>
            {props.recent.length ? (
              <ul className="flex flex-col gap-0.5">
                {props.recent.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <Link href={r.href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 hover:bg-panel">
                      <EntityIcon type={r.type} className="shrink-0 text-muted" />
                      <span className="truncate text-[15px]">{r.title || tc("untitled")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 text-[14px] text-muted">{t("recent.none")}</p>
            )}
          </section>
        </aside>
      </div>

      <PlanDayDialog open={planOpen} onOpenChange={setPlanOpen} day={props.day} candidates={props.planCandidates} workMinutes={props.workMinutes} meetingMinutes={meetingMinutes(props.meetings)} />
      <WrapUpDialog open={wrapOpen} onOpenChange={setWrapOpen} day={props.day} done={props.wrapUp.done} leftovers={props.wrapUp.leftovers} />
      <TaskSheet detail={props.detail} orgs={props.orgs} contacts={props.contacts} />
    </div>
  );
}

function AttentionRow({ href, icon, title, note }: { href: string; icon: React.ReactNode; title: string; note?: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-start gap-3 px-4 py-3 hover:bg-panel/70">
        <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] leading-snug">{title}</span>
          {note ? <span className="truncate text-[13px] text-muted">{note}</span> : null}
        </span>
      </Link>
    </li>
  );
}

/** A Claude suggestion with accept and reject in place; long ones open in the Inbox. */
function SuggestionRow({ s, readOnly }: { s: TodaySuggestion; readOnly: boolean }) {
  const t = useTranslations("today");
  const tc = useTranslations("common");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const simple = s.kind === "link" || s.kind === "key_dates" || s.kind === "note";
  const act = async (accept: boolean) => {
    setBusy(true);
    const ok = accept ? await runAction(acceptSuggestionAction(s.id), { success: t("attention.accepted") }) : await runAction(rejectSuggestionAction(s.id));
    setBusy(false);
    if (ok !== undefined) setGone(true);
  };
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] leading-snug">{s.title}</span>
          {s.summary ? <span className="line-clamp-2 text-[13px] text-muted">{s.summary}</span> : null}
        </div>
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2 pl-7">
          {simple ? (
            <Button size="sm" onClick={() => act(true)} disabled={busy}>
              <Check size={14} />
              {tc("accept")}
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href={s.href ?? `/inbox#s-${s.id}`}>{t("attention.review")}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => act(false)} disabled={busy}>
            <X size={14} />
            {tc("reject")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function hours(min: number, locale: string) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (locale === "en") return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  return h ? `${h} sa${m ? ` ${m} dk` : ""}` : `${m} dk`;
}

function meetingMinutes(list: TodayMeeting[]) {
  return list
    .filter((m) => m.status !== "canceled")
    .reduce((acc, m) => acc + (m.endsAt ? Math.max(0, (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60000) : 60), 0);
}

function nextMeetingNote(list: TodayMeeting[], t: ReturnType<typeof useTranslations<"today">>) {
  const now = Date.now();
  const next = list.find((m) => m.status !== "canceled" && Date.parse(m.startsAt) > now);
  return next ? t("stats.nextMeeting", { time: formatTime(next.startsAt) }) : t("stats.noMoreMeetings");
}
