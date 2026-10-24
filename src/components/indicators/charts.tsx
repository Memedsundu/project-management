"use client";

import { BarChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fmtCompact, fmtRatio, fmtValue, runningTotals } from "./shared";
import type { IndicatorUnit, IpttCellItem, PartnerTotal, PeriodItem } from "./types";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AriaComponent, SVGRenderer]);

/*
 * Peni charts are monochrome: the actual value is ink (the point), the target
 * is the faint grey (context), told apart by shape too (a tick or a dashed
 * line against a bar or a solid line). Checked with the dataviz validator:
 * ΔE 45 light / 38 dark under every colour-vision type, both above 3:1 on the
 * surface. Its hue-band and chroma checks do not apply to greys.
 */
type Colors = { ink: string; muted: string; faint: string; line: string; lineSoft: string; bg: string; font: string };

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  return () => mo.disconnect();
}

/** The theme's colour tokens, read again when light and dark switch. Null on the server. */
function useColors(): Colors | null {
  const key = useSyncExternalStore(
    subscribe,
    () => `c:${document.documentElement.className}`,
    () => "",
  );
  return useMemo(() => {
    if (!key) return null;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    return { ink: v("--ink"), muted: v("--muted"), faint: v("--faint"), line: v("--line"), lineSoft: v("--line-soft"), bg: v("--bg"), font: getComputedStyle(document.body).fontFamily };
  }, [key]);
}

/** A callback ref, so the chart starts whenever its box appears (an empty chart gets data later). */
function useEChart(option: echarts.EChartsCoreOption | null) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el) return;
    const c = echarts.init(el, null, { renderer: "svg" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [el]);
  useEffect(() => {
    if (option && chart.current) chart.current.setOption(option, { notMerge: true });
  }, [option, el]);
  return setEl;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type TipRow = { key: "bar" | "line" | "dash"; color: string; value: string; name: string };

/** Tooltip as DOM nodes: names come from her data, so they go in as text, never HTML. Values lead. */
function tipNode(c: Colors, title: string, rows: TipRow[], note?: string | null) {
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:150px";
  const head = document.createElement("div");
  head.textContent = title;
  head.style.cssText = `font-size:12px;color:${c.muted}`;
  root.append(head);
  for (const r of rows) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px";
    const key = document.createElement("span");
    key.style.cssText = r.key === "bar" ? `display:inline-block;width:12px;height:8px;border-radius:2px;background:${r.color}` : `display:inline-block;width:14px;height:0;border-top:2px ${r.key === "dash" ? "dashed" : "solid"} ${r.color}`;
    const value = document.createElement("strong");
    value.textContent = r.value;
    value.style.cssText = `font-weight:600;color:${c.ink};font-variant-numeric:tabular-nums`;
    const name = document.createElement("span");
    name.textContent = r.name;
    name.style.cssText = `color:${c.muted}`;
    line.append(key, value, name);
    root.append(line);
  }
  if (note) {
    const n = document.createElement("div");
    n.textContent = note;
    n.style.cssText = `font-size:12px;color:${c.muted}`;
    root.append(n);
  }
  return root;
}

const axisBase = (c: Colors) => ({
  axisLine: { lineStyle: { color: c.line } },
  axisTick: { show: false },
  axisLabel: { color: c.muted, fontSize: 12, fontFamily: c.font },
  splitLine: { lineStyle: { color: c.lineSoft, width: 1, type: "solid" as const } },
});

/**
 * "Hedef ve gerçekleşen": per period, the actual as a column and the target
 * as a tick across it; for cumulative indicators also the running totals as
 * two lines with the life-of-project target as a hairline.
 */
