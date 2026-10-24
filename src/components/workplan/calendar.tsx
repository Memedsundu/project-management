"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Flag, Play } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { dfLocale, parseDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { dayNum, dayStr, isWeekend, shiftDay } from "./shared";
import type { CalendarEvent, WorkplanData } from "./types";
import { useHrefWith } from "./use-href";

function EventChip({ e, href }: { e: CalendarEvent; href: string | null }) {
  const icon =
    e.kind === "meeting" ? (
      <span className="size-1.5 shrink-0 rounded-full bg-ink" />
    ) : e.kind === "task" ? (
      <span className={cn("size-3 shrink-0 rounded-full border-[1.5px]", e.late ? "border-overdue" : "border-ink/60")} />
    ) : e.kind === "activity_start" ? (
      <Play size={11} className="shrink-0 fill-current" />
    ) : e.kind === "activity_end" ? (
      <Flag size={11} className="shrink-0" />
    ) : (
      <span className={cn("size-2 shrink-0 rotate-45 border-[1.5px]", e.late ? "border-accent bg-accent" : "border-ink")} />
    );
  const body = (
    <>
      {icon}
      {e.time ? <span className="shrink-0 tabular-nums text-muted">{e.time}</span> : null}
      <span className="truncate">{e.title}</span>
    </>
  );
  const cls = cn("flex min-h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12px] leading-tight hover:bg-panel", e.late && "font-medium text-overdue");
  return href ? (
    <Link href={href} className={cls} data-testid="wp-cal-event" data-kind={e.kind}>
      {body}
    </Link>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/** "Takvim": meetings, deadlines, activity starts and ends, report dates and holidays by month or week. */
export function WorkplanCalendar({ data }: { data: WorkplanData }) {
  const t = useTranslations("workplan.calendar");
  const tw = useTranslations("workplan");
  const locale = useLocale();
  const hrefWith = useHrefWith();
  const cal = data.calendar!;
  const loc = dfLocale(locale);
  const hrefOf = (e: CalendarEvent) => (e.kind === "activity_start" || e.kind === "activity_end" || e.kind === "milestone" ? hrefWith({ open: e.id.replace(/^a[sem]-/, "") }) : e.href);
  const days: string[] = [];
  for (let d = dayNum(cal.from); d <= dayNum(cal.to); d++) days.push(dayStr(d));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of cal.events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const month = cal.anchor.slice(0, 7);
  const prev = cal.mode === "month" ? hrefWith({ month: shiftDay(cal.anchor, -1).slice(0, 7), week: null }) : hrefWith({ week: shiftDay(cal.anchor, -7), month: null });
  const next = cal.mode === "month" ? hrefWith({ month: shiftDay(cal.anchor, 40).slice(0, 7), week: null }) : hrefWith({ week: shiftDay(cal.anchor, 7), month: null });
  const title =
    cal.mode === "month"
      ? format(parseDay(cal.anchor), "LLLL yyyy", { locale: loc })
      : `${format(parseDay(cal.from), "d MMM", { locale: loc })} – ${format(parseDay(cal.to), "d MMM yyyy", { locale: loc })}`;
  const weekdays = days.slice(0, 7).map((d) => format(parseDay(d), "EEE", { locale: loc }));
  const visible = cal.mode === "month" ? days.filter((d) => d.startsWith(month)) : days;
  const agenda = visible.filter((d) => byDay.get(d)?.length);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line" data-testid="wp-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          <Link href={prev} scroll={false} aria-label={t("prev")} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-panel">
            <ChevronLeft size={18} />
          </Link>
          <Link href={next} scroll={false} aria-label={t("next")} className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-panel">
            <ChevronRight size={18} />
          </Link>
          <h2 className="px-1 text-[17px] font-semibold first-letter:uppercase">{title}</h2>
          <Link href={hrefWith({ month: null, week: null })} scroll={false} className="ml-1 inline-flex h-9 items-center rounded-full px-3 text-[14px] text-muted hover:bg-panel hover:text-ink">
            {tw("today")}
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {(["month", "week"] as const).map((m) => (
            <Link
              key={m}
              href={hrefWith({ cal: m === "month" ? null : "week", month: null, week: null })}
              scroll={false}
              aria-current={cal.mode === m ? "true" : undefined}
              className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-[14px]", cal.mode === m ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
            >
              {t(m)}
            </Link>
          ))}
        </div>
      </div>

      {/* Laptop: the grid. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-line">
          {weekdays.map((w) => (
            <div key={w} className="label-caps px-2.5 py-2 text-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const holidays = list.filter((e) => e.kind === "holiday");
            const events = list.filter((e) => e.kind !== "holiday");
            const max = cal.mode === "week" ? 40 : 4;
            const out = cal.mode === "month" && !d.startsWith(month);
            return (
              <div
                key={d}
                className={cn(
                  "flex flex-col gap-0.5 border-b border-line-soft p-1.5",
                  cal.mode === "week" ? "min-h-[440px]" : "min-h-[124px]",
                  i % 7 !== 6 && "border-r",
                  (isWeekend(d) || holidays.length > 0) && "bg-bg-subtle",
                  out && "opacity-45",
                )}
                data-testid="wp-cal-day"
                data-day={d}
              >
                <div className="flex items-baseline justify-between gap-1 px-1">
                  <span className={cn("inline-flex h-7 min-w-7 items-center justify-center rounded-full text-[13px] tabular-nums", d === data.today ? "bg-ink px-1.5 font-semibold text-on-ink" : "text-ink-2")}>{Number(d.slice(8))}</span>
                  {holidays.length ? <span className="truncate text-[11px] font-medium text-accent-ink" title={holidays.map((h) => h.title).join(", ")}>{holidays[0]!.title}</span> : null}
                </div>
                {events.slice(0, max).map((e) => (
                  <EventChip key={e.id} e={e} href={hrefOf(e)} />
                ))}
                {events.length > max ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="h-7 rounded-lg px-1.5 text-left text-[12px] font-medium text-muted hover:bg-panel hover:text-ink">
                        {t("more", { count: events.length - max })}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-1.5">
                      {events.map((e) => (
                        <EventChip key={e.id} e={e} href={hrefOf(e)} />
                      ))}
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: the same days as an agenda. */}
      <div className="md:hidden">
        {agenda.length === 0 ? <p className="px-4 py-6 text-[14px] text-muted">{t("empty")}</p> : null}
        <ul className="flex flex-col">
          {agenda.map((d) => {
            const list = byDay.get(d) ?? [];
            const holidays = list.filter((e) => e.kind === "holiday");
            return (
              <li key={d} className="flex gap-3 border-b border-line-soft px-3 py-2.5 last:border-0">
                <div className="flex w-12 shrink-0 flex-col items-center pt-1">
                  <span className="text-[12px] uppercase text-muted">{format(parseDay(d), "EEE", { locale: loc })}</span>
                  <span className={cn("inline-flex h-8 min-w-8 items-center justify-center rounded-full text-[16px] font-semibold tabular-nums", d === data.today && "bg-ink text-on-ink")}>{Number(d.slice(8))}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {holidays.map((h) => (
                    <span key={h.id} className="px-1.5 text-[12px] font-medium text-accent-ink">
                      {h.title}
                    </span>
                  ))}
                  {list
                    .filter((e) => e.kind !== "holiday")
                    .map((e) => (
                      <EventChip key={e.id} e={e} href={hrefOf(e)} />
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2.5 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ink" />
          {t("kinds.meeting")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-full border-[1.5px] border-ink/60" />
          {t("kinds.task")}
        </span>
        <span className="flex items-center gap-1.5">
          <Play size={11} className="fill-current" />
          {t("kinds.start")}
        </span>
        <span className="flex items-center gap-1.5">
          <Flag size={11} />
          {t("kinds.end")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rotate-45 border-[1.5px] border-ink" />
          {t("kinds.report")}
        </span>
      </div>
    </div>
  );
}
