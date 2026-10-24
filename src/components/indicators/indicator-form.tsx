"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createIndicatorAction, updateIndicatorAction } from "@/app/(app)/indicators/actions";
import { DateButton } from "@/components/tasks/date-menu";
import { Button } from "@/components/ui/button";
import { Chip, Switch } from "@/components/ui/controls";
import { Field, FieldHint, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { nextIndicatorCode, numInput, parseNumber } from "./shared";
import type { IndicatorFields, IndicatorUnit, NodeOption, OrgOption } from "./types";

export const FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual", "endline"] as const;
const DIMENSION_PRESETS = ["sex", "age", "province", "group"] as const;

const toNum = (s: string) => parseNumber(s) ?? null;
const okNum = (s: string) => parseNumber(s) !== undefined;

/**
 * "Yeni gösterge" and "Tanımı düzenle": the fields of an indicator in the shape
 * of a PIRS (Performance Indicator Reference Sheet), essentials first.
 */
export function IndicatorDialog({
  open,
  onOpenChange,
  nodes,
  orgs,
  codes,
  initial,
  defaultNodeId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nodes: NodeOption[];
  orgs: OrgOption[];
  codes: string[];
  initial?: IndicatorFields | null;
  defaultNodeId?: string | null;
  onSaved?: (id: string) => void;
}) {
  const t = useTranslations("indicators");
  const tc = useTranslations("common");
  const locale = useLocale();
  const editing = Boolean(initial);
  const firstNode = defaultNodeId ?? nodes.find((n) => n.level === "output")?.id ?? nodes[0]?.id ?? "";
  const [nodeId, setNodeId] = useState(initial ? (initial.logframeNodeId ?? "") : firstNode);
  const suggest = (id: string) => nextIndicatorCode(codes, nodes.find((n) => n.id === id) ?? null);
  const [code, setCode] = useState(initial?.code ?? suggest(firstNode));
  const [codeTouched, setCodeTouched] = useState(editing);
  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState<IndicatorUnit>(initial?.unit ?? "number");
  const [dims, setDims] = useState<string[]>(initial?.disaggregation ?? []);
  const [dimDraft, setDimDraft] = useState("");
  const [baseline, setBaseline] = useState(numInput(initial?.baseline, locale));
  const [baselineDate, setBaselineDate] = useState<string | null>(initial?.baselineDate ?? null);
  const [lop, setLop] = useState(numInput(initial?.lopTarget, locale));
  const [cumulative, setCumulative] = useState(initial?.cumulative ?? true);
  const [direction, setDirection] = useState<"increase" | "decrease">(initial?.direction ?? "increase");
  const [orgId, setOrgId] = useState(initial?.responsibleOrgId ?? "");
  const [definition, setDefinition] = useState(initial?.definition ?? "");
  const [dataSource, setDataSource] = useState(initial?.dataSource ?? "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "quarterly");
  const [mov, setMov] = useState(initial?.meansOfVerification ?? "");
  const [more, setMore] = useState(editing);
  const [busy, setBusy] = useState(false);

  const numbersOk = okNum(baseline) && okNum(lop);
  const valid = code.trim() && name.trim() && numbersOk;

  function addDim(raw: string) {
    const d = raw.trim().slice(0, 40);
    if (!d || dims.includes(d) || dims.length >= 6) return;
    setDims([...dims, d]);
    setDimDraft("");
  }

  async function submit() {
    if (!valid) return;
    setBusy(true);
    const input = {
      code: code.trim(),
      name: name.trim(),
      logframeNodeId: nodeId || null,
      unit,
      disaggregation: dims,
      baseline: toNum(baseline),
      baselineDate,
      lopTarget: toNum(lop),
      cumulative: unit === "percent" ? false : cumulative,
      direction,
      responsibleOrgId: orgId || null,
      definition: definition.trim() || null,
      dataSource: dataSource.trim() || null,
      frequency: frequency || null,
      meansOfVerification: mov.trim() || null,
    };
    const res = initial ? await runAction(updateIndicatorAction(initial.id, input)) : await runAction(createIndicatorAction(input));
    setBusy(false);
    if (res === undefined) return;
    onOpenChange(false);
    onSaved?.(initial ? initial.id : (res as { id: string }).id);
  }

  const levelLabel = (n: NodeOption) => t(`levels.${n.level}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? t("form.editTitle") : t("form.title")} description={editing ? undefined : t("form.description")} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label={t("fields.code")}>
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeTouched(true);
                }}
                required
              />
            </Field>
            <Field label={t("fields.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("form.namePlaceholder")} required autoFocus={!editing} data-testid="ind-name" />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("fields.node")}>
              <Select
                value={nodeId}
                onChange={(e) => {
                  setNodeId(e.target.value);
                  if (!codeTouched) setCode(suggest(e.target.value));
                }}
              >
                <option value="">{t("form.noNode")}</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {levelLabel(n)} {n.code} · {n.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.responsible")}>
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">{t("form.noOrg")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName ? `${o.shortName} · ${o.name}` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t("fields.unit")}>
              <Select value={unit} onChange={(e) => setUnit(e.target.value as IndicatorUnit)}>
                {(["number", "percent", "text"] as const).map((u) => (
                  <option key={u} value={u}>
                    {t(`units.${u}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.baseline")}>
              <Input value={baseline} onChange={(e) => setBaseline(e.target.value)} inputMode="decimal" aria-invalid={!okNum(baseline)} disabled={unit === "text"} placeholder="0" />
            </Field>
            <Field label={t("fields.lop")}>
              <Input value={lop} onChange={(e) => setLop(e.target.value)} inputMode="decimal" aria-invalid={!okNum(lop)} disabled={unit === "text"} data-testid="ind-lop" />
            </Field>
          </div>
          {!numbersOk ? <p className="text-[13px] text-overdue">{t("form.numberError")}</p> : null}
          {unit === "number" ? (
            <label className="flex items-start gap-3 text-[14px]">
              <Switch checked={cumulative} onCheckedChange={setCumulative} className="mt-0.5" />
              <span className="flex flex-col">
                <span className="font-medium">{t("fields.cumulative")}</span>
                <span className="text-[13px] text-muted">{cumulative ? t("form.cumulativeOn") : t("form.cumulativeOff")}</span>
              </span>
            </label>
          ) : null}
          <Field label={t("fields.disaggregation")} hint={t("form.disaggregationHint")}>
            <div className="flex flex-wrap items-center gap-2">
              {dims.map((d) => (
                <span key={d} className="inline-flex h-9 items-center gap-1 rounded-full bg-panel-2 pl-3.5 pr-1.5 text-[14px]">
                  {d}
                  <button type="button" onClick={() => setDims(dims.filter((x) => x !== d))} className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink" aria-label={tc("remove")}>
                    <X size={14} />
                  </button>
                </span>
              ))}
              {DIMENSION_PRESETS.map((p) => t(`dimensions.${p}`))
                .filter((p) => !dims.includes(p))
                .map((p) => (
                  <Chip key={p} onClick={() => addDim(p)}>
                    <Plus size={14} />
                    {p}
                  </Chip>
                ))}
              <Input
                value={dimDraft}
                onChange={(e) => setDimDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDim(dimDraft);
                  }
                }}
                placeholder={t("form.dimensionPlaceholder")}
                aria-label={t("form.dimensionPlaceholder")}
                className="h-9 w-[170px] rounded-full text-[14px]"
              />
            </div>
          </Field>

          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-muted hover:text-ink">
            <ChevronDown size={15} className={cn("transition-transform", more && "rotate-180")} />
            {t("form.more")}
          </button>
          {more ? (
            <div className="flex flex-col gap-4">
              <Field label={t("fields.definition")}>
                <Textarea value={definition} onChange={(e) => setDefinition(e.target.value)} placeholder={t("form.definitionPlaceholder")} />
              </Field>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t("fields.baselineDate")}>
                  <DateButton value={baselineDate} onChange={setBaselineDate} className="w-full" />
                </Field>
                <Field label={t("fields.frequency")}>
                  <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {t(`frequencies.${f}`)}
                      </option>
                    ))}
                    {frequency && !(FREQUENCIES as readonly string[]).includes(frequency) ? <option value={frequency}>{frequency}</option> : null}
                  </Select>
                </Field>
                <Field label={t("fields.direction")}>
                  <Select value={direction} onChange={(e) => setDirection(e.target.value as "increase" | "decrease")}>
                    <option value="increase">{t("directions.increase")}</option>
                    <option value="decrease">{t("directions.decrease")}</option>
                  </Select>
                </Field>
              </div>
              <Field label={t("fields.dataSource")}>
                <Input value={dataSource} onChange={(e) => setDataSource(e.target.value)} placeholder={t("form.dataSourcePlaceholder")} />
              </Field>
              <Field label={t("fields.mov")}>
                <Textarea value={mov} onChange={(e) => setMov(e.target.value)} placeholder={t("form.movPlaceholder")} className="min-h-16" />
              </Field>
            </div>
          ) : null}
          <FieldHint>{t("form.totalsOnly")}</FieldHint>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !valid} data-testid="ind-save">
              {editing ? tc("save") : t("form.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
