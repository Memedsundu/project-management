"use client";

import { AlertTriangle, ArrowUpRight, BarChart3, CalendarRange, Check, ChevronDown, Download, FileSearch, ListFilter, MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { IndicatorDialog } from "./indicator-form";
import { PeriodsDialog } from "./periods-dialog";
import { ReadReportDialog } from "./read-report-dialog";
import { fmtRatio, fmtValue, groupByNode, orgLabel, STATUS_ORDER } from "./shared";
import type { IndicatorStatus, IndicatorsData, IpttCellItem, IpttItem } from "./types";

export function useHref() {
  const pathname = usePathname();
  const sp = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
}

export function StatusPill({ status, className }: { status: IndicatorStatus; className?: string }) {
  const t = useTranslations("indicators.status");
  if (status === "behind")
    return (
      <Badge variant="overdue" className={className}>
        <AlertTriangle size={12} />
        {t("behind")}
      </Badge>
    );
  if (status === "on_track")
    return (
      <Badge variant="neutral" className={className}>
        <Check size={12} />
        {t("on_track")}
      </Badge>
    );
  if (status === "ahead")
    return (
      <Badge variant="neutral" className={className}>
        <ArrowUpRight size={12} />
        {t("ahead")}
      </Badge>
    );
  return (
    <Badge variant="outline" className={className}>
      {t("no_data")}
    </Badge>
  );
}

/** Progress against the target so far: ink while on track, amber when behind. The track is a lighter step. */
export function Meter({ ratio, behind, className, label }: { ratio: number | null; behind?: boolean; className?: string; label?: string }) {
  if (ratio === null) return null;
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-panel-2", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(ratio, 1) * 100)} aria-label={label}>
      <span className={cn("block h-full rounded-full", behind ? "bg-accent" : "bg-ink")} style={{ width: `${Math.max(2, Math.min(ratio, 1) * 100)}%` }} />
    </span>
  );
}

function PeriodCell({ cell, unit }: { cell: IpttCellItem | undefined; unit: IpttItem["unit"] }) {
  const t = useTranslations("indicators.table");
  const locale = useLocale();
  if (!cell || (cell.actual === null && cell.target === null && !cell.proposed)) return <span className="text-faint">—</span>;
  const short = cell.ended && cell.target !== null && cell.percent !== null && cell.percent < 0.9;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cn("font-semibold tabular-nums", short && "text-accent-ink")}>{cell.actual !== null ? fmtValue(cell.actual, unit, locale) : "—"}</span>
      <span className="text-[12px] tabular-nums text-muted">{cell.target !== null ? t("of", { target: fmtValue(cell.target, unit, locale) }) : " "}</span>
      {cell.proposed ? (
        <span className="mt-0.5 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-ink" title={t("proposed", { count: cell.proposed })}>
          +{cell.proposed}
        </span>
      ) : null}
    </span>
  );
}

function ToDate({ r }: { r: IpttItem }) {
  const t = useTranslations("indicators.table");
  const locale = useLocale();
  if (r.toDateActual === null && r.toDateTarget === null) return <span className="text-faint">—</span>;
  return (
    <span className="flex min-w-[120px] flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums">{fmtValue(r.toDateActual, r.unit, locale)}</span>
        <span className="text-[12px] tabular-nums text-muted">{r.toDateTarget !== null ? t("of", { target: fmtValue(r.toDateTarget, r.unit, locale) }) : ""}</span>
      </span>
      <Meter ratio={r.percentToDate} behind={r.status === "behind"} label={fmtRatio(r.percentToDate, locale)} />
      <span className="text-[12px] tabular-nums text-muted">{r.percentToDate !== null ? fmtRatio(r.percentToDate, locale) : " "}</span>
    </span>
  );
}

