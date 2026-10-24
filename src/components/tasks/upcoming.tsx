"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useShell } from "@/components/shell/shell-context";
import { formatLongDay, formatTime, relativeDayLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { TaskList } from "./task-list";
import type { TaskItem } from "./types";

export type UpcomingDay = {
  day: string;
  tasks: TaskItem[];
  meetings: { id: string; title: string; startsAt: string | Date }[];
};

/** Yaklaşan: every day of the next weeks, tasks and meetings together (Things Upcoming). */
export function UpcomingView({ days, today, partnerNames, readOnly }: { days: UpcomingDay[]; today: string; partnerNames?: Map<string, string>; readOnly?: boolean }) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const shell = useShell();
  if (!days.some((d) => d.tasks.length || d.meetings.length)) {
    return <p className="rounded-2xl border border-dashed border-line-strong px-6 py-8 text-[15px] text-muted">{t("emptyUpcoming")}</p>;
  }
  return (
    <TaskList
      partnerNames={partnerNames}
      readOnly={readOnly}
      groups={days.map((d) => {
        const rel = relativeDayLabel(d.day, locale, today);
        const long = formatLongDay(d.day, locale);
        return {
          key: d.day,
          label: (
            <span className="flex items-baseline gap-2">
              <span className={cn(d.day === today && "text-ink")}>{rel === long.split(",")[0] ? long : `${rel} · ${long}`}</span>
            </span>
          ),
          items: d.tasks,
          empty: d.meetings.length ? undefined : <span className="text-faint">—</span>,
          action: (
            <span className="flex items-center gap-3">
              {d.meetings.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-[12.5px] hover:bg-panel-2">
                  <Users size={12} />
                  {formatTime(m.startsAt)} {m.title}
                </Link>
              ))}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => shell.openQuickAdd({ mode: "task", text: `${d.day} ` })}
                  aria-label={`${t("addTask")} · ${long}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                >
                  <Plus size={16} />
                </button>
              ) : null}
            </span>
          ),
        };
      })}
    />
  );
}
