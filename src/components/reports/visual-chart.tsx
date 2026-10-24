"use client";

import { BarChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { axisBase, reducedMotion, tipNode, useColors, useEChart, type Colors, type TipRow } from "@/components/indicators/charts";
import { fmtCompact, fmtValue } from "@/components/indicators/shared";
import { formatDay } from "@/lib/dates";
import { fillWords, LIGHT_THEME, SERIES_COLORS, VISUAL_WORDS, type ChartData, type ChartSeries, type VisualLanguage, type VisualWords } from "@/lib/visuals";

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, AriaComponent, SVGRenderer, CanvasRenderer]);

export type ChartLabels = VisualWords;

/** The words inside a chart, in the chart's own language. */
export const chartLabels = (lang: VisualLanguage): ChartLabels => VISUAL_WORDS[lang];

/** The line under a chart that says where its numbers come from. */
export const sourceLineOf = (d: ChartData, lang: VisualLanguage) => fillWords(VISUAL_WORDS[lang][d.source === "workplan_status" ? "sourceWorkplan" : "sourceIptt"], { date: formatDay(d.asOf, lang, true) });

const nameOf = (s: ChartSeries, L: ChartLabels) => (s.role === "actual" ? (s.key === "progress" ? L.progress : s.key === "count" ? L.count : L.actual) : s.role === "target" ? L.target : s.role === "other" ? (s.name || L.other) : s.name);
export const categoriesOf = (d: ChartData, L: ChartLabels) => (d.categoryKind === "status" ? d.categories.map((c) => L.statuses[c] ?? c) : d.categories);
const colorOf = (s: ChartSeries, c: Colors) => (s.role === "target" ? c.faint : (c.dark ? SERIES_COLORS.dark : SERIES_COLORS.light)[Math.min(s.slot, 3)]!);

/**
 * The ECharts option for a computed chart, in Peni's marks: thin bars with
 * 4px rounded ends, 2px lines with ringed markers, a 2px surface gap
 * between stacked segments, the target as a faint tick or dashed line, a
 * legend from two series up, and value labels only where they help.
 */