export function TargetActualChart({
  periods,
  cells,
  unit,
  mode,
  lopTarget,
  title,
}: {
  periods: PeriodItem[];
  cells: IpttCellItem[];
  unit: IndicatorUnit;
  mode: "period" | "cumulative";
  lopTarget: number | null;
  title: string;
}) {
  const t = useTranslations("indicators.chart");
  const locale = useLocale();
  const c = useColors();
  // Show the stretch of periods that has a target or a value.
  const { shown, labels } = useMemo(() => {
    const used = cells.map((x, i) => (x.target !== null || x.actual !== null ? i : -1)).filter((i) => i >= 0);
    const list = used.length ? cells.slice(used[0], used.at(-1)! + 1) : [];
    return { shown: list, labels: list.map((x) => periods.find((p) => p.id === x.periodId)?.label ?? "") };
  }, [cells, periods]);
  const empty = shown.length === 0;

  const option = useMemo<echarts.EChartsCoreOption | null>(() => {
    if (!c || empty) return null;
    const actual = shown.map((x) => x.actual);
    const target = shown.map((x) => x.target);
    const lastActual = actual.reduce<number>((last, v, i) => (v !== null ? i : last), -1);
    const fmt = (v: number | null) => fmtValue(v, unit, locale);
    const cumulative = mode === "cumulative";
    const runA = runningTotals(actual).map((v, i) => (i <= lastActual ? v : null));
    const runT = runningTotals(target);
    const seriesActual = cumulative ? runA : actual;
    const seriesTarget = cumulative ? runT : target;
    // The LoP line shows when it is near the data; far above it, it would flatten the lines into the floor.
    const top = Math.max(0, ...seriesActual.map((v) => v ?? 0), ...seriesTarget.map((v) => v ?? 0));
    const showLop = cumulative && lopTarget !== null && lopTarget > 0 && lopTarget <= top * 1.5;
    const yMax = unit === "percent" ? 100 : showLop ? (v: { max: number }) => Math.max(v.max, lopTarget!) : undefined;
    return {
      animation: !reducedMotion(),
      animationDuration: 500,
      aria: { enabled: true, label: { description: title } },
      textStyle: { fontFamily: c.font, color: c.muted },
      grid: { left: 4, right: showLop ? 64 : 16, top: 40, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        itemGap: 16,
        textStyle: { color: c.muted, fontSize: 12, fontFamily: c.font },
        data: cumulative
          ? [
              { name: t("actualToDate"), icon: "path://M0,4H16V6H0Z", itemStyle: { color: c.ink } },
              { name: t("targetToDate"), icon: "path://M0,4H5V6H0ZM8,4H13V6H8Z", itemStyle: { color: c.faint } },
            ]
          : [
              { name: t("actual"), icon: "roundRect", itemStyle: { color: c.ink } },
              { name: t("target"), icon: "path://M0,4H16V7H0Z", itemStyle: { color: c.faint } },
            ],
        itemWidth: 16,
        itemHeight: 10,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: cumulative ? { type: "line", lineStyle: { color: c.line, width: 1 } } : { type: "shadow", shadowStyle: { color: "rgba(128,128,128,0.08)" } },
        backgroundColor: c.bg,
        borderColor: c.line,
        borderWidth: 1,
        padding: [8, 10],
        extraCssText: "border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08)",
        formatter: (params: unknown) => {
          const i = (Array.isArray(params) ? (params[0] as { dataIndex: number }) : (params as { dataIndex: number })).dataIndex;
          const a = seriesActual[i] ?? null;
          const tg = seriesTarget[i] ?? null;
          const rows: TipRow[] = [
            { key: cumulative ? "line" : "bar", color: c.ink, value: fmt(a), name: cumulative ? t("actualToDate") : t("actual") },
            { key: cumulative ? "dash" : "line", color: c.faint, value: fmt(tg), name: cumulative ? t("targetToDate") : t("target") },
          ];
          const note = a !== null && tg ? t("ofTarget", { pct: fmtRatio(a / tg, locale) }) : shown[i]?.proposed ? t("proposed", { count: shown[i]!.proposed }) : null;
          return tipNode(c, labels[i] ?? "", rows, note);
        },
      },
      xAxis: { type: "category", data: labels, ...axisBase(c), splitLine: { show: false }, axisLabel: { ...axisBase(c).axisLabel, hideOverlap: true }, boundaryGap: !cumulative },
      yAxis: { type: "value", max: yMax, ...axisBase(c), axisLine: { show: false }, axisLabel: { ...axisBase(c).axisLabel, formatter: (v: number) => fmtCompact(v, unit, locale) } },
      series: cumulative
        ? [
            {
              name: t("actualToDate"),
              type: "line",
              data: seriesActual,
              lineStyle: { color: c.ink, width: 2, cap: "round", join: "round" },
              itemStyle: { color: c.ink, borderColor: c.bg, borderWidth: 2 },
              symbol: "circle",
              symbolSize: 9,
              label: { show: true, position: "top", color: c.ink, fontSize: 12, fontWeight: 600, formatter: (p: { dataIndex: number; value: number | null }) => (p.dataIndex === lastActual && p.value !== null ? fmt(p.value) : "") },
              z: 3,
              ...(showLop
                ? {
                    markLine: {
                      silent: true,
                      symbol: "none",
                      lineStyle: { color: c.muted, width: 1, type: "solid" },
                      label: { color: c.muted, fontSize: 12, position: "end", formatter: () => `${t("lop")}\n${fmt(lopTarget)}` },
                      data: [{ yAxis: lopTarget }],
                    },
                  }
                : {}),
            },
            {
              name: t("targetToDate"),
              type: "line",
              data: seriesTarget,
              lineStyle: { color: c.faint, width: 2, type: "dashed", cap: "round" },
              itemStyle: { color: c.faint },
              symbol: "none",
              z: 2,
            },
          ]
        : [
            {
              name: t("actual"),
              type: "bar",
              data: seriesActual,
              barMaxWidth: 24,
              itemStyle: { color: c.ink, borderRadius: [4, 4, 0, 0] },
              emphasis: { itemStyle: { opacity: 0.8 } },
              label: { show: true, position: "top", distance: 6, color: c.ink, fontSize: 12, fontWeight: 600, formatter: (p: { dataIndex: number; value: number | null }) => (p.dataIndex === lastActual && p.value !== null ? fmt(p.value) : "") },
              z: 2,
            },
            {
              name: t("target"),
              type: "line",
              data: seriesTarget,
              symbol: "rect",
              symbolSize: [30, 3],
              lineStyle: { opacity: 0 },
              itemStyle: { color: c.faint },
              emphasis: { disabled: true },
              z: 3,
            },
          ],
    };
  }, [c, empty, shown, unit, locale, mode, lopTarget, labels, title, t]);

  const ref = useEChart(option);
  if (empty) return <p className="rounded-xl bg-panel px-4 py-6 text-[14px] text-muted">{t("empty")}</p>;
  return <div ref={ref} className="h-[260px] w-full md:h-[300px]" role="img" aria-label={title} data-testid="ind-chart" />;
}

