"use client";

import { ArrowDown, ArrowUp, Download, Link2, Loader2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { chartDataAction, onePagerDataAction, proposeChartAction, proposeOnePagerAction, updateVisualAction } from "@/app/(app)/reports/actions";
import { fmtValue } from "@/components/indicators/shared";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Checkbox, Chip, Switch } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { fillWords, INDICATORS_FOR, STAT_SHOWS, TYPES_FOR, VISUAL_LANGUAGES, VISUAL_WORDS, type ChartData, type ChartSource, type ChartSpec, type ChartType, type OnePagerSpec, type VisualLanguage } from "@/lib/visuals";
import type { OnePagerData } from "@/server/services/visual-data";
import type { VisualPageData } from "@/server/views/reports";
import { downloadDataUrl, drawOnePager, loadFonts, loadImage, PAGE, pageFonts, pngName, type OnePagerModel } from "./one-pager-canvas";
import { chartLabels, ChartTable, chartPng, sourceLineOf, VisualChart, type ChartLabels } from "./visual-chart";
import { SOURCE_ICONS } from "./visual-dialogs";

type ChartPage = Extract<VisualPageData, { kind: "chart" }>;
type OnePagerPage = Extract<VisualPageData, { kind: "onepager" }>;

/** Save after she stops changing things for a moment; the screen updates at once. */
function useDebounced() {
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (fn: () => void, ms = 450) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
}

/** The chart as a PNG for Word: title, subtitle, the chart and its source line, on white. */
async function chartImage(title: string, subtitle: string, data: ChartData, L: ChartLabels, locale: string, sourceLine: string) {
  const f = pageFonts();
  await loadFonts(f);
  const W = 1600;
  const pad = 64;
  const chartH = data.horizontal ? Math.max(360, 96 + data.categories.length * 64) : 820;
  const url = await chartPng(data, L, locale, { width: W - 2 * pad, height: chartH }, f.body);
  if (!url) return null;
  const img = await loadImage(url);
  const H = pad + 60 + (subtitle ? 44 : 0) + 32 + chartH + 56 + pad;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  let y = pad + 44;
  ctx.fillStyle = "#111111";
  ctx.font = `400 48px ${f.display}`;
  ctx.fillText(title, pad, y);
  if (subtitle) {
    y += 44;
    ctx.fillStyle = "#5c5c5c";
    ctx.font = `400 26px ${f.body}`;
    ctx.fillText(subtitle, pad, y);
  }
  y += 32;
  ctx.drawImage(img, pad, y, W - 2 * pad, chartH);
  y += chartH + 48;
  ctx.fillStyle = "#5c5c5c";
  ctx.font = `400 20px ${f.body}`;
  ctx.fillText(sourceLine, pad, y);
  return canvas.toDataURL("image/png");
}

function RenameDialog({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const t = useTranslations("reports.visuals");
  const [value, setValue] = useState(title);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t("rename")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await runAction(updateVisualAction(id, { title: value.trim() }));
            if (res !== undefined) onClose();
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} autoFocus aria-label={t("name")} data-testid="visual-rename" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The language of the words drawn into the picture, which can differ from the screen's. */
function LanguageSwitch({ value, onChange }: { value: VisualLanguage; onChange: (v: VisualLanguage) => void }) {
  const t = useTranslations("reports.visuals");
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-medium" id="visual-lang-l">
        {t("language")}
      </span>
      <div className="inline-flex gap-1 self-start rounded-full bg-panel p-1" role="radiogroup" aria-labelledby="visual-lang-l">
        {VISUAL_LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={value === l}
            onClick={() => onChange(l)}
            className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-[14px]", value === l ? "bg-bg font-medium text-ink shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.08))]" : "text-muted hover:text-ink")}
            data-testid="visual-lang"
          >
            {t(`languages.${l}`)}
          </button>
        ))}
      </div>
      <span className="text-[13px] text-muted">{t("languageHint")}</span>
    </div>
  );
}

