"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { addSeasonPresetAction, deleteHolidayAction, deleteSeasonAction, saveHolidayAction, saveSeasonAction } from "@/app/(app)/workplan/actions";
import { DateButton } from "@/components/tasks/date-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { PROVINCES } from "@/lib/provinces";
import { MultiPick } from "./pickers";
import type { SeasonItem, WorkplanData } from "./types";

const PRESETS = [
  { name: "Fındık hasadı", months: "8–9" },
  { name: "Pamuk hasadı", months: "9–11" },
  { name: "Kayısı hasadı", months: "6–7" },
  { name: "Şeker pancarı", months: "9–11" },
  { name: "Narenciye", months: "10–3" },
  { name: "Çay hasadı", months: "5–10" },
];

function monthName(m: number, locale: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "short" }).format(new Date(2026, m - 1, 1));
}

function SeasonForm({ season, onDone }: { season: SeasonItem | null; onDone: () => void }) {
  const t = useTranslations("workplan.seasonsDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [name, setName] = useState(season?.name ?? "");
  const [crop, setCrop] = useState(season?.crop ?? "");
  const [provinces, setProvinces] = useState<string[]>(season?.provinces ?? []);
  const [sm, setSm] = useState(season?.startMonth ?? 8);
  const [sd, setSd] = useState(season?.startDay ?? 1);
  const [em, setEm] = useState(season?.endMonth ?? 9);
  const [ed, setEd] = useState(season?.endDay ?? 30);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  async function save() {
    if (!name.trim()) return;
    const res = await runAction(saveSeasonAction(season?.id ?? null, { name: name.trim(), crop: crop.trim() || null, provinces, startMonth: sm, startDay: sd, endMonth: em, endDay: ed, active: season?.active ?? true }));
    if (res) onDone();
  }
  const pick = (value: number, set: (n: number) => void, list: number[], label: string, fmt?: (n: number) => string) => (
    <Select value={String(value)} onChange={(e) => set(Number(e.target.value))} aria-label={label} className="h-10">
      {list.map((n) => (
        <option key={n} value={n}>
          {fmt ? fmt(n) : n}
        </option>
      ))}
    </Select>
  );
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} required autoFocus />
        </Field>
        <Field label={t("crop")}>
          <Input value={crop} onChange={(e) => setCrop(e.target.value)} placeholder={t("cropPlaceholder")} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("from")}>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            {pick(sd, setSd, days, t("fromDay"))}
            {pick(sm, setSm, months, t("from"), (n) => monthName(n, locale))}
          </div>
        </Field>
        <Field label={t("to")}>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            {pick(ed, setEd, days, t("toDay"))}
            {pick(em, setEm, months, t("to"), (n) => monthName(n, locale))}
          </div>
        </Field>
      </div>
      <Field label={t("provinces")}>
        <MultiPick label={t("provinces")} searchable options={PROVINCES.map((p) => ({ id: p, label: p }))} value={provinces} placeholder={t("allProvinces")} onToggle={(id, on) => setProvinces((v) => (on ? [...v, id] : v.filter((x) => x !== id)))} className="w-full" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}

