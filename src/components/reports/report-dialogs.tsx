"use client";

import { ArrowDown, ArrowUp, BookOpen, FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createReportAction, duplicateReportAction, readTemplateAction, saveReportAsTemplateAction, saveReportTemplateAction, updateReportAction } from "@/app/(app)/reports/actions";
import { EntityPicker, type PickedEntity } from "@/components/common/entity-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { ReportsHomeData } from "@/server/views/reports";

type Template = ReportsHomeData["templates"][number];
type Period = ReportsHomeData["periods"][number];
type Language = "en-GB" | "en-US" | "tr";
const LANGUAGES: Language[] = ["en-GB", "en-US", "tr"];

/** Pills for the report language: British or American English, or Turkish. */
function LanguagePills({ value, onChange }: { value: Language; onChange: (v: Language) => void }) {
  const t = useTranslations("reports.languages");
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("label")}>
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          onClick={() => onChange(l)}
          className={cn("inline-flex h-10 items-center rounded-full px-4 text-[14px] transition-colors", value === l ? "bg-ink font-medium text-on-ink" : "bg-panel text-muted hover:text-ink")}
          data-testid="report-lang"
        >
          {t(l)}
        </button>
      ))}
    </div>
  );
}

/** The period picker, quarters first, newest at the bottom like the IPTT. */
function PeriodSelect({ id, value, onChange, periods }: { id: string; value: string; onChange: (v: string) => void; periods: Period[] }) {
  const t = useTranslations("reports.form");
  const kinds = [...new Set(periods.map((p) => p.kind))];
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid="report-period">
      <option value="">{t("noPeriod")}</option>
      {kinds.map((k) => (
        <optgroup key={k} label={t(`periodKinds.${k}` as "periodKinds.quarter")}>
          {periods
            .filter((p) => p.kind === k)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** "Yeni rapor": a template (hers or a built-in), a period, a deadline and the language. */
export function NewReportDialog({
  open,
  onOpenChange,
  templates,
  periods,
  spelling,
  initialTemplate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: Template[];
  periods: Period[];
  spelling: "en-GB" | "en-US";
  initialTemplate?: string | null;
}) {
  const t = useTranslations("reports.form");
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>(initialTemplate ?? templates.find((x) => !x.builtin)?.id ?? templates[0]?.id ?? "");
  const [periodId, setPeriodId] = useState("");
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState<Language>(spelling);
  const [busy, setBusy] = useState(false);
  const template = templates.find((x) => x.id === templateId) ?? null;
  const period = periods.find((p) => p.id === periodId) ?? null;
  // The title follows the template and period until she types her own.
  const shownTitle = touched ? title : [template?.name ?? t("blankTitle"), period?.label].filter(Boolean).join(" · ");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shownTitle.trim() || busy) return;
    setBusy(true);
    const res = await runAction(
      createReportAction({ title: shownTitle.trim(), templateId: templateId || null, periodId: periodId || null, dueDate: dueDate || null, audience: audience.trim() || null, language }),
    );
    setBusy(false);
    if (!res) return;
    onOpenChange(false);
    router.push(`/reports/${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("newTitle")} description={t("newHint")} wide>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[14px] font-medium">{t("template")}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[{ id: "", name: t("blank"), description: t("blankHint"), builtin: true, sections: [] } as Template, ...templates].map((x) => (
                <label
                  key={x.id || "blank"}
                  className={cn("flex cursor-pointer flex-col gap-1 rounded-2xl border px-4 py-3 transition-colors", templateId === x.id ? "border-ink bg-panel" : "border-line hover:border-ink")}
                  data-testid="report-template"
                >
                  <span className="flex items-center gap-2">
                    <input type="radio" name="template" className="sr-only" checked={templateId === x.id} onChange={() => setTemplateId(x.id)} />
                    <FileText size={15} className="shrink-0 text-muted" />
                    <span className="truncate text-[15px] font-medium">{x.name}</span>
                    {!x.builtin ? (
                      <Badge variant="outline" size="sm" className="ml-auto">
                        {t("yours")}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-[13px] text-muted">{x.id ? t("sectionCount", { count: x.sections.length }) : x.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("period")} htmlFor="r-period">
              <PeriodSelect id="r-period" value={periodId} onChange={setPeriodId} periods={periods} />
            </Field>
            <Field label={t("due")} htmlFor="r-due">
              <Input id="r-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="report-due-input" />
            </Field>
          </div>
          <Field label={t("title")} htmlFor="r-title">
            <Input
              id="r-title"
              value={shownTitle}
              onChange={(e) => {
                setTouched(true);
                setTitle(e.target.value);
              }}
              maxLength={300}
              required
              data-testid="report-title"
            />
          </Field>
          <Field label={t("audience")} htmlFor="r-audience" hint={t("audienceHint")}>
            <Input id="r-audience" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} placeholder={t("audiencePlaceholder")} />
          </Field>
          <Field label={t("language")}>
            <LanguagePills value={language} onChange={setLanguage} />
          </Field>
          <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !shownTitle.trim()} data-testid="report-create">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type ReportBasics = { id: string; title: string; periodId: string | null; dueDate: string | null; audience: string | null; language: Language };

/** "Rapor bilgileri": title, period, deadline, audience and language of an existing report. */
export function ReportDetailsDialog({ open, onOpenChange, report, periods }: { open: boolean; onOpenChange: (v: boolean) => void; report: ReportBasics; periods: Period[] }) {
  const t = useTranslations("reports.form");
  const [form, setForm] = useState({ title: report.title, periodId: report.periodId ?? "", dueDate: report.dueDate ?? "", audience: report.audience ?? "", language: report.language });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("detailsTitle")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await runAction(
              updateReportAction(report.id, { title: form.title.trim(), periodId: form.periodId || null, dueDate: form.dueDate || null, audience: form.audience.trim() || null, language: form.language }),
              { success: t("saved") },
            );
            setBusy(false);
            if (res !== undefined) onOpenChange(false);
          }}
        >
          <Field label={t("title")} htmlFor="rd-title">
            <Input id="rd-title" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={300} required />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("period")} htmlFor="rd-period">
              <PeriodSelect id="rd-period" value={form.periodId} onChange={(v) => set({ periodId: v })} periods={periods} />
            </Field>
            <Field label={t("due")} htmlFor="rd-due">
              <Input id="rd-due" type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
            </Field>
          </div>
          <Field label={t("audience")} htmlFor="rd-audience">
            <Input id="rd-audience" value={form.audience} onChange={(e) => set({ audience: e.target.value })} maxLength={300} placeholder={t("audiencePlaceholder")} />
          </Field>
          <Field label={t("language")}>
            <LanguagePills value={form.language} onChange={(v) => set({ language: v })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !form.title.trim()}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Yeni dönem için kopyala": the same sections and guidance, empty text, for the next period. */
export function DuplicateDialog({ open, onOpenChange, report, periods }: { open: boolean; onOpenChange: (v: boolean) => void; report: ReportBasics & { periodLabel: string | null }; periods: Period[] }) {
  const t = useTranslations("reports.form");
  const router = useRouter();
  const current = periods.find((p) => p.id === report.periodId);
  // The next period of the same kind, if there is one.
  const next = current ? periods.filter((p) => p.kind === current.kind && p.startDate > current.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] : undefined;
  const [periodId, setPeriodId] = useState(next?.id ?? "");
  const nextLabel = periods.find((p) => p.id === periodId)?.label;
  const baseTitle = report.periodLabel ? report.title.replace(report.periodLabel, "").replace(/[\s·-]+$/, "").trim() : report.title;
  const [title, setTitle] = useState<string | null>(null);
  const shownTitle = title ?? [baseTitle, nextLabel].filter(Boolean).join(" · ");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("duplicateTitle")} description={t("duplicateHint")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await runAction(duplicateReportAction(report.id, { title: shownTitle.trim(), periodId: periodId || null, dueDate: dueDate || null }));
            setBusy(false);
            if (!res) return;
            onOpenChange(false);
            router.push(`/reports/${res.id}`);
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("period")} htmlFor="rc-period">
              <PeriodSelect id="rc-period" value={periodId} onChange={setPeriodId} periods={periods} />
            </Field>
            <Field label={t("due")} htmlFor="rc-due">
              <Input id="rc-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label={t("title")} htmlFor="rc-title">
            <Input id="rc-title" value={shownTitle} onChange={(e) => setTitle(e.target.value)} maxLength={300} required data-testid="report-copy-title" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !shownTitle.trim()} data-testid="report-copy">
              {t("duplicate")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type TemplateSection = { heading: string; guidance: string; wordLimit: number | null };

/** Sections of a template as an editable list: heading, what the donor asks for, and the word limit. */
export function SectionListEditor({ value, onChange }: { value: TemplateSection[]; onChange: (v: TemplateSection[]) => void }) {
  const t = useTranslations("reports.template");
  const set = (i: number, patch: Partial<TemplateSection>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...value];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2" data-testid="tpl-sections">
        {value.map((s, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-2xl border border-line px-4 py-3" data-testid="tpl-section">
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-[13px] text-muted">{i + 1}.</span>
              <Input value={s.heading} onChange={(e) => set(i, { heading: e.target.value })} maxLength={300} aria-label={t("heading")} className="h-10 flex-1" />
              <Input
                type="number"
                min={10}
                max={20000}
                value={s.wordLimit ?? ""}
                onChange={(e) => set(i, { wordLimit: e.target.value ? Math.max(10, Math.min(20000, Number(e.target.value))) : null })}
                aria-label={t("wordLimit")}
                placeholder={t("words")}
                className="h-10 w-[96px]"
              />
              <span className="flex shrink-0">
                <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("up")}>
                  <ArrowUp size={15} />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={t("down")}>
                  <ArrowDown size={15} />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("remove", { heading: s.heading })}>
                  <X size={15} />
                </Button>
              </span>
            </div>
            <Textarea value={s.guidance} onChange={(e) => set(i, { guidance: e.target.value })} maxLength={4000} placeholder={t("guidancePlaceholder")} aria-label={t("guidance")} className="min-h-14 text-[14px]" />
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...value, { heading: "", guidance: "", wordLimit: null }])}>
        <Plus size={15} />
        {t("addSection")}
      </Button>
    </div>
  );
}

/**
 * "Donör şablonunu oku": she picks the donor's template file, Claude lists
 * its sections with guidance and word limits, she corrects the list and
 * keeps it as one of her report templates.
 */
export function TemplateReaderDialog({ open, onOpenChange, aiReady, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; aiReady: boolean; onSaved: (templateId: string) => void }) {
  const t = useTranslations("reports.template");
  const [file, setFile] = useState<PickedEntity | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [sections, setSections] = useState<TemplateSection[] | null>(null);

  async function read() {
    if (!file) return;
    setBusy(true);
    const res = await runAction(readTemplateAction(file.id));
    setBusy(false);
    if (!res) return;
    setName(res.name);
    setSections(res.sections);
  }

  async function save() {
    if (!sections) return;
    const clean = sections.filter((s) => s.heading.trim());
    if (!clean.length || !name.trim()) return;
    setBusy(true);
    const res = await runAction(saveReportTemplateAction({ name: name.trim(), description: file ? t("fromFile", { title: file.title }) : null, sections: clean }), { success: t("saved") });
    setBusy(false);
    if (res) onSaved(res.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={sections ? t("checkHint") : t("hint")} wide>
        {!sections ? (
          <div className="flex flex-col gap-4">
            {!aiReady ? <p className="rounded-2xl bg-panel px-4 py-3 text-[14px] text-muted">{t("notConnected")}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <EntityPicker
                types={["document"]}
                placeholder={t("pickPlaceholder")}
                onPick={(item) => setFile(item)}
                trigger={
                  <Button variant="outline" data-testid="tpl-pick">
                    <FileText size={16} />
                    {file ? t("change") : t("pick")}
                  </Button>
                }
              />
              {file ? (
                <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium" data-testid="tpl-file">
                  <BookOpen size={15} className="shrink-0 text-muted" />
                  <span className="truncate">{file.title}</span>
                </span>
              ) : null}
            </div>
            <p className="text-[13px] text-muted">
              {t.rich("uploadFirst", {
                link: (chunks) => (
                  <Link href="/files" className="underline underline-offset-2 hover:text-ink">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
            <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={read} disabled={!file || busy || !aiReady} data-testid="tpl-read">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? t("reading") : t("read")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label={t("name")} htmlFor="tpl-name">
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="tpl-name" />
            </Field>
            <SectionListEditor value={sections} onChange={setSections} />
            <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
              <Button variant="ghost" onClick={() => setSections(null)}>
                {t("back")}
              </Button>
              <Button onClick={save} disabled={busy || !name.trim() || !sections.some((s) => s.heading.trim())} data-testid="tpl-save">
                {t("saveAndStart")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Şablon olarak kaydet": this report's sections as a template for the next period. */
export function SaveTemplateDialog({ open, onOpenChange, reportId, defaultName }: { open: boolean; onOpenChange: (v: boolean) => void; reportId: string; defaultName: string }) {
  const t = useTranslations("reports.template");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("saveAsTitle")} description={t("saveAsHint")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await runAction(saveReportAsTemplateAction(reportId, name), { success: t("saved") });
            setBusy(false);
            if (res) onOpenChange(false);
          }}
        >
          <Field label={t("name")} htmlFor="tpl-as-name">
            <Input id="tpl-as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()} data-testid="tpl-as-save">
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