/** The editor for a chart: what it shows on the left, the live chart and its numbers on the right. */
function ChartEditor({ data, onExport }: { data: ChartPage; onExport: (fn: () => Promise<string | null>) => void }) {
  const t = useTranslations("reports.visuals");
  const locale = useLocale();
  const shell = useShell();
  const debounce = useDebounced();
  const [spec, setSpec] = useState<ChartSpec>(data.spec);
  const [chart, setChart] = useState<ChartData>(data.chart);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");
  const limits = INDICATORS_FOR[spec.source];
  const chosen = useMemo(() => spec.indicatorIds.map((id) => data.indicators.find((i) => i.id === id)).filter(Boolean) as ChartPage["indicators"], [spec.indicatorIds, data.indicators]);
  const unit = chosen[0]?.unit;
  const readOnly = shell.readOnly;
  const lang = spec.language;

  // The header's PNG button asks for the picture as it stands now.
  useEffect(() => onExport(() => chartImage(data.title, spec.subtitle, chart, chartLabels(lang), lang, sourceLineOf(chart, lang))));

  function update(patch: Partial<ChartSpec>) {
    const next = { ...spec, ...patch };
    setSpec(next);
    setLoading(true);
    debounce(async () => {
      const [res] = await Promise.all([runAction(chartDataAction(next)), readOnly ? Promise.resolve(null) : runAction(updateVisualAction(data.id, { spec: next }), { silent: true })]);
      setLoading(false);
      if (res) setChart(res);
    });
  }

  function setSource(source: ChartSource) {
    const max = INDICATORS_FOR[source].max;
    // The workplan takes no indicators; keep her choice for when she switches back.
    const indicatorIds = max ? spec.indicatorIds.slice(0, max) : spec.indicatorIds;
    update({ source, type: TYPES_FOR[source].includes(spec.type) ? spec.type : TYPES_FOR[source][0]!, indicatorIds, cumulative: source === "indicator_periods" ? spec.cumulative : false });
  }

  function toggle(id: string) {
    const has = spec.indicatorIds.includes(id);
    if (limits.max === 1) return update({ indicatorIds: [id] });
    if (has) return update({ indicatorIds: spec.indicatorIds.filter((x) => x !== id) });
    if (spec.indicatorIds.length >= limits.max) return;
    update({ indicatorIds: [...spec.indicatorIds, id] });
  }

  // An empty chart already says to pick an indicator.
  const notes = chart.notes.filter((n) => !(n === "no_indicators" && !chart.categories.length));
  const needle = q.trim().toLocaleLowerCase(locale === "en" ? "en" : "tr");
  const list = data.indicators.filter((i) => !needle || `${i.code} ${i.name}`.toLocaleLowerCase(locale === "en" ? "en" : "tr").includes(needle));
  const cumulativeOk = spec.source === "indicator_periods" && chosen.length > 0 && chosen.every((i) => i.cumulative);

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
      <fieldset className="flex flex-col gap-6" disabled={readOnly}>
        <legend className="sr-only">{t("settings")}</legend>
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-medium">{t("what")}</span>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("what")}>
            {(Object.keys(SOURCE_ICONS) as ChartSource[]).map((s) => {
              const Icon = SOURCE_ICONS[s];
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={spec.source === s}
                  onClick={() => setSource(s)}
                  className={cn("flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-left text-[14px] transition-colors", spec.source === s ? "bg-panel font-medium text-ink" : "text-ink-2 hover:bg-panel")}
                  data-testid="chart-source"
                >
                  <Icon size={16} className="shrink-0 text-muted" />
                  {t(`sources.${s}`)}
                </button>
              );
            })}
          </div>
        </div>

        {TYPES_FOR[spec.source].length > 1 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium" id="chart-type-l">
              {t("type")}
            </span>
            <div className="inline-flex gap-1 self-start rounded-full bg-panel p-1" role="radiogroup" aria-labelledby="chart-type-l">
              {TYPES_FOR[spec.source].map((ty: ChartType) => (
                <button
                  key={ty}
                  type="button"
                  role="radio"
                  aria-checked={spec.type === ty}
                  onClick={() => update({ type: ty })}
                  className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-[14px]", spec.type === ty ? "bg-bg font-medium text-ink shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.08))]" : "text-muted hover:text-ink")}
                  data-testid="chart-type"
                >
                  {t(`types.${ty}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {limits.max > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">{t("indicators")}</span>
            <span className="text-[13px] text-muted">{t(`indicatorHints.${spec.source}` as "indicatorHints.indicator_periods", { max: limits.max })}</span>
            {data.indicators.length > 8 ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filterIndicators")} aria-label={t("filterIndicators")} className="h-10" /> : null}
            {data.indicators.length ? (
              <ul className="scrollbar-thin flex max-h-[320px] flex-col overflow-y-auto rounded-2xl border border-line" data-testid="chart-indicators">
                {list.map((i) => {
                  const on = spec.indicatorIds.includes(i.id);
                  const blocked = !on && ((limits.max > 1 && spec.indicatorIds.length >= limits.max) || (spec.source === "indicator_periods" && unit !== undefined && i.unit !== unit));
                  return (
                    <li key={i.id} className="border-b border-line-soft last:border-0">
                      <label className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[14px]", blocked && "cursor-not-allowed opacity-50")}>
                        <Checkbox checked={on} disabled={blocked} onCheckedChange={() => toggle(i.id)} aria-label={`${i.code} ${i.name}`} />
                        <span className="w-12 shrink-0 text-[13px] text-muted">{i.code}</span>
                        <span className="min-w-0 flex-1 truncate" title={i.name}>
                          {i.name}
                        </span>
                        {!i.hasData ? <span className="shrink-0 text-[12px] text-faint">{t("noData")}</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">
                {t.rich("noIndicators", {
                  link: (c) => (
                    <Link href="/indicators" className="underline underline-offset-2">
                      {c}
                    </Link>
                  ),
                })}
              </p>
            )}
          </div>
        ) : null}

        {spec.source !== "workplan_status" && spec.source !== "indicator_progress" && data.periods.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium">{t("periods")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("periods")}>
              <Chip active={!spec.periodIds.length} aria-pressed={!spec.periodIds.length} onClick={() => update({ periodIds: [] })}>
                {t("allPeriods")}
              </Chip>
              {data.periods.map((p) => {
                const on = spec.periodIds.includes(p.id);
                return (
                  <Chip
                    key={p.id}
                    active={on}
                    aria-pressed={on}
                    onClick={() => {
                      const ids = on ? spec.periodIds.filter((x) => x !== p.id) : [...spec.periodIds, p.id];
                      // Keep the IPTT's order whatever order she clicks in.
                      update({ periodIds: data.periods.filter((x) => ids.includes(x.id)).map((x) => x.id) });
                    }}
                  >
                    {p.label}
                  </Chip>
                );
              })}
            </div>
          </div>
        ) : null}

        {cumulativeOk ? (
          <label className="flex items-center justify-between gap-4 text-[14px]">
            <span className="flex flex-col">
              <span className="font-medium">{t("cumulative")}</span>
              <span className="text-[13px] text-muted">{t("cumulativeHint")}</span>
            </span>
            <Switch checked={spec.cumulative} onCheckedChange={(v) => update({ cumulative: v })} />
          </label>
        ) : null}

        <Field label={t("subtitle")} htmlFor="chart-subtitle">
          <Input id="chart-subtitle" value={spec.subtitle} onChange={(e) => update({ subtitle: e.target.value })} maxLength={300} placeholder={t("subtitlePlaceholder")} />
        </Field>
        <LanguageSwitch value={lang} onChange={(v) => update({ language: v })} />

        {data.aiReady && !readOnly ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3.5">
            <label htmlFor="chart-prompt" className="flex items-center gap-2 text-[14px] font-medium">
              <Sparkles size={15} />
              {t("orDescribe")}
            </label>
            <Textarea id="chart-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} placeholder={t("describePlaceholder")} className="min-h-16 bg-bg text-[14px]" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={prompt.trim().length < 3 || asking}
              onClick={async () => {
                setAsking(true);
                const res = await runAction(proposeChartAction(prompt.trim(), lang));
                setAsking(false);
                if (res) {
                  update({ ...res.spec, language: lang });
                  setPrompt("");
                }
              }}
            >
              {asking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {asking ? t("thinking") : t("describeGo")}
            </Button>
          </div>
        ) : null}
      </fieldset>

      <div className="order-first flex min-w-0 flex-col gap-5 rounded-3xl border border-line px-5 py-5 md:px-7 md:py-6 lg:sticky lg:top-6 lg:order-none" data-testid="chart-preview">
        <div className="flex flex-col gap-1">
          <p className="font-display text-[30px] leading-tight">{data.title}</p>
          {spec.subtitle ? <p className="text-[15px] text-muted">{spec.subtitle}</p> : null}
        </div>
        {notes.length ? (
          <ul className="flex flex-col gap-1 text-[13px] text-accent-ink">
            {notes.map((n) => (
              <li key={n}>{t(`notes.${n}`)}</li>
            ))}
          </ul>
        ) : null}
        <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <VisualChart data={chart} title={data.title} lang={lang} />
        </div>
        {chart.categories.length ? (
          <section className="flex flex-col gap-1" aria-label={t("data")}>
            <h3 className="label-caps">{t("data")}</h3>
            <ChartTable data={chart} caption={data.title} lang={lang} />
          </section>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {loading ? t("updating") : ""}
        </span>
      </div>
    </div>
  );
}

/** What the canvas draws, in her words and her number formats. */
function useOnePagerModel(spec: OnePagerSpec, live: OnePagerData, projectName: string, chartImg: HTMLImageElement | null): OnePagerModel {
  const t = useTranslations("reports.onepager");
  const lang = spec.language;
  const w = VISUAL_WORDS[lang];
  const fmt = (v: number | null, unit: OnePagerData["stats"][number]["unit"]) => fmtValue(v, unit, lang);
  return {
    eyebrow: spec.footer || projectName,
    heading: spec.heading,
    subheading: spec.subheading,
    stats: live.stats.map((s) => ({
      value: fmt(s.value, s.unit),
      label: s.label,
      note:
        s.show === "percent"
          ? w.noteShare
          : s.show === "period"
            ? [s.periodLabel, s.target !== null ? fillWords(w.noteTarget, { value: fmt(s.target, s.unit) }) : null].filter(Boolean).join(" · ")
            : [w.noteToDate, s.target !== null ? fillWords(w.noteLop, { value: fmt(s.target, s.unit) }) : null].filter(Boolean).join(" · "),
    })),
    chartTitle: live.chart?.title ?? null,
    chart: chartImg,
    pointsHeading: w.pointsHeading,
    points: spec.points.filter((p) => p.trim()),
    sourceLine: fillWords(w.sourceIptt, { date: formatDay(live.asOf, lang, true) }),
    // Only on screen while the page is empty; it is not a donor-facing word.
    emptyHint: t("emptyHint"),
  };
}

/** The editor for a one-pager: its words and figures on the left, the A4 page on the right. */
function OnePagerEditor({ data, onExport }: { data: OnePagerPage; onExport: (fn: () => Promise<string | null>) => void }) {
  const t = useTranslations("reports.onepager");
  const shell = useShell();
  const debounce = useDebounced();
  const [spec, setSpec] = useState<OnePagerSpec>(data.spec);
  const [live, setLive] = useState<OnePagerData>(data.onePager);
  const [chartImg, setChartImg] = useState<HTMLImageElement | null>(null);
  const [focus, setFocus] = useState("");
  const [asking, setAsking] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readOnly = shell.readOnly;
  const model = useOnePagerModel(spec, live, data.projectName, chartImg);

  // The chart image is drawn once per chart data and language, at the one-pager's width.
  const lang = spec.language;
  useEffect(() => {
    let gone = false;
    const c = live.chart;
    (async () => {
      if (!c) return setChartImg(null);
      const f = pageFonts();
      await loadFonts(f);
      const url = await chartPng(c.data, chartLabels(lang), lang, { width: PAGE.width - 2 * PAGE.pad, height: c.data.horizontal ? Math.max(300, 80 + c.data.categories.length * 56) : 520 }, f.body);
      const img = url ? await loadImage(url) : null;
      if (!gone) setChartImg(img);
    })();
    return () => {
      gone = true;
    };
  }, [live.chart, lang]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let gone = false;
    const f = pageFonts();
    void loadFonts(f).then(() => {
      if (gone) return;
      const ctx = canvas.getContext("2d");
      if (ctx) drawOnePager(ctx, model, f);
    });
    return () => {
      gone = true;
    };
  });

  useEffect(() => onExport(async () => canvasRef.current?.toDataURL("image/png") ?? null));

  function update(patch: Partial<OnePagerSpec>, refetch = false) {
    const next = { ...spec, ...patch };
    setSpec(next);
    if (readOnly) return;
    debounce(async () => {
      const [res] = await Promise.all([refetch ? runAction(onePagerDataAction(next)) : Promise.resolve(null), runAction(updateVisualAction(data.id, { spec: next }), { silent: true })]);
      if (res) setLive(res);
    }, refetch ? 300 : 600);
  }

  const setStat = (i: number, patch: Partial<OnePagerSpec["stats"][number]>) => update({ stats: spec.stats.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, true);
  const setPoint = (i: number, v: string) => update({ points: spec.points.map((p, j) => (j === i ? v : p)) });
  const moveStat = (i: number, by: number) => {
    const next = [...spec.stats];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    update({ stats: next }, true);
  };

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[380px_minmax(0,1fr)]">
      <fieldset className="flex flex-col gap-5" disabled={readOnly}>
        <legend className="sr-only">{t("settings")}</legend>
        {data.aiReady && !readOnly ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3.5">
            <label htmlFor="op-focus" className="flex items-center gap-2 text-[14px] font-medium">
              <Sparkles size={15} />
              {t("fill")}
            </label>
            <Input id="op-focus" value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={400} placeholder={t("fillPlaceholder")} className="bg-bg" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={asking}
              onClick={async () => {
                setAsking(true);
                const res = await runAction(proposeOnePagerAction({ periodId: spec.periodId, focus: focus.trim() || null, language: lang }));
                setAsking(false);
                if (res) update({ heading: res.heading, subheading: res.subheading, stats: res.stats, points: res.points }, true);
              }}
              data-testid="op-fill"
            >
              {asking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {asking ? t("filling") : t("fillGo")}
            </Button>
            <p className="text-[12px] text-muted">{t("fillHint")}</p>
          </div>
        ) : null}
        <Field label={t("heading")} htmlFor="op-heading">
          <Input id="op-heading" value={spec.heading} onChange={(e) => update({ heading: e.target.value })} maxLength={140} data-testid="op-heading" />
        </Field>
        <Field label={t("subheading")} htmlFor="op-sub">
          <Input id="op-sub" value={spec.subheading} onChange={(e) => update({ subheading: e.target.value })} maxLength={240} />
        </Field>
        <Field label={t("period")} htmlFor="op-period" hint={t("periodHint")}>
          <Select id="op-period" value={spec.periodId ?? ""} onChange={(e) => update({ periodId: e.target.value || null }, true)}>
            <option value="">{t("noPeriod")}</option>
            {data.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-medium">{t("stats")}</span>
          <ol className="flex flex-col gap-2" data-testid="op-stats">
            {spec.stats.map((s, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-2xl border border-line px-3 py-3">
                <div className="flex items-center gap-1">
                  <Select value={s.indicatorId} onChange={(e) => setStat(i, { indicatorId: e.target.value })} aria-label={t("indicator")} className="h-10 min-w-0 flex-1">
                    {data.indicators.map((ind) => (
                      <option key={ind.id} value={ind.id}>
                        {ind.code} {ind.name}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => moveStat(i, -1)} aria-label={t("up")}>
                    <ArrowUp size={15} />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={i === spec.stats.length - 1} onClick={() => moveStat(i, 1)} aria-label={t("down")}>
                    <ArrowDown size={15} />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => update({ stats: spec.stats.filter((_, j) => j !== i) }, true)} aria-label={t("removeStat")}>
                    <X size={15} />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input value={s.label} onChange={(e) => setStat(i, { label: e.target.value })} maxLength={90} placeholder={t("labelPlaceholder")} aria-label={t("label")} className="h-10 min-w-0 flex-1" />
                  <Select value={s.show} onChange={(e) => setStat(i, { show: e.target.value as (typeof STAT_SHOWS)[number] })} aria-label={t("show")} className="h-10 w-[176px] shrink-0">
                    {STAT_SHOWS.map((x) => (
                      <option key={x} value={x} disabled={x === "period" && !spec.periodId}>
                        {t(`shows.${x}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ol>
          {spec.stats.length < 6 && data.indicators.length ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update({ stats: [...spec.stats, { indicatorId: data.indicators.find((i) => !spec.stats.some((s) => s.indicatorId === i.id))?.id ?? data.indicators[0]!.id, label: "", show: "to_date" }] }, true)} data-testid="op-add-stat">
              <Plus size={15} />
              {t("addStat")}
            </Button>
          ) : null}
        </div>

        <Field label={t("chart")} htmlFor="op-chart" hint={data.charts.length ? undefined : t("noCharts")}>
          <Select id="op-chart" value={spec.chartId ?? ""} onChange={(e) => update({ chartId: e.target.value || null }, true)} disabled={!data.charts.length}>
            <option value="">{t("noChart")}</option>
            {data.charts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-medium">{t("points")}</span>
          {spec.points.map((p, i) => (
            <div key={i} className="flex items-start gap-1">
              <Textarea value={p} onChange={(e) => setPoint(i, e.target.value)} maxLength={220} aria-label={t("point", { n: i + 1 })} className="min-h-12 flex-1 text-[14px]" />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => update({ points: spec.points.filter((_, j) => j !== i) })} aria-label={t("removePoint")}>
                <X size={15} />
              </Button>
            </div>
          ))}
          {spec.points.length < 5 ? (
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update({ points: [...spec.points, ""] })}>
              <Plus size={15} />
              {t("addPoint")}
            </Button>
          ) : null}
        </div>
        <Field label={t("footer")} htmlFor="op-footer" hint={t("footerHint")}>
          <Input id="op-footer" value={spec.footer} onChange={(e) => update({ footer: e.target.value })} maxLength={200} placeholder={data.projectName} />
        </Field>
        <LanguageSwitch value={lang} onChange={(v) => update({ language: v })} />
      </fieldset>

      <div className="order-first flex min-w-0 flex-col gap-2 lg:sticky lg:top-6 lg:order-none">
        <div className="overflow-hidden rounded-2xl border border-line shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.08))]">
          <canvas ref={canvasRef} width={PAGE.width} height={PAGE.height} className="block h-auto w-full" role="img" aria-label={`${spec.heading}. ${model.stats.map((s) => `${s.label}: ${s.value}`).join(". ")}`} data-testid="op-canvas" />
        </div>
        <p className="text-[12px] text-muted">{t("pageNote")}</p>
      </div>
    </div>
  );
}

