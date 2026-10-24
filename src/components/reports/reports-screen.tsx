"use client";

import { BarChart3, BookOpen, FileText, LayoutTemplate, Plus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { dayOf, daysBetween, formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ReportsHomeData } from "@/server/views/reports";
import { NewReportDialog, TemplateReaderDialog } from "./report-dialogs";
import { NewVisualDialog } from "./visual-dialogs";

type ReportRow = ReportsHomeData["reports"][number];

/** "14 Kas · 3 gün kaldı", amber once it is a week away or late. */
export function DueLabel({ due, today, final }: { due: string | null; today: string; final?: boolean }) {
  const t = useTranslations("reports.list");
  const locale = useLocale();
  if (!due) return null;
  const left = daysBetween(today, due);
  const urgent = !final && left <= 7;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", urgent ? "font-medium text-accent-ink" : "text-muted")} data-testid="report-due">
      {formatDay(due, locale)}
      {!final ? <span>· {left < 0 ? t("late", { count: -left }) : left === 0 ? t("dueToday") : t("left", { count: left })}</span> : null}
    </span>
  );
}

function ReportItem({ r, today }: { r: ReportRow; today: string }) {
  const t = useTranslations("reports.list");
  const tl = useTranslations("reports.languages");
  const locale = useLocale();
  const pct = r.sectionCount ? Math.round((r.draftedCount / r.sectionCount) * 100) : 0;
  return (
    <li>
      <Link href={`/reports/${r.id}`} className="flex flex-col gap-3 rounded-2xl border border-line px-5 py-4 transition-colors hover:border-ink sm:flex-row sm:items-center sm:gap-6" data-testid="report-row">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[17px] font-semibold">{r.title}</span>
            {r.status === "final" ? (
              <Badge variant="success" size="sm">
                {t("final")}
              </Badge>
            ) : null}
          </span>
          <span className="flex flex-wrap gap-x-1.5 text-[14px] text-muted">
            {[r.periodLabel, r.audience, tl(r.language as "en-GB"), t("updated", { date: formatDay(dayOf(r.updatedAt), locale) })]
              .filter(Boolean)
              .map((bit, i) => (
                <span key={i}>{i ? `· ${bit}` : bit}</span>
              ))}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
          <DueLabel due={r.dueDate} today={today} final={r.status === "final"} />
          <span className="flex items-center gap-2.5" aria-label={t("progressLabel", { done: r.draftedCount, total: r.sectionCount })}>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel-2" aria-hidden>
              <span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
            </span>
            <span className="whitespace-nowrap text-muted">
              {t("sections", { done: r.draftedCount, total: r.sectionCount })}
              {r.words ? ` · ${t("words", { count: r.words })}` : ""}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Raporlar (NotebookLM for donor reports): each report has its own sources,
 * Claude drafts the sections from them with citations, and she edits.
 * Charts and one-pagers for the reports sit underneath.
 */
export function ReportsScreen({ data }: { data: ReportsHomeData }) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const shell = useShell();
  const [creating, setCreating] = useState<string | null | false>(false);
  const [reading, setReading] = useState(false);
  const [visual, setVisual] = useState<"chart" | "onepager" | null>(null);
  useScreenContext({ kind: "reports", title: t("title"), detail: t("list.count", { count: data.reports.length }) });

  // Open drafts by deadline first, then the rest; finished reports last.
  const ordered = useMemo(() => {
    const open = data.reports.filter((r) => r.status !== "final");
    const dated = open.filter((r) => r.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    return [...dated, ...open.filter((r) => !r.dueDate), ...data.reports.filter((r) => r.status === "final")];
  }, [data.reports]);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          !shell.readOnly ? (
            <>
              <Button variant="outline" onClick={() => setReading(true)} data-testid="template-read">
                <BookOpen size={16} />
                {t("readTemplate")}
              </Button>
              <Button onClick={() => setCreating(null)} data-testid="report-new">
                <Plus size={16} />
                {t("new")}
              </Button>
            </>
          ) : undefined
        }
      />

      <section className="flex flex-col gap-3" aria-labelledby="reports-h">
        <h2 id="reports-h" className="label-caps">
          {t("list.title")}
        </h2>
        {ordered.length ? (
          <ul className="flex flex-col gap-2" data-testid="report-list">
            {ordered.map((r) => (
              <ReportItem key={r.id} r={r} today={data.today} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<FileText size={22} />}
            title={t("list.emptyTitle")}
            body={t("list.emptyBody")}
            action={
              !shell.readOnly ? (
                <Button onClick={() => setCreating(null)}>
                  <Plus size={16} />
                  {t("new")}
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="visuals-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="visuals-h" className="label-caps">
            {t("visuals.title")}
          </h2>
          {!shell.readOnly ? (
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setVisual("chart")} data-testid="visual-new-chart">
                <BarChart3 size={15} />
                {t("visuals.newChart")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setVisual("onepager")} data-testid="visual-new-onepager">
                <LayoutTemplate size={15} />
                {t("visuals.newOnePager")}
              </Button>
            </span>
          ) : null}
        </div>
        {data.visuals.length ? (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="visual-list">
            {data.visuals.map((v) => (
              <li key={v.id}>
                <Link href={`/reports/visuals/${v.id}`} className="flex h-full items-start gap-3 rounded-2xl border border-line px-4 py-3.5 transition-colors hover:border-ink" data-testid="visual-card">
                  <span className="mt-0.5 text-muted">{v.kind === "chart" ? <BarChart3 size={17} /> : <LayoutTemplate size={17} />}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-medium">{v.title}</span>
                    <span className="truncate text-[13px] text-muted">
                      {t(`visuals.kinds.${v.kind}`)}
                      {v.reportTitle ? ` · ${v.reportTitle}` : ""} · {formatDay(dayOf(v.updatedAt), locale)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-line-strong px-4 py-4 text-[14px] text-muted">{t("visuals.empty")}</p>
        )}
      </section>

      {creating !== false ? <NewReportDialog open onOpenChange={(v) => !v && setCreating(false)} templates={data.templates} periods={data.periods} spelling={data.spelling} initialTemplate={creating} /> : null}
      {reading ? (
        <TemplateReaderDialog
          open
          onOpenChange={setReading}
          aiReady={data.aiReady}
          onSaved={(id) => {
            setReading(false);
            setCreating(id);
          }}
        />
      ) : null}
      {visual ? <NewVisualDialog open onOpenChange={(v: boolean) => !v && setVisual(null)} kind={visual} reportId={null} aiReady={data.aiReady} /> : null}
    </div>
  );
}