function IpttTable({ data }: { data: IndicatorsData }) {
  const t = useTranslations("indicators");
  const locale = useLocale();
  const groups = groupByNode(data.rows, data.nodes);
  const cols = 6 + data.periods.length;
  const sticky = "sticky left-0 z-[1]";
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-line md:block" data-testid="iptt">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="text-left">
            <th className={cn(sticky, "label-caps border-b border-line bg-bg px-3 py-2.5 font-medium text-muted")}>{t("table.indicator")}</th>
            <th className="label-caps border-b border-line px-3 py-2.5 text-right font-medium text-muted">{t("table.baseline")}</th>
            {data.periods.map((p) => (
              <th key={p.id} className="whitespace-nowrap border-b border-line px-3 py-2.5 text-right text-[12px] font-semibold text-muted">
                {p.label}
              </th>
            ))}
            <th className="label-caps border-b border-line px-3 py-2.5 font-medium text-muted">{t("table.toDate")}</th>
            <th className="label-caps border-b border-line px-3 py-2.5 text-right font-medium text-muted">{t("table.lop")}</th>
            <th className="label-caps border-b border-line px-3 py-2.5 font-medium text-muted">{t("table.status")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.key} label={g.node ? `${t(`levels.${g.node.level}`)} ${g.node.code} · ${g.node.title}` : t("table.noNode")} cols={cols}>
              {g.rows.map((r) => {
                const behind = r.status === "behind";
                const tint = behind ? "bg-[color-mix(in_oklab,var(--color-accent-soft)_60%,var(--color-bg))]" : "bg-bg";
                return (
                  <tr key={r.id} className={cn("group border-b border-line-soft last:border-0", tint)} data-testid="iptt-row" data-status={r.status}>
                    <td className={cn(sticky, tint, "min-w-[280px] max-w-[380px] px-3 py-2.5 align-top")}>
                      <Link href={`/indicators/${r.id}`} className="flex flex-col gap-0.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ink">
                        <span className="flex items-baseline gap-2">
                          <span className="shrink-0 text-[13px] tabular-nums text-muted">{r.code}</span>
                          <span className="font-medium group-hover:underline">{r.name}</span>
                        </span>
                        <span className="text-[12px] text-muted">
                          {[orgLabel(data.orgs, r.responsibleOrgId), r.unit === "percent" ? t("units.percent") : null, !r.cumulative && r.unit === "number" ? t("table.latest") : null].filter(Boolean).join(" · ")}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted">{fmtValue(r.baseline, r.unit, locale)}</td>
                    {data.periods.map((p) => (
                      <td key={p.id} className="px-3 py-2.5 text-right align-top">
                        <PeriodCell cell={r.cells.find((c) => c.periodId === p.id)} unit={r.unit} />
                      </td>
                    ))}
                    <td className="px-3 py-2.5 align-top">
                      <ToDate r={r} />
                    </td>
                    <td className="px-3 py-2.5 text-right align-top">
                      <span className="flex flex-col items-end leading-tight">
                        <span className="tabular-nums">{fmtValue(r.lopTarget, r.unit, locale)}</span>
                        <span className="text-[12px] tabular-nums text-muted">{r.percentOfLop !== null ? fmtRatio(r.percentOfLop, locale) : " "}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                );
              })}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} className="border-b border-line bg-bg-subtle px-3 py-2">
          <span className="sticky left-3 text-[13px] font-semibold">{label}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