/** Görsel: one chart or one-pager, always drawn from the live IPTT and workplan, downloadable as a PNG for Word. */
export function VisualPage({ data }: { data: VisualPageData }) {
  const t = useTranslations("reports.visuals");
  const tr = useTranslations("reports");
  const tc = useTranslations("common");
  const shell = useShell();
  const trash = useTrash();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const exporter = useRef<(() => Promise<string | null>) | null>(null);
  const setExporter = useCallback((fn: () => Promise<string | null>) => {
    exporter.current = fn;
  }, []);
  useScreenContext({ kind: "visual", id: data.id, title: data.title });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        compact
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href="/reports" className="hover:underline">
              {tr("title")}
            </Link>
            {data.reportId ? (
              <>
                <span aria-hidden>/</span>
                <Link href={`/reports/${data.reportId}`} className="hover:underline">
                  {data.reportTitle}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={data.title}
        subtitle={t(`kinds.${data.kind}`)}
        actions={
          <>
            <Button
              onClick={async () => {
                if (!exporter.current) return;
                setBusy(true);
                const url = await exporter.current();
                setBusy(false);
                if (url) await downloadDataUrl(url, pngName(data.title));
                else toast(t("nothingToExport"));
              }}
              disabled={busy}
              data-testid="visual-png"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {t("png")}
            </Button>
            {!shell.readOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("menu")} data-testid="visual-menu">
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setRenaming(true)}>
                    <Pencil size={15} />
                    {t("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Link2 size={15} />
                      {t("linkReport")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {data.reports.map((r) => (
                        <DropdownMenuItem key={r.id} onSelect={() => runAction(updateVisualAction(data.id, { reportId: r.id }), { success: t("linked", { title: r.title }) })}>
                          {r.title}
                        </DropdownMenuItem>
                      ))}
                      {data.reports.length ? null : <DropdownMenuItem disabled>{t("noReports")}</DropdownMenuItem>}
                      {data.reportId ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => runAction(updateVisualAction(data.id, { reportId: null }), { success: t("unlinked") })}>{t("unlink")}</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onSelect={() => trash("visual", data.id, { title: data.title, redirectTo: data.reportId ? `/reports/${data.reportId}` : "/reports" })}>
                    <Trash2 size={15} />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />
      {data.kind === "chart" ? (
        <ChartEditor data={data} onExport={setExporter} />
      ) : (
        <OnePagerEditor data={data} onExport={setExporter} />
      )}
      {renaming ? <RenameDialog id={data.id} title={data.title} onClose={() => setRenaming(false)} /> : null}
    </div>
  );
}
