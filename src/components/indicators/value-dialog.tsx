"use client";

import { FileText, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { addValueAction, updateValueAction } from "@/app/(app)/indicators/actions";
import { EntityPicker } from "@/components/common/entity-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldHint, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { numInput, parseNumber } from "./shared";
import type { IndicatorFields, OrgOption, PeriodItem, ValueItem } from "./types";

/** Group names she is likely to type, per dimension: the presets, then the ones she used before. */
function groupSuggestions(dim: string, values: ValueItem[], presets: Record<string, string[]>) {
  const used = values.flatMap((v) => (v.disaggregation?.[dim] ? [v.disaggregation[dim]!] : []));
  return [...new Set([...(presets[dim] ?? []), ...used])];
}

/**
 * "Değer ekle": one total for one period, from one partner, with where it
 * came from. A group (Kız, 6–11) makes it the number for that group only.
 * "Kaydet ve yenisini ekle" keeps the period, partner and source, so a
 * report's table goes in quickly.
 */
export function ValueDialog({
  open,
  onOpenChange,
  indicator,
  periods,
  orgs,
  values,
  initial,
  defaultPeriodId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  indicator: IndicatorFields;
  periods: PeriodItem[];
  orgs: OrgOption[];
  values: ValueItem[];
  initial?: ValueItem | null;
  defaultPeriodId: string | null;
}) {
  const t = useTranslations("indicators.value");
  const td = useTranslations("indicators.dimensions");
  const tg = useTranslations("indicators.groups");
  const tc = useTranslations("common");
  const locale = useLocale();
  const valueRef = useRef<HTMLInputElement>(null);
  const [periodId, setPeriodId] = useState(initial?.periodId ?? defaultPeriodId ?? periods[0]?.id ?? "");
  const [orgId, setOrgId] = useState(initial ? (initial.organisationId ?? "") : (indicator.responsibleOrgId ?? ""));
  const [value, setValue] = useState(numInput(initial?.value, locale));
  const [groups, setGroups] = useState<Record<string, string>>(initial?.disaggregation ?? {});
  const [doc, setDoc] = useState<{ id: string; title: string } | null>(initial?.sourceDocumentId ? { id: initial.sourceDocumentId, title: initial.sourceTitle ?? "—" } : null);
  const [page, setPage] = useState(initial?.sourcePage ? String(initial.sourcePage) : "");
  const [note, setNote] = useState(initial?.sourceNote ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);

  const parsed = parseNumber(value);
  const pageOk = !page.trim() || /^\d{1,6}$/.test(page.trim());
  const percentOk = indicator.unit !== "percent" || parsed === null || parsed === undefined || (parsed >= 0 && parsed <= 100);
  const valid = Boolean(periodId) && typeof parsed === "number" && pageOk && percentOk;
  const presets: Record<string, string[]> = {
    [td("sex")]: tg("sex").split("|"),
    [td("age")]: tg("age").split("|"),
  };

  async function submit(again: boolean) {
    if (!valid) return;
    setBusy(true);
    const cleanGroups = Object.fromEntries(Object.entries(groups).filter(([k, v]) => indicator.disaggregation.includes(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
    const input = {
      periodId,
      value: parsed as number,
      disaggregation: Object.keys(cleanGroups).length ? cleanGroups : null,
      organisationId: orgId || null,
      sourceDocumentId: doc?.id ?? null,
      sourcePage: doc && page.trim() ? Number(page.trim()) : null,
      sourceNote: note.trim() || null,
    };
    const res = initial ? await runAction(updateValueAction(initial.id, input), { success: t("updated") }) : await runAction(addValueAction({ indicatorId: indicator.id, ...input, status: "approved" }), { success: t("added") });
    setBusy(false);
    if (res === undefined) return;
    if (again) {
      setValue("");
      setGroups({});
      setNote("");
      setSaved((n) => n + 1);
      valueRef.current?.focus();
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? t("editTitle") : t("title")} description={`${indicator.code} ${indicator.name}`} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t("period")}>
              <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} data-testid="val-period">
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("partner")}>
              <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="val-org">
                <option value="">{t("noPartner")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName ? `${o.shortName} · ${o.name}` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={indicator.unit === "percent" ? t("valuePercent") : t("value")}>
              <Input ref={valueRef} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-invalid={parsed === undefined || !percentOk} autoFocus required data-testid="val-value" />
            </Field>
          </div>
          {parsed === undefined ? <p className="text-[13px] text-overdue">{t("numberError")}</p> : null}
          {!percentOk ? <p className="text-[13px] text-overdue">{t("percentError")}</p> : null}

          {indicator.disaggregation.length ? (
            <div className="flex flex-col gap-2">
              <div className="grid gap-3 md:grid-cols-3">
                {indicator.disaggregation.map((d) => (
                  <Field key={d} label={d}>
                    <Input value={groups[d] ?? ""} onChange={(e) => setGroups({ ...groups, [d]: e.target.value.slice(0, 40) })} placeholder={t("allGroups")} list={`groups-${d}`} data-testid="val-group" />
                    <datalist id={`groups-${d}`}>
                      {groupSuggestions(d, values, presets).map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
                  </Field>
                ))}
              </div>
              <FieldHint>{t("groupsHint")}</FieldHint>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[1fr_110px]">
            <Field label={t("source")}>
              {doc ? (
                <span className="flex h-11 items-center gap-2 rounded-xl border border-line-strong pl-3 pr-1">
                  <FileText size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px]">{doc.title}</span>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDoc(null)} aria-label={tc("remove")}>
                    <X size={14} />
                  </Button>
                </span>
              ) : (
                <EntityPicker
                  types={["document"]}
                  placeholder={t("sourcePlaceholder")}
                  onPick={(item) => setDoc({ id: item.id, title: item.title })}
                  trigger={
                    <Button type="button" variant="outline" className="w-full justify-start font-normal text-muted" data-testid="val-source">
                      <FileText size={15} />
                      {t("pickSource")}
                    </Button>
                  }
                />
              )}
            </Field>
            <Field label={t("page")}>
              <Input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" disabled={!doc} aria-invalid={!pageOk} placeholder="—" data-testid="val-page" />
            </Field>
          </div>
          <Field label={t("note")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} maxLength={1000} className="min-h-16" />
          </Field>
          <FieldHint>{t("totalsOnly")}</FieldHint>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            {saved ? (
              <span className="mr-auto text-[13px] text-muted" aria-live="polite">
                {t("savedCount", { count: saved })}
              </span>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {saved ? tc("close") : tc("cancel")}
            </Button>
            {!initial ? (
              <Button type="button" variant="outline" disabled={busy || !valid} onClick={() => void submit(true)} data-testid="val-save-again">
                {t("saveAndAdd")}
              </Button>
            ) : null}
            <Button type="submit" disabled={busy || !valid} data-testid="val-save">
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