function IpttCards({ data }: { data: IndicatorsData }) {
  const t = useTranslations("indicators");
  const locale = useLocale();
  const groups = groupByNode(data.rows, data.nodes);
  return (
    <div className="flex flex-col gap-5 md:hidden" data-testid="iptt-cards">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold text-muted">{g.node ? `${g.node.code} · ${g.node.title}` : t("table.noNode")}</h2>
          {g.rows.map((r) => (
            <Link key={r.id} href={`/indicators/${r.id}`} className={cn("flex flex-col gap-2 rounded-2xl border border-line px-4 py-3.5", r.status === "behind" && "border-accent/40 bg-accent-soft/50")}>
              <span className="flex items-start justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[12px] tabular-nums text-muted">{r.code}</span>
                  <span className="text-[15px] font-medium leading-snug">{r.name}</span>
                </span>
                <StatusPill status={r.status} className="shrink-0" />
              </span>
              <span className="flex items-baseline justify-between gap-2 text-[14px]">
                <span>
                  <span className="font-semibold tabular-nums">{fmtValue(r.toDateActual, r.unit, locale)}</span>
                  {r.toDateTarget !== null ? <span className="text-muted"> {t("table.of", { target: fmtValue(r.toDateTarget, r.unit, locale) })}</span> : null}
                </span>
                <span className="text-[13px] tabular-nums text-muted">{fmtRatio(r.percentToDate, locale)}</span>
              </span>
              <Meter ratio={r.percentToDate} behind={r.status === "behind"} />
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

type DialogKind = "new" | "periods" | "read" | null;

/** Göstergeler: the IPTT, one row per indicator under its logframe item. */
export function IndicatorsScreen({ data }: { data: IndicatorsData }) {
  const t = useTranslations("indicators");
  const shell = useShell();
  const router = useRouter();
  const href = useHref();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const readOnly = shell.readOnly;
  const behind = data.rows.filter((r) => r.status === "behind").length;
  const noData = data.rows.filter((r) => r.status === "no_data").length;
  const filtered = Boolean(data.filters.status || data.filters.partner);
  useScreenContext({ kind: "indicators", title: t("title"), detail: `${data.total} indicators, ${behind} behind target` });

  const tabs = [
    { key: "iptt", label: t("tabs.iptt"), href: "/indicators" },
    { key: "logframe", label: t("tabs.logframe"), href: "/indicators/logframe" },
  ];
  const years = [...data.years.map((y) => ({ key: y, label: y, href: href({ year: y }) })), { key: "all", label: t("allYears"), href: href({ year: "all" }) }];
  const subtitle =
    data.total === 0
      ? t("subtitle")
      : [t("summary", { count: data.total }), behind ? t("summaryBehind", { count: behind }) : null, noData ? t("summaryNoData", { count: noData }) : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={subtitle}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("more")}>
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href="/api/indicators/export" download>
                    <Download size={15} />
                    {t("export")}
                  </a>
                </DropdownMenuItem>
                {!readOnly && data.aiReady ? (
                  <DropdownMenuItem onSelect={() => setDialog("read")}>
                    <FileSearch size={15} />
                    {t("read.menu")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDialog("periods")}>
                  <CalendarRange size={15} />
                  {t("periods.title")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!readOnly ? (
              <Button onClick={() => setDialog("new")} data-testid="ind-new">
                <Plus size={16} />
                {t("new")}
              </Button>
            ) : null}
          </>
        }
      />

      <SegmentedLinks items={tabs} active="iptt" />

      {data.total === 0 ? (
        <EmptyState
          icon={<BarChart3 size={22} />}
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            !readOnly ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDialog("new")}>
                  <Plus size={16} />
                  {t("new")}
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/indicators/logframe">{t("empty.logframe")}</Link>
                </Button>
              </div>
            ) : null
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedLinks items={years} active={data.year} />
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={filtered ? "secondary" : "outline"} size="sm" data-testid="ind-filter">
                    <ListFilter size={14} />
                    {[data.filters.status ? t(`status.${data.filters.status}`) : null, orgLabel(data.orgs, data.filters.partner)].filter(Boolean).join(" · ") || t("filters.label")}
                    <ChevronDown size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
                  <DropdownMenuLabel>{t("filters.status")}</DropdownMenuLabel>
                  <DropdownMenuItem href={href({ status: null })}>{t("filters.allStatuses")}</DropdownMenuItem>
                  {STATUS_ORDER.map((s) => (
                    <DropdownMenuItem key={s} href={href({ status: s })}>
                      {t(`status.${s}`)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t("filters.partner")}</DropdownMenuLabel>
                  <DropdownMenuItem href={href({ partner: null })}>{t("filters.allPartners")}</DropdownMenuItem>
                  {data.orgs
                    .filter((o) => o.kind === "partner")
                    .map((o) => (
                      <DropdownMenuItem key={o.id} href={href({ partner: o.id })}>
                        {o.shortName || o.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {filtered ? (
                <Link href={href({ status: null, partner: null })} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[14px] text-muted hover:bg-panel hover:text-ink">
                  <X size={14} />
                  {t("filters.clear")}
                </Link>
              ) : null}
            </div>
          </div>
          {data.rows.length ? (
            <>
              <IpttTable data={data} />
              <IpttCards data={data} />
              <p className="hidden text-[13px] text-muted md:block">{t("table.footnote")}</p>
            </>
          ) : (
            <p className="text-[14px] text-muted">{t("filters.none")}</p>
          )}
        </>
      )}

      {dialog === "new" ? (
        <IndicatorDialog open onOpenChange={(v) => !v && setDialog(null)} nodes={data.nodes} orgs={data.orgs} codes={data.codes} onSaved={(id) => router.push(`/indicators/${id}`)} />
      ) : null}
      <PeriodsDialog open={dialog === "periods"} onOpenChange={(v) => setDialog(v ? "periods" : null)} periods={data.allPeriods} locked={data.periodsLocked} readOnly={readOnly} />
      {dialog === "read" ? <ReadReportDialog open onOpenChange={(v) => !v && setDialog(null)} /> : null}
    </div>
  );
}
