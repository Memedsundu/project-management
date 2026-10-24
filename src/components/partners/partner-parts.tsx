"use client";

import { AlertTriangle, Check, Copy, FileText, Loader2, Mail, MoreHorizontal, Pencil, Phone, Plus, Sparkles, Star, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { markPartnerReportAction, setFocalContactAction } from "@/app/(app)/partners/actions";
import { setTaskDoneAction } from "@/app/(app)/tasks/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { PickerBody } from "@/components/common/entity-picker";
import { useTrash } from "@/components/common/use-trash";
import { uploadOne } from "@/components/files/upload-core";
import { MiniMarkdown } from "@/components/meetings/meeting-parts";
import { InlineAdd } from "@/components/tasks/inline-add";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { dayOf, formatDay, parseDay, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { PartnerRef } from "@/lib/parse-task";
import { cn } from "@/lib/utils";
import { ContactDialog } from "./org-form";
import type { ContactRow, PartnerPageData, PartnerTask, ReportSlotView, TimelineEntry } from "./types";

/* ---------------------------------- Tasks ---------------------------------- */

function TaskLines({ tasks, readOnly, hideOwners = [] }: { tasks: PartnerTask[]; readOnly: boolean; hideOwners?: (string | null)[] }) {
  const locale = useLocale();
  return (
    <ul className="flex flex-col">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-3 border-b border-line-soft py-2 last:border-0">
          <Checkbox round disabled={readOnly} onCheckedChange={(v) => runAction(setTaskDoneAction(task.id, v === true))} aria-label={task.title} className="mt-0.5" />
          <Link href={`/tasks?open=${task.id}`} className="min-w-0 flex-1 text-[15px] hover:underline">
            {task.title}
          </Link>
          <span className="shrink-0 text-right text-[13px]">
            {task.owner && !hideOwners.includes(task.owner) ? <span className="block text-muted">{task.owner}</span> : null}
            {task.dueDate ? <span className={cn("block", task.overdue ? "font-medium text-overdue" : "text-muted")}>{relativeDayLabel(task.dueDate, locale)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Beklediklerin": what this partner owes her, reports first, then everything she is waiting on. */
export function OwedSection({ data, partners, readOnly }: { data: PartnerPageData; partners: PartnerRef[]; readOnly: boolean }) {
  const t = useTranslations("partners.page");
  const locale = useLocale();
  const reports = data.reports.filter((r) => r.status === "late" || r.status === "due");
  const empty = !reports.length && !data.waiting.length;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="p-owed">
      <h2 id="p-owed" className="label-caps">
        {t("owed")}
      </h2>
      {empty ? <p className="text-[14px] text-muted">{t("owedEmpty")}</p> : null}
      {reports.length ? (
        <ul className="flex flex-col">
          {reports.map((r) => (
            <li key={r.label} className="flex items-center gap-3 border-b border-line-soft py-2 last:border-0">
              {r.status === "late" ? <AlertTriangle size={17} className="shrink-0 text-overdue" /> : <FileText size={17} className="shrink-0 text-muted" />}
              <a href="#reports" className="min-w-0 flex-1 text-[15px] hover:underline">
                {t("reportFor", { label: r.label })}
              </a>
              <span className={cn("shrink-0 text-[13px]", r.status === "late" ? "font-medium text-overdue" : "text-muted")}>
                {r.status === "late" ? t("daysLate", { days: r.daysLate }) : t("dueOn", { date: relativeDayLabel(r.due, locale, data.today) })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {data.waiting.length ? <TaskLines tasks={data.waiting} readOnly={readOnly} hideOwners={[data.org.shortName, data.org.name]} /> : null}
      {!readOnly ? <InlineAdd today={data.today} partners={partners} defaults={{ ownerOrgId: data.org.id }} placeholder={t("owedAdd")} /> : null}
    </section>
  );
}

export function MineSection({ data, partners, readOnly }: { data: PartnerPageData; partners: PartnerRef[]; readOnly: boolean }) {
  const t = useTranslations("partners.page");
  return (
    <section className="flex flex-col gap-2" aria-labelledby="p-mine">
      <h2 id="p-mine" className="label-caps">
        {t("mine")}
      </h2>
      {data.mine.length ? <TaskLines tasks={data.mine} readOnly={readOnly} /> : <p className="text-[14px] text-muted">{t("mineEmpty")}</p>}
      {!readOnly ? <InlineAdd today={data.today} partners={partners} defaults={{ orgIds: [data.org.id] }} placeholder={t("mineAdd")} /> : null}
    </section>
  );
}

/* --------------------------------- Reports --------------------------------- */

function SlotStatus({ s }: { s: ReportSlotView }) {
  const t = useTranslations("partners.reports");
  if (s.status === "received")
    return (
      <Badge variant="neutral" size="sm">
        <Check size={11} />
        {t("received")}
      </Badge>
    );
  if (s.status === "late")
    return (
      <Badge variant="overdue" size="sm">
        {t("late", { days: s.daysLate })}
      </Badge>
    );
  if (s.status === "due")
    return (
      <Badge variant="ink" size="sm">
        {t("due")}
      </Badge>
    );
  return (
    <Badge variant="outline" size="sm">
      {t("upcoming")}
    </Badge>
  );
}

/** "Raporlama takvimi": each expected report, received, late or still to come. One click files it. */
export function ReportCalendar({ data, readOnly, onEditRhythm }: { data: PartnerPageData; readOnly: boolean; onEditRhythm: () => void }) {
  const t = useTranslations("partners.reports");
  const tr = useTranslations("partners.rhythms");
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { org } = data;
  const slots = data.reports;
  const hidden = showAll ? 0 : Math.max(0, slots.length - 6);
  const visible = slots.slice(hidden);

  const mark = async (documentId: string, label: string, success: string) => {
    await runAction(markPartnerReportAction(org.id, documentId, label), { success });
  };
  const onFile = async (file: File) => {
    const label = target.current;
    if (!label) return;
    setBusy(label);
    const res = await uploadOne(file, { folderId: null, note: t("uploadNote", { label }) });
    if (res.ok) await mark(res.id, label, t("marked", { label }));
    else if ("duplicate" in res) await mark(res.duplicate.id, label, t("markedExisting", { label, title: res.duplicate.title }));
    else toast.error(t(`errors.${res.error}`));
    setBusy(null);
    target.current = null;
  };

  return (
    <section id="reports" className="flex scroll-mt-24 flex-col gap-2" aria-labelledby="p-reports">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="p-reports" className="label-caps">
          {t("title")}
        </h2>
        {org.reportingRhythm !== "none" ? <span className="text-[13px] text-muted">{t("rule", { rhythm: tr(org.reportingRhythm as "none"), days: org.reportDueDays })}</span> : null}
      </div>
      {org.reportingRhythm === "none" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3">
          <p className="min-w-0 flex-1 text-[14px] text-muted">{t("noRhythm")}</p>
          {!readOnly ? (
            <Button variant="outline" size="sm" onClick={onEditRhythm}>
              {t("setRhythm")}
            </Button>
          ) : null}
        </div>
      ) : slots.length === 0 ? (
        <p className="text-[14px] text-muted">{t("none")}</p>
      ) : (
        <>
          {hidden ? (
            <button type="button" onClick={() => setShowAll(true)} className="self-start text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
              {t("earlier", { count: hidden })}
            </button>
          ) : null}
          <ul className="flex flex-col" data-testid="report-calendar">
            {visible.map((s) => (
              <li key={s.label} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line-soft py-2.5 last:border-0">
                <span className="flex w-[150px] shrink-0 flex-col">
                  <span className="text-[15px] font-medium tabular-nums">{s.label}</span>
                  <span className="text-[12px] text-muted">{t("periodEnd", { date: formatDay(s.periodEnd, locale, true) })}</span>
                </span>
                <span className="w-[120px] shrink-0 text-[13px] text-muted">{t("dueShort", { date: formatDay(s.due, locale) })}</span>
                <span className="shrink-0">
                  <SlotStatus s={s} />
                </span>
                <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
                  {s.doc ? (
                    <Link href={`/files/d/${s.doc.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-[14px] hover:underline">
                      <FileText size={14} className="shrink-0 text-muted" />
                      <span className="truncate">{s.doc.title}</span>
                    </Link>
                  ) : !readOnly && s.status !== "upcoming" ? (
                    busy === s.label ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                        <Loader2 size={14} className="animate-spin" />
                        {t("uploading")}
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            target.current = s.label;
                            fileRef.current?.click();
                          }}
                        >
                          <Upload size={14} />
                          {t("upload")}
                        </Button>
                        <Popover open={picking === s.label} onOpenChange={(v) => setPicking(v ? s.label : null)}>
                          <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8">
                              {t("pick")}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-[min(420px,calc(100vw-24px))] p-2">
                            {picking === s.label ? (
                              <PickerBody
                                types={["document"]}
                                placeholder={t("pickPlaceholder")}
                                onPick={async (item) => {
                                  setPicking(null);
                                  await mark(item.id, s.label, t("marked", { label: s.label }));
                                }}
                              />
                            ) : null}
                          </PopoverContent>
                        </Popover>
                      </>
                    )
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            data-testid="report-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void onFile(file);
            }}
          />
        </>
      )}
    </section>
  );
}

/* --------------------------------- Timeline -------------------------------- */

const FILTERS = [null, "meeting", "document", "decision", "task", "note"] as const;

/** Attio's activity timeline: every meeting, file, decision, task and note with this partner. */
export function Timeline({ data }: { data: PartnerPageData }) {
  const t = useTranslations("partners.timeline");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [now] = useState(() => Date.now());
  const [shown, setShown] = useState(12);
  const groups = new Map<string, TimelineEntry[]>();
  for (const item of data.timeline.slice(0, shown)) {
    const key = dayOf(item.date).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const month = (key: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric" }).format(parseDay(`${key}-01`));
  const meta = (item: TimelineEntry) => {
    if (item.type === "meeting") return item.state === "canceled" ? t("canceled") : new Date(item.date).getTime() > now ? t("upcoming") : null;
    if (item.type === "task") return item.state === "done" ? t("done") : item.state === "canceled" ? t("canceled") : item.meta ? t("due", { date: formatDay(item.meta, locale) }) : t("open");
    if (item.type === "document") return [item.state === "partner_report" ? t("partnerReport") : null, item.meta].filter(Boolean).join(" · ") || null;
    return null;
  };
  const href = (type: string | null) => `/partners/${data.org.id}${type ? `?type=${type}` : ""}#timeline`;
  return (
    <section id="timeline" className="flex scroll-mt-24 flex-col gap-3" aria-labelledby="p-timeline">
      <h2 id="p-timeline" className="label-caps">
        {t("title")}
      </h2>
      <nav className="flex flex-wrap gap-1.5" aria-label={t("filter")}>
        {FILTERS.map((f) => (
          <Link
            key={f ?? "all"}
            href={href(f)}
            scroll={false}
            aria-current={data.filter === f ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors",
              data.filter === f ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:border-ink",
            )}
          >
            {f ? <EntityIcon type={f} size={14} /> : null}
            {t(`types.${f ?? "all"}`)}
          </Link>
        ))}
      </nav>
      {data.timeline.length === 0 ? (
        <p className="text-[14px] text-muted">{data.filter ? t("emptyFiltered") : t("empty")}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([key, items]) => (
            <div key={key} className="flex flex-col gap-1">
              <h3 className="text-[14px] font-semibold text-ink-2">{month(key)}</h3>
              <ol className="relative flex flex-col border-l border-line pl-5">
                {items.map((item) => {
                  const m = meta(item);
                  return (
                    <li key={item.key} className="relative py-2">
                      <span className="absolute -left-[29px] top-2.5 flex size-[17px] items-center justify-center rounded-full bg-bg text-muted" aria-hidden>
                        <EntityIcon type={item.type} size={14} />
                      </span>
                      <span className="flex items-start gap-3">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <Link href={item.href} className={cn("text-[15px] hover:underline", item.type === "task" && item.state === "done" && "text-muted line-through")}>
                            {item.title || t("untitled")}
                          </Link>
                          {m ? <span className="text-[13px] text-muted">{m}</span> : null}
                        </span>
                        <span className="shrink-0 pt-0.5 text-[13px] tabular-nums text-muted">{formatDay(dayOf(item.date), locale)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {data.timeline.length > shown ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown((n) => n + 20)}>
              {tc("showMore")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* --------------------------------- People ---------------------------------- */

/** "Kişiler": adults she works with at this organisation; the star marks the focal person. */
export function PeopleSection({ data, readOnly, onAdd }: { data: PartnerPageData; readOnly: boolean; onAdd: () => void }) {
  const t = useTranslations("partners.people");
  const tc = useTranslations("common");
  const trash = useTrash();
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const focalId = data.org.focalContactId;
  const people = [...data.contacts].sort((a, b) => Number(b.id === focalId) - Number(a.id === focalId));
  useEffect(() => {
    if (data.highlight) document.getElementById(`c-${data.highlight}`)?.scrollIntoView({ block: "center" });
  }, [data.highlight]);
  return (
    <section className="flex flex-col gap-2" aria-labelledby="p-people">
      <div className="flex items-center justify-between gap-2">
        <h2 id="p-people" className="label-caps">
          {t("title")}
        </h2>
        {!readOnly ? (
          <Button variant="ghost" size="sm" className="h-8 px-2.5" onClick={onAdd}>
            <Plus size={15} />
            {tc("add")}
          </Button>
        ) : null}
      </div>
      {people.length === 0 ? <p className="text-[14px] text-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col gap-1">
        {people.map((c) => {
          const focal = c.id === focalId;
          return (
            <li key={c.id} id={`c-${c.id}`} className={cn("group flex scroll-mt-24 items-start gap-2 rounded-xl px-3 py-2.5", data.highlight === c.id ? "bg-accent-soft/50" : "hover:bg-panel")}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[15px] font-medium">
                  <span className="truncate">{c.name}</span>
                  {focal ? <Star size={13} className="shrink-0 fill-ink text-ink" aria-label={t("focal")} /> : null}
                </span>
                {c.role ? <span className="text-[13px] text-muted">{c.role}</span> : null}
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] hover:underline">
                    <Mail size={12} className="shrink-0 text-muted" />
                    <span className="truncate">{c.email}</span>
                  </a>
                ) : null}
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1.5 text-[13px] tabular-nums hover:underline">
                    <Phone size={12} className="shrink-0 text-muted" />
                    {c.phone}
                  </a>
                ) : null}
              </span>
              {!readOnly ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("menu", { name: c.name })}>
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setEditing(c)}>
                      <Pencil size={15} />
                      {tc("edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => runAction(setFocalContactAction(data.org.id, focal ? null : c.id), { success: focal ? t("focalRemoved") : t("focalSet", { name: c.name }) })}>
                      <Star size={15} />
                      {focal ? t("unsetFocal") : t("setFocal")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => trash("contact", c.id, { title: c.name })}>
                      <Trash2 size={15} />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>
      {editing ? <ContactDialog open onOpenChange={(v) => !v && setEditing(null)} orgs={data.orgs} initial={editing} /> : null}
    </section>
  );
}

/* ---------------------------------- Brief ---------------------------------- */

/** "Ortak brifi": five lines before a call. Written fresh each time, never stored. */
export function BriefCard({ text, onClose, onRegenerate, busy }: { text: string; onClose: () => void; onRegenerate: () => void; busy: boolean }) {
  const t = useTranslations("partners.brief");
  const tc = useTranslations("common");
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel px-5 py-4" aria-labelledby="p-brief" data-testid="partner-brief">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent-ink" />
        <h2 id="p-brief" className="text-[15px] font-semibold">
          {t("title")}
        </h2>
        <Badge variant="ai" size="sm">
          {tc("aiBadge")}
        </Badge>
        <span className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={tc("copy")}
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              toast(tc("copied"));
            }}
          >
            <Copy size={15} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("regenerate")} disabled={busy} onClick={onRegenerate}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label={tc("close")} onClick={onClose}>
            <X size={15} />
          </Button>
        </span>
      </div>
      <MiniMarkdown text={text} />
      <p className="text-[12px] text-muted">{t("footnote")}</p>
    </section>
  );
}
