"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { planDayAction } from "@/app/(app)/today/actions";
import type { TaskItem } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";

type Row = { task: TaskItem; picked: boolean; estimate: string };

/**
 * Sunsama's morning ritual: pick today's tasks, put them in order, add
 * time estimates, and see at once whether the day fits in working hours.
 */
export function PlanDayDialog({
  open,
  onOpenChange,
  day,
  candidates,
  workMinutes,
  meetingMinutes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  day: string;
  candidates: TaskItem[];
  workMinutes: number;
  meetingMinutes: number;
}) {
  const t = useTranslations("today.plan");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} wide>
        {/* The body mounts each time the dialog opens, so it starts from the current tasks. */}
        <PlanDayBody
          onOpenChange={onOpenChange}
          day={day}
          candidates={candidates}
          workMinutes={workMinutes}
          meetingMinutes={meetingMinutes}
        />
      </DialogContent>
    </Dialog>
  );
}

function initialRows(candidates: TaskItem[], day: string): Row[] {
  const planned = candidates
    .filter((c) => c.planDate === day)
    .sort((a, b) => (a.planOrder ?? 0) - (b.planOrder ?? 0));
  const rest = candidates.filter((c) => c.planDate !== day);
  return [
    ...planned.map((task) => ({
      task,
      picked: true,
      estimate: task.estimateMin ? String(task.estimateMin) : "",
    })),
    ...rest.map((task) => ({
      task,
      // Overdue and today's own tasks start picked; the rest of the week is offered.
      picked: Boolean(
        task.overdue ||
        (task.dueDate && task.dueDate <= day) ||
        (task.startDate && task.startDate <= day),
      ),
      estimate: task.estimateMin ? String(task.estimateMin) : "",
    })),
  ];
}

function PlanDayBody({
  onOpenChange,
  day,
  candidates,
  workMinutes,
  meetingMinutes,
}: {
  onOpenChange: (v: boolean) => void;
  day: string;
  candidates: TaskItem[];
  workMinutes: number;
  meetingMinutes: number;
}) {
  const t = useTranslations("today.plan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[]>(() => initialRows(candidates, day));
  const [busy, setBusy] = useState(false);

  const total = useMemo(
    () =>
      rows
        .filter((r) => r.picked)
        .reduce((a, r) => a + (Number(r.estimate) || 0), 0) + meetingMinutes,
    [rows, meetingMinutes],
  );
  const over = workMinutes > 0 && total > workMinutes;

  const move = (i: number, dir: -1 | 1) => {
    setRows((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    const picked = rows.filter((r) => r.picked);
    const removed = rows
      .filter((r) => !r.picked && r.task.planDate === day)
      .map((r) => r.task.id);
    const res = await runAction(
      planDayAction({
        day,
        items: picked.map((r) => ({
          id: r.task.id,
          estimateMin: Number(r.estimate) || null,
        })),
        removed,
      }),
      { success: t("saved") },
    );
    setBusy(false);
    if (res) onOpenChange(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-[15px] text-muted">{t("empty")}</p>
      ) : null}
      <ol className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <li
            key={r.task.id}
            className={cn(
              "flex items-center gap-3 rounded-xl px-2 py-1.5",
              r.picked ? "bg-panel" : "opacity-70",
            )}
          >
            <Checkbox
              checked={r.picked}
              onCheckedChange={(v) =>
                setRows((list) =>
                  list.map((x, k) =>
                    k === i ? { ...x, picked: v === true } : x,
                  ),
                )
              }
              aria-label={r.task.title}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px]">{r.task.title}</span>
              <span
                className={cn(
                  "text-[12.5px]",
                  r.task.overdue ? "font-medium text-overdue" : "text-muted",
                )}
              >
                {r.task.dueDate
                  ? relativeDayLabel(r.task.dueDate, locale, day)
                  : t("noDate")}
              </span>
            </span>
            <label className="flex items-center gap-1.5 text-[13px] text-muted">
              <input
                inputMode="numeric"
                value={r.estimate}
                onChange={(e) =>
                  setRows((list) =>
                    list.map((x, k) =>
                      k === i
                        ? {
                            ...x,
                            estimate: e.target.value
                              .replace(/\D/g, "")
                              .slice(0, 3),
                          }
                        : x,
                    ),
                  )
                }
                placeholder="—"
                aria-label={t("estimate")}
                className="h-9 w-14 rounded-lg border border-line-strong bg-bg px-2 text-right text-[14px] text-ink outline-none focus:border-ink"
              />
              {t("minutes")}
            </label>
            <div className="flex">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={t("up")}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={t("down")}
              >
                <ArrowDown size={14} />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div
        className={cn(
          "rounded-xl px-4 py-3 text-[14px]",
          over ? "bg-accent-soft text-accent-ink" : "bg-panel text-ink-2",
        )}
      >
        {over ? <strong className="font-semibold">{t("over")} </strong> : null}
        {t("total", {
          total: fmt(total, locale),
          work: fmt(workMinutes, locale),
          meetings: fmt(meetingMinutes, locale),
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {tc("cancel")}
        </Button>
        <Button onClick={save} disabled={busy}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

function fmt(min: number, locale: string) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (locale === "en") return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
  return h ? `${h} sa${m ? ` ${m} dk` : ""}` : `${m} dk`;
}