export function chartOption(d: ChartData, c: Colors, L: ChartLabels, locale: string, opts: { animate?: boolean; fontSize?: number } = {}): echarts.EChartsCoreOption | null {
  if (!d.categories.length || !d.series.length) return null;
  const fs = opts.fontSize ?? 12;
  const unit = d.unit;
  const fmt = (v: number | null) => fmtValue(v, unit, locale);
  const cats = categoriesOf(d, L);
  const series = d.series;
  // A partner chart names its partners even when only one has values; the title does not.
  const multi = series.filter((s) => s.role !== "target").length > 1 || series.some((s) => s.role === "target") || d.source === "indicator_partners";
  const stacked = d.type === "stacked";
  const base = axisBase(c);
  const axisLabel = { ...base.axisLabel, fontSize: fs };
  const valueAxis = {
    type: "value",
    max: unit === "percent" && !d.horizontal ? (v: { max: number }) => Math.max(100, Math.ceil(v.max / 10) * 10) : undefined,
    ...base,
    axisLine: { show: false },
    axisLabel: { ...axisLabel, formatter: (v: number) => fmtCompact(v, unit, locale) },
  };
  const categoryAxis = { type: "category", data: cats, ...base, splitLine: { show: false }, axisLabel: { ...axisLabel, hideOverlap: true, color: d.horizontal ? c.ink : c.muted, width: d.horizontal ? 180 : undefined, overflow: d.horizontal ? "truncate" : undefined } };
  // For stacks, only the outermost segment of each bar gets the rounded end.
  const topOf = cats.map((_, i) => {
    for (let k = series.length - 1; k >= 0; k--) if ((series[k]!.values[i] ?? 0) > 0) return k;
    return -1;
  });
  const radius = d.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  const lastIndex = (s: ChartSeries) => s.values.reduce<number>((l, v, i) => (v !== null ? i : l), -1);

  const out = series.map((s, k) => {
    const color = colorOf(s, c);
    const name = nameOf(s, L);
    if (s.role === "target") {
      return d.type === "line"
        ? { name, type: "line", data: s.values, lineStyle: { color, width: 2, type: "dashed", cap: "round" }, itemStyle: { color }, symbol: "none", z: 2 }
        : { name, type: "line", data: s.values, symbol: "rect", symbolSize: [30, 3], lineStyle: { opacity: 0 }, itemStyle: { color }, emphasis: { disabled: true }, z: 3 };
    }
    if (d.type === "line") {
      const last = lastIndex(s);
      return {
        name,
        type: "line",
        data: s.values,
        connectNulls: false,
        lineStyle: { color, width: 2, cap: "round", join: "round" },
        itemStyle: { color, borderColor: c.bg, borderWidth: 2 },
        symbol: "circle",
        symbolSize: 9,
        label: { show: series.length <= 2, position: "top", color: c.ink, fontSize: fs, fontWeight: 600, formatter: (p: { dataIndex: number; value: number | null }) => (p.dataIndex === last && p.value !== null ? fmt(p.value) : "") },
        z: 3,
      };
    }
    const single = !multi;
    const last = lastIndex(s);
    return {
      name,
      type: "bar",
      stack: stacked ? "total" : undefined,
      barMaxWidth: d.horizontal ? 22 : stacked || series.length === 1 || series.some((x) => x.role === "target") ? 28 : 18,
      barGap: "12%",
      data: s.values.map((v, i) => ({ value: v, itemStyle: { borderRadius: !stacked || topOf[i] === k ? radius : 0 } })),
      itemStyle: { color, borderColor: stacked ? c.bg : undefined, borderWidth: stacked ? 1 : 0 },
      emphasis: { itemStyle: { opacity: 0.85 } },
      label: {
        show: single,
        position: d.horizontal ? "right" : "top",
        distance: 6,
        color: c.ink,
        fontSize: fs,
        fontWeight: 600,
        formatter: (p: { dataIndex: number; value: number | null }) => (p.value === null ? "" : d.horizontal || p.dataIndex === last ? fmt(p.value) : ""),
      },
      ...(k === 0 && d.reference !== null
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { color: c.muted, width: 1, type: "solid" },
              // Over the bars, where the value axis has no labels of its own to collide with.
              label: { color: c.muted, fontSize: fs, position: d.horizontal ? "start" : "end", formatter: () => L.reference },
              data: [d.horizontal ? { xAxis: d.reference } : { yAxis: d.reference }],
            },
          }
        : {}),
      z: 2,
    };
  });

  const legend = multi
    ? {
        top: 0,
        left: 0,
        itemGap: 16,
        itemWidth: 16,
        itemHeight: 10,
        textStyle: { color: c.muted, fontSize: fs, fontFamily: c.font },
        data: series.map((s) => ({
          name: nameOf(s, L),
          icon: s.role === "target" ? (d.type === "line" ? "path://M0,4H5V6H0ZM8,4H13V6H8Z" : "path://M0,4H16V7H0Z") : d.type === "line" ? "path://M0,4H16V6H0Z" : "roundRect",
          // No ring here: a 2px surface ring would cover the thin line icon.
          itemStyle: { color: colorOf(s, c), borderWidth: 0 },
        })),
      }
    : undefined;

  return {
    animation: opts.animate !== false && !reducedMotion(),
    animationDuration: 500,
    aria: { enabled: true },
    textStyle: { fontFamily: c.font, color: c.muted },
    grid: { left: 4, right: d.horizontal ? 56 : 16, top: multi ? 40 : d.reference !== null ? 32 : 16, bottom: 4, containLabel: true },
    legend,
    tooltip: {
      trigger: "axis",
      axisPointer: d.type === "line" ? { type: "line", lineStyle: { color: c.line, width: 1 } } : { type: "shadow", shadowStyle: { color: "rgba(128,128,128,0.08)" } },
      backgroundColor: c.bg,
      borderColor: c.line,
      borderWidth: 1,
      padding: [8, 10],
      extraCssText: "border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08)",
      formatter: (params: unknown) => {
        const i = (Array.isArray(params) ? (params[0] as { dataIndex: number }) : (params as { dataIndex: number })).dataIndex;
        const rows: TipRow[] = series.map((s) => ({ key: s.role === "target" ? (d.type === "line" ? "dash" : "line") : d.type === "line" ? "line" : "bar", color: colorOf(s, c), value: fmt(s.values[i] ?? null), name: nameOf(s, L) }));
        const title = d.categoryTitles?.[i] ? `${cats[i]} · ${d.categoryTitles[i]}` : (cats[i] ?? "");
        return tipNode(c, title, multi ? rows : rows.map((r) => ({ ...r, name: "" })));
      },
    },
    xAxis: d.horizontal ? { ...valueAxis, max: unit === "percent" ? (v: { max: number }) => Math.max(100, Math.ceil(v.max / 10) * 10) : undefined } : { ...categoryAxis, boundaryGap: d.type !== "line" },
    yAxis: d.horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: out,
  };
}

