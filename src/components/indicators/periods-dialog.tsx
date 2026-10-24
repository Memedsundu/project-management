"use client";

import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deletePeriodAction, rebuildQuartersAction, savePeriodAction } from "@/app/(app)/indicators/actions";
import { DateButton } from "@/components/tasks/date-menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { PeriodItem } from "./types";

const KINDS = ["quarter", "month", "half", "year", "custom"] as const;
type Kind = (typeof KINDS)[number];

/** Mirrors the server: quarters are the IPTT's columns; the rest are for reports. */
const isColumn = (p: PeriodItem, all: PeriodItem[]) => p.kind === "quarter" || all.every((q) => q.kind !== "quarter");

/**
 * "Raporlama dönemleri": the columns of the IPTT and the stretches reports
 * cover. Quarters come ready; a project whose year starts in another month
 * gets its own quarters ("Y1 Q1") while nothing is recorded yet.
 */
export function PeriodsDialog({ open, onOpenChange, periods, locked, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; periods: PeriodItem[]; locked: boolean; readOnly: boolean }) {
  const t = useTranslations("indicators.periods");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Kind>("custom");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [month, setMonth] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const valid = label.trim() && start && end && end >= start;
  const columns = periods.filter((p) => isColumn(p, periods));
  const others = periods.filter((p) => !isColumn(p, periods));
  const monthName = (m: number) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));

  function reset() {
    setEditing(null);
    setLabel("");
    setKind("custom");
    setStart(null);
    setEnd(null);
  }

  function edit(p: PeriodItem) {
    setEditing(p.id);
    setLabel(p.label);
    setKind((KINDS as readonly string[]).includes(p.kind) ? (p.kind as Kind) : "custom");
    setStart(p.startDate);
    setEnd(p.endDate);
  }

  async function save() {
    if (!valid) return;
    const res = await runAction(savePeriodAction(editing, { label: label.trim(), kind, startDate: start!, endDate: end! }));
    if (res !== undefined) reset();
  }

  async function rebuild() {
    setConfirm(false);
    const res = await runAction(rebuildQuartersAction(month));
    if (res) toast(t("rebuilt", { count: res.count }));
  }

  const row = (p: PeriodItem) => (
    <li key={p.id} className={cn("flex items-center gap-3 border-b border-line-soft py-2 last:border-0", editing === p.id && "bg-panel")} data-testid="period-row">
      <span className="w-24 shrink-0 text-[14px] font-medium">{p.label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
        {formatDay(p.startDate, locale, true)} – {formatDay(p.endDate, locale, true)} · {t(`kinds.${(KINDS as readonly string[]).includes(p.kind) ? (p.kind as Kind) : "custom"}`)}
      </span>
      {!readOnly ? (
        <span className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => edit(p)} aria-label={`${tc("edit")}: ${p.label}`}>
            <Pencil size={14} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => runAction(deletePeriodAction(p.id))} aria-label={`${tc("delete")}: ${p.label}`}>
            <Trash2 size={14} />
          </Button>
        </span>
      ) : null}
    </li>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          setConfirm(false);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent title={t("title")} description={t("description")} wide>
        <div className="flex flex-col gap-5">
          <div className="scrollbar-thin flex max-h-[40vh] flex-col gap-4 overflow-y-auto pr-1">
            <section className="flex flex-col">
              <h3 className="label-caps pb-1">{t("columns")}</h3>
              <ul className="flex flex-col">{columns.map(row)}</ul>
            </section>
            {others.length ? (
              <section className="flex flex-col">
                <h3 className="label-caps pb-1">{t("others")}</h3>
                <p className="pb-1 text-[13px] text-muted">{t("othersNote")}</p>
                <ul className="flex flex-col">{others.map(row)}</ul>
              </section>
            ) : null}
          </div>

          {!readOnly ? (
            <form
              className="flex flex-col gap-2 rounded-xl border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <p className="text-[13px] font-medium">{editing ? t("editTitle") : t("addTitle")}</p>
              <div className="grid grid-cols-[1fr_150px] gap-2">
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPlaceholder")} aria-label={t("label")} className="h-10" />
                <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label={t("kind")} className="h-10">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DateButton value={start} onChange={setStart} className="w-[150px]" />
                <span className="text-muted">–</span>
                <DateButton value={end} onChange={setEnd} className="w-[150px]" />
                <span className="ml-auto flex gap-2">
                  {editing ? (
                    <Button type="button" size="sm" variant="ghost" onClick={reset}>
                      {tc("cancel")}
                    </Button>
                  ) : null}
                  <Button type="submit" size="sm" variant="outline" disabled={!valid} data-testid="period-save">
                    {editing ? null : <Plus size={15} />}
                    {editing ? tc("save") : t("add")}
                  </Button>
                </span>
              </div>
            </form>
          ) : null}

          {!readOnly ? (
            <section className="flex flex-col gap-2 border-t border-line-soft pt-4">
              <h3 className="text-[14px] font-semibold">{t("layout")}</h3>
              <p className="text-[13px] text-muted">{locked ? t("layoutLocked") : t("layoutHint")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[14px]">
                  {t("layoutStart")}
                  <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={locked} className="h-10 w-[150px]" data-testid="period-month">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {monthName(m)}
                      </option>
                    ))}
                  </Select>
                </label>
                {confirm ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-overdue">{t("rebuildConfirm")}</span>
                    <Button size="sm" variant="secondary" onClick={rebuild} data-testid="period-rebuild-yes">
                      {t("rebuildYes")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                      {tc("cancel")}
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => setConfirm(true)} data-testid="period-rebuild">
                    <RotateCcw size={14} />
                    {t("rebuild")}
                  </Button>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
