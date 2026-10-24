"use client";

import { CheckCircle2, FileSpreadsheet, Loader2, Sparkles, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { commitImportAction, parseImportAction, suggestMappingAction } from "@/app/(app)/workplan/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { foldText } from "@/lib/fold";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { IMPORT_FIELDS, rebaseSheet, rowsToActivities, type ImportField, type ImportMapping, type ImportSheet } from "@/lib/workplan-import";
import type { WorkplanData } from "./types";

type Parsed = { filename: string; baseMonth: string; sheets: { sheet: ImportSheet; mapping: ImportMapping; remembered: boolean }[] };
type Result = { created: number; updated: number; skipped: number; outputsCreated: number; unmatched: string[]; warnings: string[] };
type Source = "remembered" | "ai" | "guess";

const toMapping = (m: Record<string | number, string>): ImportMapping => Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), v as ImportField]));
const baseOf = (month: string) => ({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) });
const monthLabel = (day: string, locale: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** "Excel'den içe aktar": pick a file, check the column mapping (hers from last time, Claude's, or from the headers), see a preview, import. */
export function ImportDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (v: boolean) => void; data: WorkplanData }) {
  const t = useTranslations("workplan.import");
  const tw = useTranslations("workplan");
  const tc = useTranslations("common");
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"pick" | "reading" | "map" | "saving" | "done">("pick");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [source, setSource] = useState<Source>("guess");
  const [aiError, setAiError] = useState<string | null>(null);
  const [mapping2, setMapping2] = useState(false);
  const [baseMonth, setBaseMonth] = useState(`${data.project.startYear}-01`);
  const [createOutputs, setCreateOutputs] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [drag, setDrag] = useState(false);

  function reset() {
    setStep("pick");
    setParsed(null);
    setResult(null);
    setAiError(null);
    setSheetIdx(0);
  }

  async function read(file: File) {
    setStep("reading");
    const form = new FormData();
    form.set("file", file);
    const res = await runAction(parseImportAction(form));
    if (!res) {
      setStep("pick");
      return;
    }
    setParsed(res);
    setSheetIdx(0);
    setBaseMonth(res.ai?.baseMonth ?? res.baseMonth);
    setAiError(res.aiError);
    const first = res.sheets[0]!;
    if (first.remembered) {
      setMapping(first.mapping);
      setSource("remembered");
    } else if (res.ai) {
      setMapping(toMapping(res.ai.mapping));
      setSource("ai");
    } else {
      setMapping(first.mapping);
      setSource("guess");
    }
    setStep("map");
  }

  const current = parsed?.sheets[sheetIdx];
  const sheet = useMemo(() => (current ? rebaseSheet(current.sheet, baseOf(baseMonth)) : null), [current, baseMonth]);
  const preview = useMemo(() => (sheet ? rowsToActivities(sheet, mapping, baseOf(baseMonth)) : null), [sheet, mapping, baseMonth]);
  const periods = sheet?.columns.filter((c) => c.period) ?? [];
  const relative = periods.some((c) => c.period?.relative);
  const existing = new Set(data.activities.map((a) => foldText(a.code)));
  const matches = preview?.activities.filter((a) => existing.has(foldText(a.code))).length ?? 0;
  const undated = preview?.activities.filter((a) => !a.start && !a.end).length ?? 0;
  const hasTitle = Object.values(mapping).includes("title") || Object.values(mapping).includes("code");

  async function askClaude() {
    if (!current) return;
    setMapping2(true);
    const res = await runAction(suggestMappingAction(current.sheet));
    setMapping2(false);
    if (res) {
      setMapping(toMapping(res.mapping));
      setSource("ai");
      if (res.baseMonth) setBaseMonth(res.baseMonth);
    }
  }

  async function commit() {
    if (!sheet) return;
    setStep("saving");
    const res = await runAction(
      commitImportAction({
        sheet: current!.sheet,
        mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [String(k), v])),
        baseMonth,
        createOutputs,
        updateExisting,
      }),
    );
    if (!res) {
      setStep("map");
      return;
    }
    setResult(res);
    setStep("done");
  }

  const setField = (index: number, field: ImportField) =>
    setMapping((m) => {
      const next = { ...m };
      if (field !== "ignore") for (const [k, v] of Object.entries(next)) if (v === field) next[Number(k)] = "ignore";
      next[index] = field;
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <DialogContent title={t("title")} description={step === "pick" || step === "reading" ? t("description") : parsed?.filename} wide>
        {step === "pick" || step === "reading" ? (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) void read(f);
              }}
              disabled={step === "reading"}
              className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center transition-colors", drag ? "border-ink bg-panel" : "border-line-strong hover:border-ink")}
              data-testid="import-drop"
            >
              {step === "reading" ? <Loader2 size={28} className="animate-spin text-muted" /> : <FileSpreadsheet size={28} className="text-muted" />}
              <span className="text-[16px] font-medium">{step === "reading" ? t("reading") : t("pick")}</span>
              <span className="max-w-[48ch] text-[14px] text-muted">{t("pickHint")}</span>
            </button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              data-testid="import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void read(f);
              }}
            />
            <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
              <li>{t("tips.columns")}</li>
              <li>{t("tips.grid")}</li>
              <li>{data.aiReady ? t("tips.ai") : t("tips.noAi")}</li>
            </ul>
          </div>
        ) : null}

        {(step === "map" || step === "saving") && parsed && sheet && preview ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              {parsed.sheets.length > 1 ? (
                <Select
                  value={String(sheetIdx)}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setSheetIdx(i);
                    setMapping(parsed.sheets[i]!.mapping);
                    setSource(parsed.sheets[i]!.remembered ? "remembered" : "guess");
                  }}
                  aria-label={t("sheet")}
                  className="h-10 w-auto"
                >
                  {parsed.sheets.map((s, i) => (
                    <option key={s.sheet.name + i} value={i}>
                      {t("sheetOption", { name: s.sheet.name, count: s.sheet.rows.length })}
                    </option>
                  ))}
                </Select>
              ) : null}
              <Badge variant={source === "ai" ? "ai" : "outline"} size="sm">
                {t(`source.${source}`)}
              </Badge>
              {data.aiReady ? (
                <Button variant="ghost" size="sm" onClick={askClaude} disabled={mapping2}>
                  {mapping2 ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {source === "ai" ? t("askAgain") : t("askClaude")}
                </Button>
              ) : null}
              {aiError ? <span className="text-[13px] text-muted">{aiError}</span> : null}
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="label-caps">{t("columns")}</h3>
              <ul className="flex flex-col rounded-xl border border-line">
                {sheet.columns
                  .filter((c) => !c.period)
                  .map((c) => (
                    <li key={c.index} className="grid grid-cols-[minmax(0,1fr)_170px] items-center gap-3 border-b border-line-soft px-3 py-2 last:border-0 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_180px]">
                      <span className="truncate text-[14px] font-medium">{c.header || t("noHeader", { n: c.index + 1 })}</span>
                      <span className="hidden truncate text-[13px] text-muted md:block">{c.samples.slice(0, 2).join(" · ") || "—"}</span>
                      <Select value={mapping[c.index] ?? "ignore"} onChange={(e) => setField(c.index, e.target.value as ImportField)} aria-label={t("fieldFor", { header: c.header || String(c.index + 1) })} className="h-10 text-[14px]" data-testid="import-field">
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {t(`fields.${f}`)}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
              </ul>
              {periods.length ? (
                <p className="text-[13px] text-muted">
                  {t("periodColumns", { count: periods.length, from: monthLabel(periods[0]!.period!.from, locale), to: monthLabel(periods.at(-1)!.period!.to, locale) })}
                </p>
              ) : null}
              {relative ? (
                <label className="flex flex-wrap items-center gap-2 text-[14px]">
                  <span>{t("baseMonth")}</span>
                  <Input type="month" value={baseMonth} onChange={(e) => e.target.value && setBaseMonth(e.target.value)} className="h-10 w-[170px]" />
                </label>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="label-caps">{t("preview")}</h3>
              <p className="text-[14px]">
                {t("found", { activities: preview.activities.length, outputs: preview.outputs.length })}
                {matches ? <span className="text-muted"> · {t("matches", { count: matches })}</span> : null}
                {undated ? <span className="text-muted"> · {t("undated", { count: undated })}</span> : null}
              </p>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="px-3 py-2 font-medium">{tw("table.code")}</th>
                      <th className="px-3 py-2 font-medium">{tw("table.title")}</th>
                      <th className="px-3 py-2 font-medium">{tw("table.start")}</th>
                      <th className="px-3 py-2 font-medium">{tw("table.end")}</th>
                      <th className="px-3 py-2 font-medium">{tw("table.partners")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.activities.slice(0, 8).map((a) => (
                      <tr key={a.row} className="border-t border-line-soft">
                        <td className="px-3 py-1.5 tabular-nums">{a.code}</td>
                        <td className="max-w-[320px] truncate px-3 py-1.5">{a.title}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{a.start ? formatDay(a.start, locale, true) : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{a.end ? formatDay(a.end, locale, true) : "—"}</td>
                        <td className="max-w-[160px] truncate px-3 py-1.5">{a.partners.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.activities.length > 8 ? <p className="text-[13px] text-muted">{t("andMore", { count: preview.activities.length - 8 })}</p> : null}
            </section>

            <div className="flex flex-col gap-2 text-[14px]">
              <label className="flex items-center gap-2.5">
                <Checkbox checked={createOutputs} onCheckedChange={(v) => setCreateOutputs(v === true)} />
                {t("createOutputs")}
              </label>
              <label className="flex items-center gap-2.5">
                <Checkbox checked={updateExisting} onCheckedChange={(v) => setUpdateExisting(v === true)} />
                {t("updateExisting")}
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={step === "saving"}>
                {t("otherFile")}
              </Button>
              <Button onClick={commit} disabled={step === "saving" || !hasTitle || !preview.activities.length} data-testid="import-commit">
                {step === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {t("import", { count: preview.activities.length })}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "done" && result ? (
          <div className="flex flex-col gap-4" data-testid="import-done">
            <p className="flex items-center gap-2 text-[16px] font-medium">
              <CheckCircle2 size={20} />
              {t("doneTitle")}
            </p>
            <ul className="flex flex-col gap-1 text-[14px]">
              <li>{t("created", { count: result.created })}</li>
              {result.updated ? <li>{t("updated", { count: result.updated })}</li> : null}
              {result.skipped ? <li>{t("skipped", { count: result.skipped })}</li> : null}
              {result.outputsCreated ? <li>{t("outputsCreated", { count: result.outputsCreated })}</li> : null}
            </ul>
            {result.unmatched.length ? (
              <p className="rounded-xl bg-panel px-3.5 py-3 text-[14px]">
                {t("unmatched", { list: result.unmatched.join(", ") })}
              </p>
            ) : null}
            {result.warnings.length ? (
              <details className="text-[13px] text-muted">
                <summary className="cursor-pointer">{t("warnings", { count: result.warnings.length })}</summary>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>{tc("done")}</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
