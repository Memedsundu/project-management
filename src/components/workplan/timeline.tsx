"use client";

import { AlertTriangle, Check, LocateFixed } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { moveActivityAction, restoreDatesAction } from "@/app/(app)/workplan/actions";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { barTone, dayNum, dayStr, groupActivities, shiftDay } from "./shared";
import type { ActivityItem, Milestone, WorkplanData } from "./types";
import { useHrefWith } from "./use-href";

const ROW = 44;
const GROUP = 36;
const PPD = { month: 3.2, quarter: 1.15 } as const;
const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Mode = "move" | "start" | "end";
type Dates = { start: string | null; end: string | null };

/** New dates after a drag of `delta` days on the bar body or one of its edges. */
function applyDelta(a: ActivityItem, d: Dates, mode: Mode, delta: number): Dates {
  if (!d.start && !d.end) return d;
  const s = d.start ?? d.end!;
  const e = d.end ?? d.start!;
  if (a.isMilestone || mode === "move") return { start: shiftDay(s, delta), end: a.isMilestone ? shiftDay(s, delta) : shiftDay(e, delta) };
  if (mode === "start") return { start: dayNum(shiftDay(s, delta)) > dayNum(e) ? e : shiftDay(s, delta), end: e };
  return { start: s, end: dayNum(shiftDay(e, delta)) < dayNum(s) ? s : shiftDay(e, delta) };
}

/** Greedy lanes so that overlapping season bands sit on separate lines. */
function laneOf<T extends { start: string; end: string }>(items: T[]) {
  const ends: number[] = [];
  return items
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((it) => {
      let lane = ends.findIndex((e) => e < dayNum(it.start));
      if (lane < 0) lane = ends.length;
      ends[lane] = dayNum(it.end);
      return { ...it, lane };
    });
}

function MilestoneMark({ m, x, locale }: { m: Milestone; x: number; locale: string }) {
  const tone =
    m.status === "late"
      ? "border-accent bg-accent"
      : m.status === "received"
        ? "border-ink bg-ink"
        : m.status === "due"
          ? "border-accent bg-bg"
          : m.kind === "key_date"
            ? "border-faint bg-bg"
            : "border-ink bg-bg";
  return (
    <Tip
      content={
        <span className="flex flex-col">
          <span className="font-medium">{m.label}</span>
          <span className="text-on-ink/70">{formatDay(m.date, locale, true)}</span>
        </span>
      }
    >
      <Link href={m.href} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-1.5" style={{ left: x }} aria-label={`${m.label}, ${formatDay(m.date, locale, true)}`} data-testid="wp-milestone">
        <span className={cn("block size-2.5 rotate-45 border-[1.5px]", m.kind === "donor_report" && "size-3", tone)} />
      </Link>
    </Tip>
  );
}

