"use client";

import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { dayOf, formatLongDay } from "@/lib/dates";
import { TaskList } from "./task-list";
import type { TaskItem } from "./types";
import { useTaskOps } from "./use-task-ops";

function shiftMonth(month: string, d: number) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + d, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Tamamlananlar: finished work by day, a month at a time, exportable to Excel. */
export function LogbookView({ items, month, partnerNames }: { items: TaskItem[]; month: string; partnerNames?: Map<string, string> }) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const ops = useTaskOps();
  const byDay = new Map<string, TaskItem[]>();
  for (const task of items) {
    const day = task.completedAt ? dayOf(task.completedAt) : "—";
    const list = byDay.get(day) ?? [];
    list.push(task);
    byDay.set(day, list);
  }
  const [y, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric" }).format(new Date(y!, m! - 1, 1));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={ops.hrefWith({ month: shiftMonth(month, -1) })} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={tc("previousMonth")}>
            <ChevronLeft size={18} />
          </Link>
          <span className="min-w-[140px] text-center text-[16px] font-medium capitalize">{label}</span>
          <Link href={ops.hrefWith({ month: shiftMonth(month, 1) })} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={tc("nextMonth")}>
            <ChevronRight size={18} />
          </Link>
          <span className="ml-3 text-[14px] text-muted">{t("logbook.count", { count: items.length })}</span>
        </div>
        <a href={`/api/tasks/export?month=${month}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download size={15} />
          {t("logbook.export")}
        </a>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-6 py-8 text-[15px] text-muted">{t("emptyLogbook")}</p>
      ) : (
        <TaskList
          partnerNames={partnerNames}
          groups={[...byDay.entries()].map(([day, list]) => ({ key: day, label: day === "—" ? "—" : formatLongDay(day, locale), items: list }))}
        />
      )}
    </div>
  );
}
