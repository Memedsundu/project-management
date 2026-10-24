"use client";

import { Check, ChevronDown, Copy, Download, FileText, Loader2, MoreHorizontal, Network, NotebookPen, Pencil, Plus, Sparkles, Split, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { approveValuesAction, deleteValueAction, explainShortfallAction, restoreValueAction, saveExplanationAction, setTargetsAction } from "@/app/(app)/indicators/actions";
import { LinksPanel } from "@/components/common/links-panel";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { PartnerChart, TargetActualChart } from "./charts";
import { FREQUENCIES, IndicatorDialog } from "./indicator-form";
import { Meter, StatusPill } from "./indicators-screen";
import { fmtRatio, fmtValue, numInput, orgLabel, parseNumber, runningTotals, spreadTargets } from "./shared";
import type { IndicatorPageData, IpttCellItem, PeriodItem, ValueItem } from "./types";
import { ValueDialog } from "./value-dialog";

/** One target box: saved when she leaves it, in either number convention. */
function TargetInput({ indicatorId, periodId, value, label, readOnly }: { indicatorId: string; periodId: string; value: number | null; label: string; readOnly: boolean }) {
  const locale = useLocale();
  const [text, setText] = useState(numInput(value, locale));
  const parsed = parseNumber(text);
  if (readOnly) return <span className="tabular-nums">{numInput(value, locale) || "—"}</span>;
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        if (parsed === undefined || (parsed ?? null) === value) return;
        await runAction(setTargetsAction(indicatorId, [{ periodId, value: parsed }]));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      inputMode="decimal"
      aria-label={label}
      aria-invalid={parsed === undefined}
      placeholder="—"
      className="h-9 w-[96px] rounded-lg px-2 text-right tabular-nums"
      data-testid="target-input"
    />
  );
}

/** The project year a period belongs to: "Y2" for project quarters, else the calendar year. */
const yearOf = (p: PeriodItem) => /^(Y\d+)\b/.exec(p.label)?.[1] ?? p.startDate.slice(0, 4);