const LIGHT: Colors = { ink: LIGHT_THEME.ink, muted: LIGHT_THEME.muted, faint: LIGHT_THEME.faint, line: LIGHT_THEME.line, lineSoft: LIGHT_THEME.lineSoft, bg: LIGHT_THEME.bg, font: "", dark: false };

/** Height that gives horizontal bars room for every label. */
export const chartHeight = (d: ChartData) => (d.horizontal ? Math.max(180, 40 + d.categories.length * 44) : 320);

/** The chart drawn on a white canvas at print size, for Word and for the one-pager. */
export async function chartPng(d: ChartData, L: ChartLabels, locale: string, size: { width: number; height: number }, font: string) {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${size.width}px;height:${size.height}px`;
  document.body.append(el);
  const chart = echarts.init(el, null, { renderer: "canvas", width: size.width, height: size.height, devicePixelRatio: 2 });
  try {
    const option = chartOption(d, { ...LIGHT, font }, L, locale, { animate: false, fontSize: 15 });
    if (!option) return null;
    chart.setOption(option);
    return chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: LIGHT_THEME.bg });
  } finally {
    chart.dispose();
    el.remove();
  }
}

/** The numbers under every chart as a table: the relief for light colours, screen readers and print. */
export function ChartTable({ data, caption, lang }: { data: ChartData; caption: string; lang: VisualLanguage }) {
  const L = chartLabels(lang);
  const locale = lang;
  const cats = categoriesOf(data, L);
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-[13px]" data-testid="chart-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th scope="col" className="py-2 pr-3 font-medium" />
            {data.series.map((s) => (
              <th key={s.key} scope="col" className="py-2 pr-3 text-right font-medium">
                {nameOf(s, L)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cats.map((cat, i) => (
            <tr key={`${cat}-${i}`} className="border-b border-line-soft last:border-0">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-ink-2" title={data.categoryTitles?.[i]}>
                {cat}
              </th>
              {data.series.map((s) => (
                <td key={s.key} className="py-1.5 pr-3 text-right tabular-nums">
                  {fmtValue(s.values[i] ?? null, data.unit, locale)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A chart on screen, in the current theme, with its source line; its words and numbers in the chart's language. */
export function VisualChart({ data, title, lang }: { data: ChartData; title: string; lang: VisualLanguage }) {
  const t = useTranslations("reports.chart");
  const c = useColors();
  const option = useMemo(() => (c ? chartOption(data, c, chartLabels(lang), lang) : null), [c, data, lang]);
  const ref = useEChart(option);
  if (!option) return <p className="rounded-xl bg-panel px-4 py-8 text-center text-[14px] text-muted">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} style={{ height: chartHeight(data) }} className="w-full" role="img" aria-label={title} data-testid="visual-chart" />
      <p className="text-[12px] text-muted" data-testid="chart-source-line">
        {sourceLineOf(data, lang)}
      </p>
    </div>
  );
}