/** "Ortaklara göre": each partner's total so far, one bar each, value at the tip. */
export function PartnerChart({ items, unit, title, noneLabel }: { items: PartnerTotal[]; unit: IndicatorUnit; title: string; noneLabel: string }) {
  const locale = useLocale();
  const c = useColors();
  const sorted = useMemo(() => items.filter((i) => i.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0)), [items]);
  const names = useMemo(() => sorted.map((i) => (i.orgId ? i.orgName : noneLabel)), [sorted, noneLabel]);
  const option = useMemo<echarts.EChartsCoreOption | null>(() => {
    if (!c || !sorted.length) return null;
    return {
      animation: !reducedMotion(),
      animationDuration: 500,
      aria: { enabled: true, label: { description: title } },
      textStyle: { fontFamily: c.font, color: c.muted },
      grid: { left: 4, right: 56, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: c.bg,
        borderColor: c.line,
        borderWidth: 1,
        padding: [8, 10],
        extraCssText: "border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08)",
        formatter: (p: unknown) => {
          const { dataIndex } = p as { dataIndex: number };
          return tipNode(c, names[dataIndex] ?? "", [{ key: "bar", color: c.ink, value: fmtValue(sorted[dataIndex]!.total, unit, locale), name: "" }]);
        },
      },
      xAxis: { type: "value", max: unit === "percent" ? 100 : undefined, ...axisBase(c), axisLine: { show: false }, axisLabel: { ...axisBase(c).axisLabel, formatter: (v: number) => fmtCompact(v, unit, locale) } },
      yAxis: { type: "category", inverse: true, data: names, ...axisBase(c), splitLine: { show: false }, axisLabel: { ...axisBase(c).axisLabel, color: c.ink, fontSize: 13, width: 140, overflow: "truncate" } },
      series: [
        {
          type: "bar",
          data: sorted.map((i) => i.total),
          barMaxWidth: 24,
          itemStyle: { color: c.ink, borderRadius: [0, 4, 4, 0] },
          emphasis: { itemStyle: { opacity: 0.8 } },
          label: { show: true, position: "right", distance: 8, color: c.ink, fontSize: 12, fontWeight: 600, formatter: (p: { value: number }) => fmtValue(p.value, unit, locale) },
        },
      ],
    };
  }, [c, sorted, names, unit, locale, title]);
  const ref = useEChart(option);
  if (!sorted.length) return null;
  return (
    <>
      <div ref={ref} style={{ height: 24 + sorted.length * 44 }} className="w-full" role="img" aria-label={title} data-testid="ind-partner-chart" />
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {sorted.map((i, n) => (
            <tr key={i.orgId ?? "none"}>
              <th scope="row">{names[n]}</th>
              <td>{fmtValue(i.total, unit, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
