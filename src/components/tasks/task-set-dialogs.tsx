"use client";

import { ArrowLeft, ListChecks, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { applyTaskSetAction, listTaskSetsAction, previewTaskSetAction, saveTaskSetAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { daysBetween } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { TaskItem } from "./types";

const ANCHORS = ["deadline", "start", "visit", "meeting", "period_end"] as const;
type Anchor = (typeof ANCHORS)[number];

type SetsData = Extract<Awaited<ReturnType<typeof listTaskSetsAction>>, { ok: true }>["data"];
type Preview = NonNullable<Extract<Awaited<ReturnType<typeof previewTaskSetAction>>, { ok: true }>["data"]>;

/** "21 gün önce", "aynı gün", "3 gün sonra". */
function useOffsetLabel() {
  const t = useTranslations("tasks.sets");
  return (n: number | null) => (n === null ? t("undated") : n === 0 ? t("sameDay") : n < 0 ? t("before", { count: -n }) : t("after", { count: n }));
}

const dayLabel = (day: string, locale: string) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/**
 * "Görev seti" (Asana and Todoist templates with relative dates): pick a
 * set, pick its day, see every task dated before it is created.
 */
export function ApplyTaskSetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("tasks.sets");
  const tc = useTranslations("common");
  const locale = useLocale();
  const offsetLabel = useOffsetLabel();
  const [data, setData] = useState<SetsData | null>(null);
  const [setId, setSetId] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [orgId, setOrgId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void runAction(listTaskSetsAction(), { silent: true }).then((d) => alive && d && setData(d));
    return () => {
      alive = false;
    };
  }, [open]);

  // Dates come from the server: weekends and her holidays move a task to a working day.
  useEffect(() => {
    if (!setId) return;
    let alive = true;
    const anchor = day || data?.today;
    if (!anchor) return;
    void runAction(previewTaskSetAction(setId, anchor), { silent: true }).then((p) => alive && setPreview(p ?? null));
    return () => {
      alive = false;
    };
  }, [setId, day, data?.today]);

  const reset = () => {
    setSetId(null);
    setDay("");
    setOrgId("");
    setPreview(null);
    setSkip(new Set());
  };
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };

  const chosen = data?.sets.find((s) => s.id === setId) ?? null;
  const kept = preview ? preview.items.filter((i) => !skip.has(i.index)) : [];
  const today = data?.today ?? "";

  const apply = async () => {
    if (!setId || !day) return;
    setSaving(true);
    const res = await runAction(applyTaskSetAction(setId, day, { orgId: orgId || null, skip: [...skip] }));
    setSaving(false);
    if (res) {
      toast(t("added", { count: res.count }));
      close(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title={chosen ? chosen.name : t("applyTitle")} description={chosen ? (chosen.description ?? undefined) : t("applyHint")}>
        {!data ? (
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <Loader2 size={15} className="animate-spin" />
            {tc("loading")}
          </p>
        ) : !chosen ? (
          <ul className="flex flex-col gap-2" data-testid="task-sets">
            {data.sets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSetId(s.id)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-line px-4 py-3 text-left transition-colors hover:border-ink"
                  data-testid="task-set"
                >
                  <ListChecks size={17} className="mt-0.5 shrink-0 text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-medium">{s.name}</span>
                    {s.description ? <span className="text-[13px] text-muted">{s.description}</span> : null}
                    <span className="text-[13px] text-muted">
                      {t("count", { count: s.count })} · {t(`anchorsFrom.${s.anchor as Anchor}`)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void apply();
            }}
          >
            <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 self-start text-[13px] text-muted hover:text-ink">
              <ArrowLeft size={14} />
              {t("otherSet")}
            </button>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t(`anchors.${chosen.anchor as Anchor}`)} htmlFor="set-day" hint={t("dayHint")}>
                <Input id="set-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required data-testid="task-set-day" />
              </Field>
              <Field label={t("partner")} htmlFor="set-org" hint={t("partnerHint")}>
                <Select id="set-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="task-set-org">
                  <option value="">{t("noPartner")}</option>
                  {data.partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-1">
              <p className="label-caps">{day ? t("preview") : t("previewNoDay")}</p>
              <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line" data-testid="task-set-preview">
                {(preview?.items ?? []).map((i) => {
                  const off = skip.has(i.index);
                  const past = Boolean(day && i.date && i.date < today);
                  return (
                    <li key={i.index}>
                      <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5">
                      <Checkbox
                        checked={!off}
                        onCheckedChange={(v) =>
                          setSkip((s) => {
                            const next = new Set(s);
                            if (v) next.delete(i.index);
                            else next.add(i.index);
                            return next;
                          })
                        }
                        aria-label={i.title}
                        className="mt-0.5"
                      />
                      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", off && "opacity-50")}>
                        <span className="text-[14px]">{i.title}</span>
                        <span className="text-[13px] text-muted">
                          {offsetLabel(i.offsetDays)}
                          {day && i.date ? (
                            <>
                              {" · "}
                              <span className={cn(past ? "font-medium text-accent-ink" : "text-ink-2")}>{dayLabel(i.date, locale)}</span>
                              {past ? ` · ${t("past")}` : i.moved ? ` · ${t("moved")}` : ""}
                            </>
                          ) : null}
                        </span>
                      </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={!day || !kept.length || saving} data-testid="task-set-apply">
                {saving ? <Loader2 size={15} className="animate-spin" /> : null}
                {t("add", { count: kept.length })}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Görev seti olarak kaydet": the selected tasks become a set of her own;
 * each date is kept as days before the latest one.
 */
export function SaveTaskSetDialog({ tasks, onOpenChange, onSaved }: { tasks: TaskItem[] | null; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const t = useTranslations("tasks.sets");
  const tc = useTranslations("common");
  const offsetLabel = useOffsetLabel();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [anchor, setAnchor] = useState<Anchor>("deadline");
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    const list = tasks ?? [];
    const last = list.map((x) => x.dueDate).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    return [...list]
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
      .map((x) => ({ id: x.id, title: x.title, offset: last && x.dueDate ? daysBetween(last, x.dueDate) : null }));
  }, [tasks]);

  const save = async () => {
    if (!tasks) return;
    setSaving(true);
    const res = await runAction(saveTaskSetAction(tasks.map((x) => x.id), { name: name.trim(), description: description.trim() || null, anchor }), { success: t("saved") });
    setSaving(false);
    if (res) {
      setName("");
      setDescription("");
      onSaved();
    }
  };

  return (
    <Dialog open={Boolean(tasks)} onOpenChange={onOpenChange}>
      <DialogContent title={t("saveTitle")} description={t("saveHint")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !saving) void save();
          }}
        >
          <Field label={t("name")} htmlFor="set-name">
            <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("namePlaceholder")} autoFocus data-testid="task-set-name" />
          </Field>
          <Field label={t("about")} htmlFor="set-about">
            <Input id="set-about" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} />
          </Field>
          <Field label={t("anchor")} htmlFor="set-anchor" hint={t("anchorHint")}>
            <Select id="set-anchor" value={anchor} onChange={(e) => setAnchor(e.target.value as Anchor)} data-testid="task-set-anchor">
              {ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {t(`anchors.${a}`)}
                </option>
              ))}
            </Select>
          </Field>
          <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line" data-testid="task-set-save-preview">
            {rows.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0 text-[14px]">{r.title}</span>
                <span className="shrink-0 text-[13px] text-muted">{offsetLabel(r.offset)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || saving} data-testid="task-set-save">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