/** "Mevsimler": the harvest bands behind the timeline, with ready-made ones for the main crops. */
export function SeasonsDialog({ open, onOpenChange, data, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; data: WorkplanData; readOnly: boolean }) {
  const t = useTranslations("workplan.seasonsDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const names = new Set(data.seasons.map((s) => s.name));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} wide>
        <div className="flex flex-col gap-5">
          {data.seasons.length === 0 && editing !== "new" ? <p className="text-[14px] text-muted">{t("empty")}</p> : null}
          <ul className="flex flex-col gap-2">
            {data.seasons.map((s) =>
              editing === s.id ? (
                <li key={s.id}>
                  <SeasonForm season={s} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5" data-testid="season-row">
                  <Switch checked={s.active} disabled={readOnly} onCheckedChange={(v) => runAction(saveSeasonAction(s.id, { ...s, active: v }))} aria-label={t("show", { name: s.name })} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{s.name}</span>
                    <span className="truncate text-[13px] text-muted">
                      {s.startDay} {monthName(s.startMonth, locale)} – {s.endDay} {monthName(s.endMonth, locale)}
                      {s.provinces.length ? ` · ${s.provinces.join(", ")}` : ""}
                    </span>
                  </span>
                  {!readOnly ? (
                    <>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(s.id)} aria-label={tc("edit")}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => runAction(deleteSeasonAction(s.id))} aria-label={tc("delete")}>
                        <Trash2 size={15} />
                      </Button>
                    </>
                  ) : null}
                </li>
              ),
            )}
          </ul>
          {!readOnly ? (
            editing === "new" ? (
              <SeasonForm season={null} onDone={() => setEditing(null)} />
            ) : (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing("new")}>
                <Plus size={15} />
                {t("add")}
              </Button>
            )
          ) : null}
          {!readOnly ? (
            <section className="flex flex-col gap-2">
              <h3 className="label-caps">{t("presets")}</h3>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p, i) => (
                  <Button key={p.name} variant="outline" size="sm" disabled={names.has(p.name)} onClick={() => runAction(addSeasonPresetAction(i))} data-testid="season-preset">
                    <Plus size={14} />
                    {p.name}
                    <span className="text-[12px] text-muted">{p.months.split("–").map((m) => monthName(Number(m), locale)).join("–")}</span>
                  </Button>
                ))}
              </div>
              <p className="text-[13px] text-muted">{t("presetsHint")}</p>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Tatiller": public and religious holidays, which move field work and skip working days. */
export function HolidaysDialog({ open, onOpenChange, data, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; data: WorkplanData; readOnly: boolean }) {
  const t = useTranslations("workplan.holidaysDialog");
  const tc = useTranslations("common");
  const locale = useLocale();
  const years = [...new Set(data.holidays.map((h) => h.date.slice(0, 4)))].sort();
  const [year, setYear] = useState(years.includes(data.today.slice(0, 4)) ? data.today.slice(0, 4) : (years[0] ?? data.today.slice(0, 4)));
  const [date, setDate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [half, setHalf] = useState(false);
  const list = data.holidays.filter((h) => h.date.startsWith(year));
  async function add() {
    if (!date || !name.trim()) return;
    const res = await runAction(saveHolidayAction(null, { date, nameTr: name.trim(), nameEn: name.trim(), kind: "other", halfDay: half }));
    if (res) {
      setDate(null);
      setName("");
      setHalf(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1">
            {years.map((y) => (
              <button key={y} type="button" onClick={() => setYear(y)} aria-current={y === year ? "true" : undefined} className={y === year ? "inline-flex h-9 items-center rounded-full bg-ink px-3.5 text-[14px] font-medium text-on-ink" : "inline-flex h-9 items-center rounded-full px-3.5 text-[14px] text-muted hover:bg-panel hover:text-ink"}>
                {y}
              </button>
            ))}
          </div>
          <ul className="flex flex-col">
            {list.map((h) => (
              <li key={h.id} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0" data-testid="holiday-row">
                <span className="w-24 shrink-0 text-[13px] tabular-nums text-muted">{formatDay(h.date, locale, true)}</span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{locale === "en" ? h.nameEn : h.nameTr}</span>
                {h.halfDay ? (
                  <Badge variant="outline" size="sm">
                    {t("half")}
                  </Badge>
                ) : null}
                {!readOnly ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => runAction(deleteHolidayAction(h.id))} aria-label={tc("delete")}>
                    <Trash2 size={15} />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {!readOnly ? (
            <form
              className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <DateButton value={date} onChange={setDate} className="w-[140px]" />
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} aria-label={t("name")} className="h-10 min-w-[160px] flex-1" />
              <label className="flex items-center gap-2 text-[14px]">
                <Checkbox checked={half} onCheckedChange={(v) => setHalf(v === true)} />
                {t("half")}
              </label>
              <Button type="submit" size="sm" variant="outline" disabled={!date || !name.trim()}>
                <Plus size={15} />
                {t("add")}
              </Button>
            </form>
          ) : null}
          <p className="text-[13px] text-muted">{t("note")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