export function Timeline({ data, onOpen, readOnly }: { data: WorkplanData; onOpen: (id: string) => void; readOnly: boolean }) {
  const t = useTranslations("workplan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const hrefWith = useHrefWith();
  const ppd = PPD[data.scale];
  const origin = dayNum(data.range.from);
  const total = dayNum(data.range.to) - origin + 1;
  const width = Math.ceil(total * ppd);
  const x = (day: string) => (dayNum(day) - origin) * ppd;
  const scroller = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; mode: Mode; startX: number; delta: number; moved: boolean } | null>(null);
  const [kbd, setKbd] = useState<{ id: string; mode: Mode; delta: number } | null>(null);
  const kbdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dates sent to the server but not yet back; ignored once the server's dates change.
  const [pending, setPending] = useState<Record<string, Dates & { was: string }>>({});

  const datesOf = (a: ActivityItem): Dates => {
    const p = pending[a.id];
    if (p && p.was === `${a.startDate}|${a.endDate}`) return { start: p.start, end: p.end };
    return { start: a.startDate, end: a.endDate };
  };
  const shown = (a: ActivityItem): Dates => {
    const d = datesOf(a);
    if (drag?.id === a.id && drag.moved) return applyDelta(a, d, drag.mode, drag.delta);
    if (kbd?.id === a.id) return applyDelta(a, d, kbd.mode, kbd.delta);
    return d;
  };

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (dayNum(data.today) - origin) * PPD[data.scale] - 140);
  }, [data.scale, data.today, origin]);

  const groups = useMemo(
    () => groupActivities(data.activities, data.group, data.outputs, data.orgs, { noOutput: t("groups.noOutput"), noPartner: t("groups.noPartner"), all: t("groups.all") }),
    [data.activities, data.group, data.outputs, data.orgs, t],
  );

  // Rows in order, with the y of each activity's first appearance for the dependency arrows.
  const layout = useMemo(() => {
    const rows: ({ kind: "group"; key: string; label: string; items: ActivityItem[]; y: number } | { kind: "activity"; key: string; item: ActivityItem; y: number })[] = [];
    const yOf = new Map<string, number>();
    let y = 0;
    for (const g of groups) {
      if (data.group !== "none") {
        rows.push({ kind: "group", key: `g-${g.key}`, label: g.label, items: g.items, y });
        y += GROUP;
      }
      for (const a of g.items) {
        rows.push({ kind: "activity", key: `${g.key}-${a.id}`, item: a, y });
        if (!yOf.has(a.id)) yOf.set(a.id, y + ROW / 2);
        y += ROW;
      }
    }
    return { rows, yOf, height: y };
  }, [groups, data.group]);

  const years = useMemo(() => {
    const out: { y: number; from: string; to: string }[] = [];
    for (let y = Number(data.range.from.slice(0, 4)); y <= Number(data.range.to.slice(0, 4)); y++) out.push({ y, from: `${y}-01-01`, to: `${y}-12-31` });
    return out;
  }, [data.range]);
  const months = useMemo(() => {
    const out: { key: string; from: string; days: number; m: number }[] = [];
    for (const yr of years) {
      for (let m = 1; m <= 12; m++) {
        const from = `${yr.y}-${String(m).padStart(2, "0")}-01`;
        const next = m === 12 ? `${yr.y + 1}-01-01` : `${yr.y}-${String(m + 1).padStart(2, "0")}-01`;
        out.push({ key: from, from, days: dayNum(next) - dayNum(from), m });
      }
    }
    return out;
  }, [years]);
  const seasonLanes = useMemo(() => laneOf(data.bands), [data.bands]);
  const laneCount = Math.min(3, Math.max(1, ...seasonLanes.map((b) => b.lane + 1)));
  const monthNames = locale === "en" ? MONTHS_EN : MONTHS_TR;
  const fullHolidays = data.holidays.filter((h) => !h.halfDay);

  async function commit(a: ActivityItem, next: Dates, kind: "moved" | "placed" = "moved") {
    const before = datesOf(a);
    if (before.start === next.start && before.end === next.end) return;
    setPending((p) => ({ ...p, [a.id]: { ...next, was: `${a.startDate}|${a.endDate}` } }));
    const res = await runAction(moveActivityAction(a.id, next.start, next.end));
    if (!res) {
      setPending((p) => {
        const rest = { ...p };
        delete rest[a.id];
        return rest;
      });
      return;
    }
    const range = next.start && next.end && next.start !== next.end ? `${formatDay(next.start, locale)} – ${formatDay(next.end, locale, true)}` : formatDay(next.start ?? next.end ?? "", locale, true);
    const msg = kind === "placed" ? t("timeline.placed", { code: a.code, range }) : res.shifted ? t("timeline.movedWith", { code: a.code, range, count: res.shifted }) : t("timeline.moved", { code: a.code, range });
    toast(msg, { duration: 6000, action: { label: tc("undo"), onClick: () => runAction(restoreDatesAction(res.previous)) } });
  }

  function onKey(e: React.KeyboardEvent, a: ActivityItem) {
    if (readOnly || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const d = datesOf(a);
    if (!d.start && !d.end) return;
    e.preventDefault();
    const step = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 7 : 1);
    const mode: Mode = e.altKey ? "end" : "move";
    const next = kbd && kbd.id === a.id && kbd.mode === mode ? { ...kbd, delta: kbd.delta + step } : { id: a.id, mode, delta: step };
    setKbd(next);
    if (kbdTimer.current) clearTimeout(kbdTimer.current);
    kbdTimer.current = setTimeout(() => {
      setKbd(null);
      if (next.delta) void commit(a, applyDelta(a, d, next.mode, next.delta));
    }, 700);
  }

  function bar(a: ActivityItem) {
    const d = shown(a);
    if (!d.start && !d.end) {
      return readOnly ? null : (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[12px] text-faint opacity-0 transition-opacity group-hover/row:opacity-100" style={{ left: Math.max(0, x(data.today) - 60) }}>
          {t("timeline.placeHint")}
        </span>
      );
    }
    const s = d.start ?? d.end!;
    const e = d.end ?? d.start!;
    const left = x(s);
    const w = Math.max(a.isMilestone ? 0 : 8, (dayNum(e) - dayNum(s) + 1) * ppd);
    const dragging = (drag?.id === a.id && drag.moved) || kbd?.id === a.id;
    const label = `${a.code} ${a.title}`;
    const handlers = {
      onPointerDown: (ev: React.PointerEvent<HTMLElement>) => {
        if (readOnly || ev.button !== 0) return;
        const target = ev.target as HTMLElement;
        const mode: Mode = target.dataset.edge === "start" ? "start" : target.dataset.edge === "end" ? "end" : "move";
        ev.currentTarget.setPointerCapture(ev.pointerId);
        setDrag({ id: a.id, mode, startX: ev.clientX, delta: 0, moved: false });
      },
      onPointerMove: (ev: React.PointerEvent<HTMLElement>) => {
        if (!drag || drag.id !== a.id) return;
        const dx = ev.clientX - drag.startX;
        if (!drag.moved && Math.abs(dx) < 4) return;
        setDrag({ ...drag, moved: true, delta: Math.round(dx / ppd) });
      },
      onPointerUp: () => {
        if (!drag || drag.id !== a.id) return;
        const done = drag;
        setDrag(null);
        if (!done.moved) return;
        suppressClick.current = true;
        if (done.delta) void commit(a, applyDelta(a, datesOf(a), done.mode, done.delta));
      },
      onPointerCancel: () => setDrag(null),
      onClick: () => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpen(a.id);
      },
      onKeyDown: (ev: React.KeyboardEvent) => onKey(ev, a),
    };
    const tip = (
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-on-ink/70">
          {s === e ? formatDay(s, locale, true) : `${formatDay(s, locale)} – ${formatDay(e, locale, true)}`} · {t(`status.${a.status}`)}
          {a.progress ? ` · %${a.progress}` : ""}
        </span>
      </span>
    );
    if (a.isMilestone) {
      return (
        <>
          <Tip content={tip}>
            <button
              type="button"
              {...handlers}
              aria-label={`${label}, ${formatDay(s, locale, true)}`}
              className={cn("absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 touch-none p-2 outline-none focus-visible:ring-2 focus-visible:ring-ink", !readOnly && "cursor-grab active:cursor-grabbing")}
              style={{ left: left + ppd / 2 }}
              data-testid="wp-bar"
            >
              <span className={cn("block size-3.5 rotate-45", a.late ? "bg-accent" : a.status === "done" ? "bg-faint" : "bg-ink")} />
            </button>
          </Tip>
          <span className="pointer-events-none absolute top-1/2 max-w-[220px] -translate-y-1/2 truncate text-[12px] text-muted" style={{ left: left + ppd / 2 + 14 }}>
            {a.title}
          </span>
        </>
      );
    }
    const inside = w >= 96;
    return (
      <>
        <Tip content={tip}>
          <button
            type="button"
            {...handlers}
            aria-label={`${label}, ${formatDay(s, locale)} – ${formatDay(e, locale, true)}`}
            className={cn(
              "absolute top-1/2 z-[1] flex h-7 -translate-y-1/2 touch-none items-center overflow-hidden rounded-full px-2.5 text-left text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2",
              barTone(a),
              !readOnly && "cursor-grab active:cursor-grabbing",
              dragging && "shadow-[var(--shadow)]",
            )}
            style={{ left, width: w }}
            data-testid="wp-bar"
            data-code={a.code}
          >
            {!readOnly ? (
              <>
                <span data-edge="start" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden />
                <span data-edge="end" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden />
              </>
            ) : null}
            {inside ? (
              <span className="pointer-events-none flex min-w-0 items-center gap-1">
                {a.status === "done" ? <Check size={12} className="shrink-0" /> : null}
                <span className="truncate">{a.title}</span>
              </span>
            ) : null}
            {a.progress > 0 && a.progress < 100 ? <span className="pointer-events-none absolute bottom-0 left-0 h-[3px] bg-current opacity-50" style={{ width: `${a.progress}%` }} /> : null}
          </button>
        </Tip>
        {!inside ? (
          <span className="pointer-events-none absolute top-1/2 max-w-[240px] -translate-y-1/2 truncate text-[12px] text-muted" style={{ left: left + w + 6 }}>
            {a.title}
          </span>
        ) : null}
      </>
    );
  }

  // Arrows from the end of what an activity waits for to its start (Notion dependencies).
  const arrows = useMemo(() => {
    const out: { key: string; d: string; bad: boolean }[] = [];
    const byId = new Map(data.activities.map((a) => [a.id, a]));
    for (const a of data.activities) {
      const y2 = layout.yOf.get(a.id);
      if (y2 === undefined || !a.startDate) continue;
      for (const dep of a.dependsOn) {
        const p = byId.get(dep);
        const y1 = layout.yOf.get(dep);
        if (!p || y1 === undefined || !(p.endDate ?? p.startDate)) continue;
        const x1 = x(p.endDate ?? p.startDate!) + ppd;
        const x2 = x(a.startDate);
        const bad = p.status !== "done" && p.status !== "canceled" && (p.endDate ?? p.startDate!) >= a.startDate;
        const down = y2 > y1 ? 1 : -1;
        const d = x2 - x1 >= 14 ? `M ${x1} ${y1} H ${x1 + 6} V ${y2} H ${x2 - 3}` : `M ${x1} ${y1} H ${x1 + 6} V ${y2 - (down * ROW) / 2} H ${x2 - 10} V ${y2} H ${x2 - 3}`;
        out.push({ key: `${a.id}-${dep}`, d, bad });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.activities, layout, ppd, origin]);

  const todayX = x(data.today);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line" data-testid="wp-timeline">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1">
          {(["month", "quarter"] as const).map((s) => (
            <Link
              key={s}
              href={hrefWith({ scale: s === "month" ? null : s })}
              scroll={false}
              aria-current={data.scale === s ? "true" : undefined}
              className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-[14px]", data.scale === s ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
            >
              {t(`scale.${s}`)}
            </Link>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scroller.current?.scrollTo({ left: Math.max(0, todayX - 140), behavior: "smooth" })}
            className="ml-1"
          >
            <LocateFixed size={15} />
            {t("today")}
          </Button>
        </div>
        {!readOnly ? <p className="hidden text-[13px] text-muted lg:block">{t("timeline.dragHint")}</p> : null}
      </div>

      <div
        ref={scroller}
        className="scrollbar-thin relative max-h-[calc(100dvh-260px)] min-h-[340px] overflow-auto overscroll-x-contain [--wp-label:140px] md:[--wp-label:280px]"
      >
        <div className="relative" style={{ width: `calc(var(--wp-label) + ${width}px)` }}>
          {/* Header: years, months or quarters, the holidays and today. */}
          <div className="sticky top-0 z-20 bg-bg">
            <div className="flex border-b border-line">
              <div className="label-caps sticky left-0 z-10 flex w-[var(--wp-label)] shrink-0 items-end border-r border-line bg-bg px-3 pb-2 text-muted">{t("timeline.label")}</div>
              <div className="relative h-[60px] shrink-0" style={{ width }}>
                {years.map((yr) => (
                  <div key={yr.y} className="absolute top-0 h-6 border-l border-line-strong pl-2 pt-1 text-[12px] font-semibold" style={{ left: x(yr.from), width: (dayNum(yr.to) - dayNum(yr.from) + 1) * ppd }}>
                    <span className="sticky left-[calc(var(--wp-label)+8px)]">{yr.y}</span>
                  </div>
                ))}
                {data.scale === "month"
                  ? months.map((m) => (
                      <div key={m.key} className={cn("absolute top-6 h-[36px] border-l pl-1.5 pt-2 text-[12px] text-muted", m.m === 1 ? "border-line-strong" : "border-line-soft")} style={{ left: x(m.from), width: m.days * ppd }}>
                        {monthNames[m.m - 1]}
                      </div>
                    ))
                  : months
                      .filter((m) => (m.m - 1) % 3 === 0)
                      .map((m) => (
                        <div key={m.key} className={cn("absolute top-6 h-[36px] border-l pl-1.5 pt-2 text-[12px] text-muted", m.m === 1 ? "border-line-strong" : "border-line-soft")} style={{ left: x(m.from), width: ((dayNum(shiftDay(m.from, 92).slice(0, 8) + "01") - dayNum(m.from)) * ppd) }}>
                          {locale === "en" ? `Q${(m.m + 2) / 3}` : `Ç${(m.m + 2) / 3}`}
                        </div>
                      ))}
                {fullHolidays.map((h) => (
                  <span key={h.id} title={`${locale === "en" ? h.nameEn : h.nameTr} · ${formatDay(h.date, locale, true)}`} className="absolute bottom-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-faint" style={{ left: x(h.date) + ppd / 2 }} />
                ))}
                <span className="absolute bottom-0 top-6 w-0.5 bg-ink" style={{ left: todayX }} aria-hidden />
                <span className="absolute top-6 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-on-ink" style={{ left: todayX }}>
                  {t("today")}
                </span>
              </div>
            </div>
            {/* Lanes: seasons and report dates. */}
            {data.bands.length ? (
              <div className="flex border-b border-line">
                <div className="sticky left-0 z-10 flex w-[var(--wp-label)] shrink-0 items-center border-r border-line bg-bg px-3 text-[13px] text-muted">{t("lanes.seasons")}</div>
                <div className="relative shrink-0" style={{ width, height: laneCount * 24 + 8 }}>
                  {seasonLanes
                    .filter((b) => b.lane < 3)
                    .map((b) => (
                      <Tip key={b.id} content={`${b.name} · ${formatDay(b.start, locale)} – ${formatDay(b.end, locale, true)}`}>
                        <span
                          className="absolute flex h-5 items-center overflow-hidden rounded-full border border-line-strong bg-[repeating-linear-gradient(135deg,var(--color-panel-2)_0_5px,var(--color-bg)_5px_10px)] px-2 text-[11px] font-medium text-ink-2"
                          style={{ left: x(b.start), width: Math.max(10, (dayNum(b.end) - dayNum(b.start) + 1) * ppd), top: 4 + b.lane * 24 }}
                          data-testid="wp-season"
                        >
                          <span className="truncate">{b.name}</span>
                        </span>
                      </Tip>
                    ))}
                </div>
              </div>
            ) : null}
            <div className="flex border-b border-line">
              <div className="sticky left-0 z-10 flex w-[var(--wp-label)] shrink-0 items-center border-r border-line bg-bg px-3 text-[13px] text-muted">{t("lanes.milestones")}</div>
              <div className="relative h-8 shrink-0" style={{ width }}>
                {data.milestones.map((m) => (
                  <MilestoneMark key={m.id} m={m} x={x(m.date) + ppd / 2} locale={locale} />
                ))}
              </div>
            </div>
          </div>

          {/* Body: background bands, arrows and one row per activity. */}
          <div className="relative" style={{ minHeight: layout.height }}>
            <div className="pointer-events-none absolute inset-y-0" style={{ left: "var(--wp-label)", width }} aria-hidden>
              {data.bands.map((b) => (
                <span key={b.id} className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,var(--color-panel-2)_0_6px,transparent_6px_12px)] opacity-70" style={{ left: x(b.start), width: (dayNum(b.end) - dayNum(b.start) + 1) * ppd }} />
              ))}
              {(data.scale === "month" ? months : months.filter((m) => (m.m - 1) % 3 === 0)).map((m) => (
                <span key={m.key} className={cn("absolute inset-y-0 w-px", m.m === 1 ? "bg-line-strong" : "bg-line-soft")} style={{ left: x(m.from) }} />
              ))}
              {data.scale === "month" ? fullHolidays.map((h) => <span key={h.id} className="absolute inset-y-0 bg-panel" style={{ left: x(h.date), width: Math.max(2, ppd) }} />) : null}
              <span className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: todayX }} />
            </div>
            <svg className="pointer-events-none absolute top-0 z-[2] overflow-visible" style={{ left: "var(--wp-label)", width, height: layout.height }} aria-hidden>
              <defs>
                <marker id="wp-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--color-faint)" />
                </marker>
                <marker id="wp-arrow-bad" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--color-accent)" />
                </marker>
              </defs>
              {arrows.map((ar) => (
                <path key={ar.key} d={ar.d} fill="none" stroke={ar.bad ? "var(--color-accent)" : "var(--color-faint)"} strokeWidth={1.25} markerEnd={ar.bad ? "url(#wp-arrow-bad)" : "url(#wp-arrow)"} />
              ))}
            </svg>
            {layout.rows.map((r) =>
              r.kind === "group" ? (
                <div key={r.key} className="flex border-b border-line bg-bg-subtle" style={{ height: GROUP }}>
                  <div className="sticky left-0 z-10 flex w-[var(--wp-label)] shrink-0 items-center gap-2 border-r border-line bg-bg-subtle px-3">
                    <span className="truncate text-[13px] font-semibold">{r.label}</span>
                    <span className="text-[12px] text-faint">{r.items.length}</span>
                  </div>
                  <div className="relative shrink-0" style={{ width }}>
                    {(() => {
                      const ds = r.items.flatMap((a) => [a.startDate, a.endDate]).filter((d): d is string => Boolean(d)).sort();
                      if (!ds.length) return null;
                      return <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/25" style={{ left: x(ds[0]!), width: Math.max(4, (dayNum(ds.at(-1)!) - dayNum(ds[0]!) + 1) * ppd) }} />;
                    })()}
                  </div>
                </div>
              ) : (
                <div key={r.key} className="group/row flex border-b border-line-soft" style={{ height: ROW }}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.item.id)}
                    className="sticky left-0 z-10 flex w-[var(--wp-label)] shrink-0 items-center gap-2 border-r border-line bg-bg px-3 text-left hover:bg-panel"
                    data-testid="wp-row"
                  >
                    <span className="w-9 shrink-0 truncate text-[12px] tabular-nums text-muted md:w-12">{r.item.code}</span>
                    <span className={cn("min-w-0 flex-1 truncate text-[14px]", r.item.status === "canceled" && "text-faint line-through")}>{r.item.title}</span>
                    {r.item.late || r.item.atRisk ? <AlertTriangle size={14} className="shrink-0 text-accent" aria-label={r.item.late ? t("flags.late") : t("flags.atRisk")} /> : null}
                  </button>
                  <div
                    className={cn("relative shrink-0", !readOnly && !r.item.startDate && !r.item.endDate && "cursor-pointer")}
                    style={{ width }}
                    onClick={(e) => {
                      const a = r.item;
                      const d = datesOf(a);
                      if (readOnly || d.start || d.end || e.target !== e.currentTarget) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const day = dayStr(origin + Math.floor((e.clientX - rect.left) / ppd));
                      void commit(a, { start: day, end: a.isMilestone ? day : shiftDay(day, 29) }, "placed");
                    }}
                  >
                    {bar(r.item)}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-3 py-2.5 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded-full bg-ink" />
          {t("timeline.legend.ongoing")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded-full border border-ink/60" />
          {t("timeline.legend.planned")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded-full border border-line bg-panel-2" />
          {t("timeline.legend.done")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded-full border border-accent bg-accent-soft" />
          {t("timeline.legend.late")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 border-[1.5px] border-ink" />
          {t("timeline.legend.milestone")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-6 rounded-full border border-line-strong bg-[repeating-linear-gradient(135deg,var(--color-panel-2)_0_4px,var(--color-bg)_4px_8px)]" />
          {t("timeline.legend.season")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-faint" />
          {t("timeline.legend.holiday")}
        </span>
      </div>
      {/* Screen readers get the same plan as a list. */}
      <ul className="sr-only">
        {data.activities.map((a) => (
          <Fragment key={a.id}>
            <li>
              {a.code} {a.title}: {a.startDate ? formatDay(a.startDate, locale, true) : "—"} – {a.endDate ? formatDay(a.endDate, locale, true) : "—"}, {t(`status.${a.status}`)}
            </li>
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
