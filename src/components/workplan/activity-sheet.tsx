"use client";

import { AlertTriangle, CalendarOff, Info, Plus, Sparkles, Trash2, Wheat, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { createTaskAction, setTaskDoneAction } from "@/app/(app)/tasks/actions";
import { addDependencyAction, proposePrepAction, removeDependencyAction, updateActivityAction } from "@/app/(app)/workplan/actions";
import { LinksPanel } from "@/components/common/links-panel";
import { useTrash } from "@/components/common/use-trash";
import { SuggestionCard } from "@/components/inbox/suggestion-card";
import { DateButton } from "@/components/tasks/date-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, SheetContent } from "@/components/ui/overlay";
import { daysBetween, formatDateTime, formatDay, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { PROVINCES } from "@/lib/provinces";
import { cn } from "@/lib/utils";
import { MultiPick } from "./pickers";
import { dayNum, STATUSES, workingDays } from "./shared";
import type { ActivityDetail, WorkplanData } from "./types";

function Body({ detail, data, readOnly, onClose, onOpen }: { detail: ActivityDetail; data: WorkplanData; readOnly: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useTranslations("workplan");
  const tc = useTranslations("common");
  const ta = useTranslations("common.actions");
  const locale = useLocale();
  const trash = useTrash();
  const a = detail.activity;
  const [code, setCode] = useState(a.code);
  const [title, setTitle] = useState(a.title);
  const [description, setDescription] = useState(a.description ?? "");
  const [progress, setProgress] = useState(a.progress);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState<string | null>(a.startDate && a.startDate > data.today ? a.startDate : null);
  const [proposing, setProposing] = useState(false);
  const [seen, setSeen] = useState(`${a.id}|${a.code}|${a.title}|${a.description}|${a.progress}`);
  const key = `${a.id}|${a.code}|${a.title}|${a.description}|${a.progress}`;
  if (seen !== key) {
    setSeen(key);
    setCode(a.code);
    setTitle(a.title);
    setDescription(a.description ?? "");
    setProgress(a.progress);
  }
  const save = (patch: Parameters<typeof updateActivityAction>[1]) => runAction(updateActivityAction(a.id, patch));
  const byId = new Map(data.activities.map((x) => [x.id, x]));
  const preds = a.dependsOn.map((id) => byId.get(id)).filter((x) => x !== undefined);
  const deps = detail.dependents.map((id) => byId.get(id)).filter((x) => x !== undefined);
  const holidays = a.startDate && a.endDate ? data.holidays.filter((h) => h.date >= a.startDate! && h.date <= a.endDate! && !h.halfDay) : [];
  const seasons = a.startDate && a.endDate ? data.bands.filter((b) => b.start <= a.endDate! && b.end >= a.startDate!) : [];
  const lateDays = a.late && a.endDate && a.endDate < data.today ? daysBetween(a.endDate, data.today) : 0;
  const blocking = preds.filter((p) => p.status !== "done" && p.status !== "canceled" && a.startDate && (p.late || (p.endDate ?? "") >= a.startDate));
  const field = "grid grid-cols-[112px_1fr] items-center gap-x-3 gap-y-2.5 text-[14px]";

  async function addTask() {
    if (!taskTitle.trim()) return;
    const res = await runAction(createTaskAction({ title: taskTitle.trim(), dueDate: taskDue, links: [{ type: "activity", id: a.id }] }));
    if (res) setTaskTitle("");
  }

  async function propose() {
    setProposing(true);
    const res = await runAction(proposePrepAction(a.id));
    setProposing(false);
    if (res && !res.suggestions) toast(t("ai.nothing"));
  }

  return (
    <div className="flex h-full flex-col" data-testid="activity-sheet">
      <div className="flex items-start gap-2 border-b border-line px-5 py-4">
        <input
          value={code}
          disabled={readOnly}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => code.trim() && code !== a.code && save({ code: code.trim() })}
          aria-label={t("table.code")}
          className="mt-1 h-9 w-16 shrink-0 rounded-lg bg-panel px-2 text-center text-[14px] font-medium tabular-nums outline-none focus:ring-2 focus:ring-ink"
        />
        <textarea
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onBlur={() => title.trim() && title !== a.title && save({ title: title.trim() })}
          rows={Math.min(4, Math.ceil(title.length / 34) || 1)}
          aria-label={t("table.title")}
          className={cn("flex-1 resize-none bg-transparent pt-1 text-[20px] font-semibold leading-snug outline-none", a.status === "canceled" && "text-muted line-through")}
        />
        <button type="button" onClick={onClose} aria-label={tc("close")} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-5">
          {a.late || a.atRisk ? (
            <div className="flex gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-[14px] text-accent-ink" role="status">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{a.late ? (lateDays ? t("flags.lateDays", { days: lateDays }) : t("flags.late")) : t("flags.atRisk")}</span>
                {blocking.length ? <span>{t("sheet.waitsFor", { list: blocking.map((p) => p.code).join(", ") })}</span> : null}
              </div>
            </div>
          ) : null}

          <div className={field}>
            <span className="text-muted">{t("table.status")}</span>
            <Select value={a.status} disabled={readOnly} onChange={(e) => save({ status: e.target.value as typeof a.status })} className="h-10">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>

            <span className="text-muted">{a.isMilestone ? t("sheet.date") : t("table.start")}</span>
            <DateButton value={a.startDate} onChange={(d) => save(a.isMilestone ? { startDate: d, endDate: d } : { startDate: d })} disabled={readOnly} />

            {!a.isMilestone ? (
              <>
                <span className="text-muted">{t("table.end")}</span>
                <DateButton value={a.endDate} onChange={(d) => save({ endDate: d })} disabled={readOnly} overdue={a.late} />
              </>
            ) : null}

            {a.startDate && a.endDate && !a.isMilestone ? (
              <>
                <span className="text-muted">{t("table.duration")}</span>
                <span className="text-[14px]">
                  {t("table.workdays", { count: workingDays(a.startDate, a.endDate, data.holidays) })}
                  <span className="text-muted"> · {t("sheet.calendarDays", { count: dayNum(a.endDate) - dayNum(a.startDate) + 1 })}</span>
                </span>
              </>
            ) : null}

            <span className="text-muted">{t("table.output")}</span>
            <Select value={a.logframeNodeId ?? ""} disabled={readOnly} onChange={(e) => save({ logframeNodeId: e.target.value || null })} className="h-10">
              <option value="">—</option>
              {data.outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} {o.title}
                </option>
              ))}
            </Select>

            <span className="text-muted">{t("table.partners")}</span>
            <MultiPick
              label={t("table.partners")}
              options={data.orgs.map((o) => ({ id: o.id, label: o.shortName || o.name, hint: o.shortName ? o.name : null }))}
              value={a.orgIds}
              disabled={readOnly}
              placeholder={t("table.choose")}
              onToggle={(id, on) => save({ orgIds: on ? [...a.orgIds, id] : a.orgIds.filter((x) => x !== id) })}
            />

            <span className="text-muted">{t("table.provinces")}</span>
            <MultiPick
              label={t("table.provinces")}
              searchable
              options={[...new Set([...a.provinces, ...PROVINCES])].map((p) => ({ id: p, label: p }))}
              value={a.provinces}
              disabled={readOnly}
              placeholder={t("table.choose")}
              onToggle={(id, on) => save({ provinces: on ? [...a.provinces, id] : a.provinces.filter((x) => x !== id) })}
            />

            <span className="text-muted">{t("table.progress")}</span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                disabled={readOnly}
                onChange={(e) => setProgress(Number(e.target.value))}
                onPointerUp={() => progress !== a.progress && save({ progress })}
                onKeyUp={() => progress !== a.progress && save({ progress })}
                aria-label={t("table.progress")}
                className="h-2 flex-1 cursor-pointer accent-[var(--color-ink)]"
              />
              <span className="w-10 text-right text-[14px] tabular-nums">%{progress}</span>
            </div>

            <span className="text-muted">{t("flags.milestone")}</span>
            <span className="flex items-center gap-2">
              <Switch checked={a.isMilestone} disabled={readOnly} onCheckedChange={(v) => save(v ? { isMilestone: true, endDate: a.startDate } : { isMilestone: false })} aria-label={t("flags.milestone")} />
              <span className="text-[13px] text-muted">{t("sheet.milestoneHint")}</span>
            </span>
          </div>

          {seasons.length || holidays.length ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-line px-3.5 py-3 text-[13px] text-ink-2">
              {seasons.map((b) => (
                <span key={b.id} className="flex items-start gap-2">
                  <Wheat size={14} className="mt-0.5 shrink-0 text-muted" />
                  {t("sheet.season", { name: b.name, range: `${formatDay(b.start, locale)} – ${formatDay(b.end, locale, true)}` })}
                </span>
              ))}
              {holidays.length ? (
                <span className="flex items-start gap-2">
                  <CalendarOff size={14} className="mt-0.5 shrink-0 text-muted" />
                  {t("sheet.holidays", { count: holidays.length, names: [...new Set(holidays.map((h) => (locale === "en" ? h.nameEn : h.nameTr).replace(/ \d+\. gün$| day \d+$/, "")))].join(", ") })}
                </span>
              ) : null}
            </div>
          ) : null}

          <section className="flex flex-col gap-1.5">
            <h3 className="label-caps">{t("sheet.description")}</h3>
            <Textarea
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== (a.description ?? "") && save({ description: description || null })}
              placeholder={t("sheet.descriptionPlaceholder")}
              rows={3}
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="label-caps">{t("sheet.waitsForTitle")}</h3>
              {!readOnly ? (
                <MultiPick
                  label={t("sheet.addDependency")}
                  searchable
                  options={data.activities.filter((x) => x.id !== a.id && !detail.dependents.includes(x.id)).map((x) => ({ id: x.id, label: x.code, hint: x.title }))}
                  value={a.dependsOn}
                  placeholder={t("sheet.addDependency")}
                  onToggle={(id, on) => runAction(on ? addDependencyAction(a.id, id) : removeDependencyAction(a.id, id))}
                  className="h-8 w-auto border-transparent px-2.5 text-[13px] text-ink hover:bg-panel"
                />
              ) : null}
            </div>
            {preds.length ? (
              <ul className="flex flex-col">
                {preds.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 border-b border-line-soft py-1.5 text-[14px] last:border-0">
                    <button type="button" onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline">
                      <span className="w-10 shrink-0 text-[12px] tabular-nums text-muted">{p.code}</span>
                      <span className="truncate">{p.title}</span>
                    </button>
                    <span className={cn("shrink-0 text-[12px]", p.late ? "font-medium text-accent-ink" : "text-muted")}>
                      {p.status === "done" ? t("status.done") : p.endDate ? t("sheet.ends", { date: formatDay(p.endDate, locale, true) }) : t(`status.${p.status}`)}
                    </span>
                    {!readOnly ? (
                      <button type="button" onClick={() => runAction(removeDependencyAction(a.id, p.id))} aria-label={t("sheet.removeDependency", { code: p.code })} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink">
                        <X size={14} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{t("sheet.noDependencies")}</p>
            )}
            {deps.length ? (
              <p className="text-[13px] text-muted">
                {t("sheet.dependents")}{" "}
                {deps.map((d, i) => (
                  <span key={d.id}>
                    {i ? ", " : ""}
                    <button type="button" onClick={() => onOpen(d.id)} className="font-medium text-ink hover:underline">
                      {d.code}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="label-caps">{t("sheet.tasks")}</h3>
              {!readOnly && data.aiReady ? (
                <Button variant="ghost" size="sm" className="h-8 px-2.5" onClick={propose} disabled={proposing} data-testid="activity-prep">
                  <Sparkles size={14} />
                  {proposing ? t("ai.proposing") : t("ai.prepOne")}
                </Button>
              ) : null}
            </div>
            {detail.prep.map((s) => (
              <SuggestionCard key={s.id} s={s} readOnly={readOnly} folderNames={{}} />
            ))}
            {detail.tasks.length ? (
              <ul className="flex flex-col">
                {detail.tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2.5 border-b border-line-soft py-1.5 last:border-0">
                    <Checkbox round checked={task.status === "done"} disabled={readOnly} onCheckedChange={(v) => runAction(setTaskDoneAction(task.id, v === true))} aria-label={task.title} />
                    <a href={`/tasks?open=${task.id}`} className={cn("min-w-0 flex-1 truncate text-[14px] hover:underline", task.status === "done" && "text-muted line-through")}>
                      {task.title}
                    </a>
                    {task.ownerLabel ? <span className="max-w-[90px] shrink-0 truncate text-[12px] text-muted">{task.ownerLabel}</span> : null}
                    {task.dueDate ? <span className={cn("shrink-0 text-[12px]", task.overdue ? "font-medium text-overdue" : "text-muted")}>{relativeDayLabel(task.dueDate, locale, data.today)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : !detail.prep.length ? (
              <p className="text-[13px] text-muted">{t("sheet.noTasks")}</p>
            ) : null}
            {!readOnly ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTask();
                }}
              >
                <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder={t("sheet.taskPlaceholder")} aria-label={t("sheet.taskPlaceholder")} className="h-10 min-w-0 flex-1" data-testid="activity-task-input" />
                <DateButton value={taskDue} onChange={setTaskDue} className="w-[118px] shrink-0" />
                <Button type="submit" size="icon-sm" variant="outline" disabled={!taskTitle.trim()} aria-label={t("sheet.addTask")}>
                  <Plus size={16} />
                </Button>
              </form>
            ) : null}
          </section>

          <LinksPanel self={{ type: "activity", id: a.id }} items={detail.links} readOnly={readOnly} />

          <section className="flex flex-col gap-1.5">
            <h3 className="label-caps">{tc("history")}</h3>
            <ol className="flex flex-col">
              {detail.history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 border-b border-line-soft py-1.5 text-[13px] last:border-0">
                  <span className="text-faint">{formatDateTime(h.at, locale)}</span>
                  <span>{ta.has(h.action as "create") ? ta(h.action as "create") : h.action}</span>
                  {h.actor === "ai" ? (
                    <Badge variant="ai" size="sm">
                      {tc("aiBadge")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
          <p className="flex items-start gap-2 text-[12px] text-faint">
            <Info size={13} className="mt-0.5 shrink-0" />
            {t("sheet.dragTip")}
          </p>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <Button variant="danger" size="sm" onClick={() => trash("activity", a.id, { title: `${a.code} ${a.title}`, onDone: onClose })}>
            <Trash2 size={15} />
            {t("sheet.delete")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The activity side panel, opened from any view through ?open=<id>. */
export function ActivitySheet({ data, readOnly, onClose, onOpen }: { data: WorkplanData; readOnly: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const detail = data.detail;
  return (
    <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && onClose()}>
      {detail ? (
        <SheetContent title={`${detail.activity.code} ${detail.activity.title}`} className="w-[min(520px,100vw)]">
          <Body key={detail.activity.id} detail={detail} data={data} readOnly={readOnly} onClose={onClose} onOpen={onOpen} />
        </SheetContent>
      ) : null}
    </Dialog>
  );
}