/** The chart's table twin: every period with its target (editable), actual and progress. Years with nothing in them fold away. */
function PeriodTable({ data, readOnly }: { data: IndicatorPageData; readOnly: boolean }) {
  const t = useTranslations("indicators.page");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { indicator, row, periods } = data;
  const [all, setAll] = useState(false);
  const cells = new Map(row.cells.map((c) => [c.periodId, c]));
  const running = runningTotals(periods.map((p) => cells.get(p.id)?.actual ?? null));
  const lastReported = periods.reduce((last, p, i) => ((cells.get(p.id)?.actual ?? null) !== null ? i : last), -1);
  const fmt = (v: number | null) => fmtValue(v, indicator.unit, locale);
  const busyYears = new Set(
    periods
      .filter((p) => {
        const c = cells.get(p.id);
        return (c && (c.target !== null || c.actual !== null || c.proposed > 0)) || (p.startDate <= data.today && p.endDate >= data.today);
      })
      .map(yearOf),
  );
  const folded = busyYears.size > 0 && periods.some((p) => !busyYears.has(yearOf(p)));
  const shown = all || !folded ? periods : periods.filter((p) => busyYears.has(yearOf(p)));

  async function spread() {
    if (indicator.lopTarget === null) return;
    const before = periods.map((p) => ({
      periodId: p.id,
      value: cells.get(p.id)?.target ?? null,
    }));
    const next = spreadTargets(periods.length, indicator.lopTarget, indicator.baseline, indicator.cumulative, indicator.unit);
    const res = await runAction(
      setTargetsAction(
        indicator.id,
        periods.map((p, i) => ({ periodId: p.id, value: next[i] ?? null })),
      ),
    );
    if (res === undefined) return;
    setAll(true);
    toast(t("spreadDone", { count: periods.length }), {
      duration: 8000,
      action: {
        label: tc("undo"),
        onClick: () => void runAction(setTargetsAction(indicator.id, before)),
      },
    });
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="i-periods">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="i-periods" className="label-caps">
          {t("periods")}
        </h2>
        {!readOnly && indicator.lopTarget !== null && indicator.unit !== "text" ? (
          <Button variant="ghost" size="sm" onClick={spread} data-testid="spread-targets">
            <Split size={14} />
            {t("spread")}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full border-collapse text-[14px]" data-testid="period-table">
          <thead>
            <tr className="text-left">
              <th className="label-caps border-b border-line px-3 py-2 font-medium text-muted">{t("period")}</th>
              <th className="label-caps border-b border-line px-3 py-2 text-right font-medium text-muted">{t("target")}</th>
              <th className="label-caps border-b border-line px-3 py-2 text-right font-medium text-muted">{t("actual")}</th>
              <th className="label-caps border-b border-line px-3 py-2 text-right font-medium text-muted">{t("achieved")}</th>
              {indicator.cumulative ? <th className="label-caps border-b border-line px-3 py-2 text-right font-medium text-muted">{t("running")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const i = periods.indexOf(p);
              const c: IpttCellItem | undefined = cells.get(p.id);
              const short = c?.ended && c.target !== null && c.percent !== null && c.percent < 0.9;
              const current = p.startDate <= data.today && p.endDate >= data.today;
              return (
                <tr key={p.id} className="border-b border-line-soft last:border-0" data-testid="period-line">
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="font-medium">{p.label}</span>
                    {current ? <span className="ml-2 text-[12px] text-muted">{t("now")}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex justify-end">
                      <TargetInput key={`${p.id}:${c?.target ?? ""}`} indicatorId={indicator.id} periodId={p.id} value={c?.target ?? null} label={`${t("target")} ${p.label}`} readOnly={readOnly} />
                    </span>
                  </td>
                  <td className={cn("px-3 py-1.5 text-right font-semibold tabular-nums", short && "text-accent-ink")}>
                    {fmt(c?.actual ?? null)}
                    {c?.proposed ? <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent-ink">+{c.proposed}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">{c?.percent !== null && c?.percent !== undefined ? fmtRatio(c.percent, locale) : "—"}</td>
                  {indicator.cumulative ? <td className="px-3 py-1.5 text-right tabular-nums text-muted">{i <= lastReported ? fmt(running[i] ?? null) : "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {folded ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="periods-all">
          <ChevronDown size={14} className={cn("transition-transform", all && "rotate-180")} />
          {all ? t("showFewer") : t("showAll", { count: periods.length })}
        </Button>
      ) : null}
    </section>
  );
}

/** "Neden geride?": Claude's draft, editable, kept only when she saves it as a note. */
function ExplainCard({ id, code, text, busy, onRegenerate, onClose }: { id: string; code: string; text: string; busy: boolean; onRegenerate: () => void; onClose: () => void }) {
  const t = useTranslations("indicators.explain");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const res = await runAction(
      saveExplanationAction(
        id,
        t("noteTitle", {
          code,
          date: formatDay(new Date().toISOString().slice(0, 10), locale, true),
        }),
        draft,
      ),
    );
    setSaving(false);
    if (!res) return;
    toast(t("saved"), {
      action: {
        label: t("openNote"),
        onClick: () => router.push(`/notes/${res.id}`),
      },
    });
    onClose();
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel px-5 py-4" aria-labelledby="i-explain" data-testid="explain-card">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent-ink" />
        <h2 id="i-explain" className="text-[15px] font-semibold">
          {t("title")}
        </h2>
        <Badge variant="ai" size="sm">
          {tc("aiBadge")}
        </Badge>
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={tc("copy")}
            onClick={async () => {
              await navigator.clipboard.writeText(draft);
              toast(tc("copied"));
            }}
          >
            <Copy size={15} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("regenerate")} disabled={busy} onClick={onRegenerate}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("close")} onClick={onClose}>
            <X size={15} />
          </Button>
        </span>
      </div>
      <Textarea key={text} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-40 bg-bg text-[15px] leading-relaxed" aria-label={t("title")} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{t("footnote")}</p>
        <Button size="sm" variant="secondary" onClick={save} disabled={saving || !draft.trim()} data-testid="explain-save">
          <NotebookPen size={14} />
          {t("saveAsNote")}
        </Button>
      </div>
    </section>
  );
}

function ValueRow({ v, unit, readOnly, onEdit }: { v: ValueItem; unit: IndicatorPageData["indicator"]["unit"]; readOnly: boolean; onEdit: () => void }) {
  const t = useTranslations("indicators.values");
  const tc = useTranslations("common");
  const locale = useLocale();
  async function remove() {
    const res = await runAction(deleteValueAction(v.id));
    if (!res) return;
    toast(t("deleted"), {
      duration: 6000,
      action: {
        label: tc("undo"),
        onClick: () => void runAction(restoreValueAction(res.value)),
      },
    });
  }
  const groups = v.disaggregation ? Object.entries(v.disaggregation) : [];
  return (
    <li className="flex items-start gap-3 border-b border-line-soft py-3 last:border-0" data-testid="value-row" data-status={v.status}>
      <span className="w-[72px] shrink-0 pt-0.5 text-[13px] font-medium tabular-nums text-muted">{v.periodLabel}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[16px] font-semibold tabular-nums">{fmtValue(v.value, unit, locale)}</span>
          {groups.length ? (
            groups.map(([k, g]) => (
              <span key={k} className="rounded-full bg-panel-2 px-2 py-0.5 text-[12px] text-ink-2" title={k}>
                {g}
              </span>
            ))
          ) : (
            <span className="text-[12px] text-muted">{t("total")}</span>
          )}
          {v.orgName ? <span className="text-[13px] text-muted">· {v.orgName}</span> : null}
          {v.status === "proposed" ? (
            <Badge variant="ai" size="sm">
              {t("proposed")}
            </Badge>
          ) : null}
        </span>
        {v.sourceDocumentId ? (
          <Link
            href={`/files/d/${v.sourceDocumentId}${v.sourcePage ? `?page=${v.sourcePage}` : ""}`}
            className="inline-flex min-w-0 items-center gap-1.5 self-start text-[13px] text-ink-2 hover:underline"
            data-testid="value-source"
          >
            <FileText size={13} className="shrink-0 text-muted" />
            <span className="truncate">{v.sourceTitle ?? t("source")}</span>
            {v.sourcePage ? <span className="shrink-0 text-muted">{t("page", { page: v.sourcePage })}</span> : null}
          </Link>
        ) : (
          <span className="text-[13px] text-faint">{t("noSource")}</span>
        )}
        {v.sourceNote ? <span className="line-clamp-2 text-[13px] text-muted">“{v.sourceNote}”</span> : null}
      </span>
      {!readOnly ? (
        <span className="flex shrink-0 items-center gap-1">
          {v.status === "proposed" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                runAction(approveValuesAction([v.id]), {
                  success: t("approvedOne"),
                })
              }
              data-testid="value-approve"
            >
              <Check size={14} />
              {t("approve")}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("menu")}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil size={15} />
                {tc("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem danger onSelect={remove}>
                <Trash2 size={15} />
                {tc("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
    </li>
  );
}

/** The PIRS facts (Performance Indicator Reference Sheet) she checks before reporting. */
function Definition({ data, onEdit, readOnly }: { data: IndicatorPageData; onEdit: () => void; readOnly: boolean }) {
  const t = useTranslations("indicators");
  const locale = useLocale();
  const i = data.indicator;
  const freq = i.frequency && (FREQUENCIES as readonly string[]).includes(i.frequency) ? t(`frequencies.${i.frequency as (typeof FREQUENCIES)[number]}`) : i.frequency;
  const items: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "node",
      label: t("fields.node"),
      value: i.logframeNodeId ? (
        <Link href={`/indicators/logframe#n-${i.logframeNodeId}`} className="hover:underline">
          {i.nodeCode} · {i.nodeTitle}
        </Link>
      ) : null,
    },
    {
      key: "definition",
      label: t("fields.definition"),
      value: i.definition ? <span className="whitespace-pre-line">{i.definition}</span> : null,
    },
    {
      key: "unit",
      label: t("fields.unit"),
      value: `${t(`units.${i.unit}`)} · ${i.unit === "number" ? (i.cumulative ? t("page.cumulative") : t("page.latest")) : t("page.latest")}`,
    },
    {
      key: "dis",
      label: t("fields.disaggregation"),
      value: i.disaggregation.length ? i.disaggregation.join(", ") : null,
    },
    {
      key: "baseline",
      label: t("fields.baseline"),
      value: i.baseline !== null ? `${fmtValue(i.baseline, i.unit, locale)}${i.baselineDate ? ` (${formatDay(i.baselineDate, locale, true)})` : ""}` : null,
    },
    {
      key: "lop",
      label: t("fields.lop"),
      value: i.lopTarget !== null ? fmtValue(i.lopTarget, i.unit, locale) : null,
    },
    {
      key: "direction",
      label: t("fields.direction"),
      value: t(`directions.${i.direction}`),
    },
    {
      key: "org",
      label: t("fields.responsible"),
      value: orgLabel(data.orgs, i.responsibleOrgId),
    },
    { key: "source", label: t("fields.dataSource"), value: i.dataSource },
    { key: "freq", label: t("fields.frequency"), value: freq },
    {
      key: "mov",
      label: t("fields.mov"),
      value: i.meansOfVerification ? <span className="whitespace-pre-line">{i.meansOfVerification}</span> : null,
    },
  ];
  return (
    <section className="flex flex-col gap-2" aria-labelledby="i-def" data-testid="definition">
      <div className="flex items-center justify-between gap-2">
        <h2 id="i-def" className="label-caps">
          {t("page.definition")}
        </h2>
        {!readOnly ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil size={14} />
            {t("page.editDefinition")}
          </Button>
        ) : null}
      </div>
      <dl className="flex flex-col gap-3">
        {items.map((it) => (
          <div key={it.key} className="flex flex-col gap-0.5">
            <dt className="text-[12px] font-medium uppercase tracking-wide text-muted">{it.label}</dt>
            <dd className="text-[14px]">{it.value ?? <span className="text-faint">{t("page.notSet")}</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One indicator (ActivityInfo and the IPTT): progress, the chart and its table, every value with its source, the definition. */
export function IndicatorPage({ data, history }: { data: IndicatorPageData; history: React.ReactNode }) {
  const t = useTranslations("indicators");
  const tp = useTranslations("indicators.page");
  const locale = useLocale();
  const shell = useShell();
  const trash = useTrash();
  const { indicator: ind, row } = data;
  const readOnly = shell.readOnly;
  const [mode, setMode] = useState<"period" | "cumulative">(ind.cumulative && ind.unit === "number" ? "cumulative" : "period");
  const [editOpen, setEditOpen] = useState(false);
  const [valueDialog, setValueDialog] = useState<{
    open: boolean;
    initial: ValueItem | null;
  }>({ open: false, initial: null });
  const [explain, setExplain] = useState<string | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const fmt = (v: number | null) => fmtValue(v, ind.unit, locale);
  const proposed = data.values.filter((v) => v.status === "proposed");
  const lastEnded = [...data.periods].reverse().find((p) => p.endDate < data.today);
  useScreenContext({
    kind: "indicator",
    id: ind.id,
    title: `${ind.code} ${ind.name}`,
    detail: `to date ${row.toDateActual ?? "-"} of ${row.toDateTarget ?? "-"} (${row.status.replace("_", " ")}), LoP target ${ind.lopTarget ?? "-"}`,
  });

  async function runExplain() {
    setExplainBusy(true);
    const res = await runAction(explainShortfallAction(ind.id));
    setExplainBusy(false);
    if (res) setExplain(res.text);
  }

  const values = [...data.values].sort((a, b) => {
    const pa = data.periods.findIndex((p) => p.id === a.periodId);
    const pb = data.periods.findIndex((p) => p.id === b.periodId);
    return pb - pa || b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeader
          compact
          eyebrow={
            <nav className="flex flex-wrap items-center gap-1" aria-label={tp("breadcrumb")}>
              <Link href="/indicators" className="hover:text-ink">
                {t("title")}
              </Link>
              {ind.nodeCode ? (
                <>
                  <span aria-hidden>/</span>
                  <Link href={`/indicators/logframe#n-${ind.logframeNodeId}`} className="hover:text-ink">
                    {ind.nodeCode} {ind.nodeTitle}
                  </Link>
                </>
              ) : null}
            </nav>
          }
          title={
            <span className="break-words">
              <span className="text-muted">{ind.code}</span> {ind.name}
            </span>
          }
          subtitle={[t(`units.${ind.unit}`), ind.unit === "number" ? (ind.cumulative ? tp("cumulative") : tp("latest")) : null, orgLabel(data.orgs, ind.responsibleOrgId)].filter(Boolean).join(" · ")}
          actions={
            <>
              {!readOnly && ind.unit !== "text" ? (
                <Button onClick={() => setValueDialog({ open: true, initial: null })} data-testid="ind-add-value">
                  <Plus size={16} />
                  {tp("addValue")}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={tp("menu")}>
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[230px]" align="end">
                  {!readOnly ? (
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil size={15} />
                      {tp("editDefinition")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem href="/indicators/logframe">
                    <Network size={15} />
                    {tp("openLogframe")}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href="/api/indicators/export" download>
                      <Download size={15} />
                      {t("export")}
                    </a>
                  </DropdownMenuItem>
                  {!readOnly ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        danger
                        onSelect={() =>
                          trash("indicator", ind.id, {
                            title: `${ind.code} ${ind.name}`,
                            redirectTo: "/indicators",
                          })
                        }
                      >
                        <Trash2 size={15} />
                        {tp("delete")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={row.status} />
          <span className="text-[14px] text-muted">
            {tp(`statusLine.${row.status}`, {
              pct: fmtRatio(row.percentToDate, locale),
            })}
          </span>
          {data.aiReady && row.status === "behind" ? (
            <Button variant="outline" size="sm" onClick={runExplain} disabled={explainBusy} data-testid="explain-button">
              {explainBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {tp("explain")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="ind-stats">
        <div className="col-span-2 flex flex-col sm:col-span-1 [&>*]:flex-1">
          <StatCard
            label={tp("toDate")}
            value={<span className={cn("tabular-nums", row.status === "behind" && "text-accent-ink")}>{fmt(row.toDateActual)}</span>}
            note={
              <span className="flex flex-col gap-1.5">
                <span>
                  {row.toDateTarget !== null
                    ? tp("ofTarget", {
                        target: fmt(row.toDateTarget),
                        pct: fmtRatio(row.percentToDate, locale),
                      })
                    : tp("noTargetYet")}
                </span>
                <Meter ratio={row.percentToDate} behind={row.status === "behind"} label={fmtRatio(row.percentToDate, locale)} />
              </span>
            }
          />
        </div>
        <StatCard
          label={tp("lop")}
          value={<span className="tabular-nums">{fmt(ind.lopTarget)}</span>}
          note={row.percentOfLop !== null ? tp("ofLop", { pct: fmtRatio(row.percentOfLop, locale) }) : tp("lopHint")}
        />
        <StatCard
          label={tp("baseline")}
          value={<span className="tabular-nums">{fmt(ind.baseline)}</span>}
          note={proposed.length ? <a href="#i-values">{tp("waiting", { count: proposed.length })}</a> : ind.baselineDate ? formatDay(ind.baselineDate, locale, true) : tp("baselineHint")}
          noteTone={proposed.length ? "overdue" : "muted"}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {explain ? <ExplainCard id={ind.id} code={ind.code} text={explain} busy={explainBusy} onRegenerate={runExplain} onClose={() => setExplain(null)} /> : null}

          {ind.unit !== "text" ? (
            <section className="flex flex-col gap-3" aria-labelledby="i-chart">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="i-chart" className="label-caps">
                  {tp("chart")}
                </h2>
                {ind.cumulative && ind.unit === "number" ? (
                  <div className="flex items-center gap-1" role="group" aria-label={tp("chartMode")}>
                    {(["cumulative", "period"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={mode === m}
                        onClick={() => setMode(m)}
                        className={cn(
                          "inline-flex h-9 items-center rounded-full px-3.5 text-[14px] transition-colors",
                          mode === m ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink",
                        )}
                      >
                        {tp(`modes.${m}`)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <TargetActualChart periods={data.periods} cells={row.cells} unit={ind.unit} mode={mode} lopTarget={ind.lopTarget} title={`${ind.code} ${ind.name}`} />
            </section>
          ) : null}

          <PeriodTable data={data} readOnly={readOnly} />

          {data.byPartner.some((p) => p.total !== null) ? (
            <section className="flex flex-col gap-3" aria-labelledby="i-partners">
              <h2 id="i-partners" className="label-caps">
                {tp("byPartner")}
              </h2>
              <PartnerChart items={data.byPartner} unit={ind.unit} title={tp("byPartner")} noneLabel={tp("noPartner")} />
            </section>
          ) : null}

          <section className="flex scroll-mt-24 flex-col gap-2" aria-labelledby="i-values-h" id="i-values">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="i-values-h" className="label-caps">
                {tp("values")} <span className="text-faint">{data.values.length || ""}</span>
              </h2>
              {!readOnly && proposed.length > 1 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    runAction(approveValuesAction(proposed.map((v) => v.id)), {
                      success: t("values.approvedMany", {
                        count: proposed.length,
                      }),
                    })
                  }
                >
                  <Check size={14} />
                  {t("values.approveAll", { count: proposed.length })}
                </Button>
              ) : null}
            </div>
            {values.length ? (
              <ul className="flex flex-col" data-testid="values">
                {values.map((v) => (
                  <ValueRow key={v.id} v={v} unit={ind.unit} readOnly={readOnly} onEdit={() => setValueDialog({ open: true, initial: v })} />
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">{data.aiReady ? tp("noValuesAi") : tp("noValues")}</p>
            )}
          </section>

          {history}
        </div>

        <aside className="flex flex-col gap-7">
          <Definition data={data} onEdit={() => setEditOpen(true)} readOnly={readOnly} />
          <LinksPanel self={{ type: "indicator", id: ind.id }} items={data.links} readOnly={readOnly} />
        </aside>
      </div>

      {editOpen ? <IndicatorDialog open onOpenChange={(v) => !v && setEditOpen(false)} nodes={data.nodes} orgs={data.orgs} codes={[]} initial={ind} /> : null}
      {valueDialog.open ? (
        <ValueDialog
          key={valueDialog.initial?.id ?? "new"}
          open
          onOpenChange={(v) => !v && setValueDialog({ open: false, initial: null })}
          indicator={ind}
          periods={data.periods}
          orgs={data.orgs}
          values={data.values}
          initial={valueDialog.initial}
          defaultPeriodId={lastEnded?.id ?? data.periods[0]?.id ?? null}
        />
      ) : null}
    </div>
  );
}
