"use client";

import { Flag, Plus, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useContext, useState } from "react";
import { toast } from "sonner";
import { createTaskAction, setTaskDoneAction, splitTaskAction, updateTaskAction } from "@/app/(app)/tasks/actions";
import { LinksPanel, type LinkItem } from "@/components/common/links-panel";
import { TagEditor } from "@/components/common/tag-editor";
import { useTrash } from "@/components/common/use-trash";
import { ShellContext } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatDateTime, relativeDayLabel } from "@/lib/dates";
import { describeRule, parseTaskInput } from "@/lib/parse-task";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { DateButton } from "./date-menu";
import { ExtractTasksDialog, type Proposal } from "./extract-dialog";
import { priorityTone } from "./task-row";
import type { ContactOption, OrgOption, TaskItem } from "./types";

export type HistoryRow = { id: string; at: string; action: string; actor: string; summary: string | null };

export function TaskDetail({
  task,
  orgs,
  contacts,
  links,
  history,
  source,
  readOnly,
  onClose,
}: {
  task: TaskItem;
  orgs: OrgOption[];
  contacts: ContactOption[];
  links: LinkItem[];
  history: HistoryRow[];
  source: { title: string; href: string; type: string } | null;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const ta = useTranslations("common.actions");
  const locale = useLocale();
  const trash = useTrash();
  const shell = useContext(ShellContext);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [repeat, setRepeat] = useState(task.recurrenceLabel ?? "");
  const [subTitle, setSubTitle] = useState("");
  const [steps, setSteps] = useState<Proposal[] | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [seen, setSeen] = useState(task.id + task.title + (task.notes ?? ""));
  const key = task.id + task.title + (task.notes ?? "");
  if (seen !== key) {
    setSeen(key);
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setRepeat(task.recurrenceLabel ?? "");
  }

  const save = (patch: Parameters<typeof updateTaskAction>[1]) => runAction(updateTaskAction(task.id, patch));
  const done = task.status === "done";
  const ownerMode = task.ownerKind === "organisation" ? "org" : task.ownerKind === "contact" || task.ownerKind === "person" ? "person" : "me";
  const repeatParsed = repeat.trim() && repeat !== task.recurrenceLabel ? parseTaskInput(repeat, { today: task.dueDate ?? new Date().toISOString().slice(0, 10) }).recurrence : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="pt-1.5">
          <Checkbox
            round
            checked={done}
            disabled={readOnly}
            onCheckedChange={async (v) => {
              const res = await runAction(setTaskDoneAction(task.id, v === true));
              if (res?.spawnedDue) toast(t("nextCreated", { date: relativeDayLabel(res.spawnedDue, locale) }));
            }}
            aria-label={done ? t("reopen") : t("complete")}
          />
        </span>
        <textarea
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
          rows={Math.min(4, Math.ceil(title.length / 38) || 1)}
          className={cn("flex-1 resize-none bg-transparent text-[20px] font-semibold leading-snug outline-none", done && "text-muted line-through")}
          aria-label={tc("title")}
        />
        <button type="button" onClick={onClose} aria-label={tc("close")} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-2.5 text-[14px]">
            <span className="text-muted">{tc("status")}</span>
            <Select value={task.status} disabled={readOnly} onChange={(e) => save({ status: e.target.value as "todo" })} className="h-10">
              {(["todo", "doing", "waiting", "done", "canceled"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>

            <span className="text-muted">{t("tokens.start")}</span>
            <DateButton value={task.startDate} onChange={(d) => save({ startDate: d })} disabled={readOnly} />

            <span className="text-muted">{t("tokens.date")}</span>
            <div className="flex items-center gap-2">
              <DateButton value={task.dueDate} onChange={(d) => save({ dueDate: d })} disabled={readOnly} overdue={task.overdue} />
              <Input
                type="time"
                value={task.dueTime ?? ""}
                disabled={readOnly}
                onChange={(e) => save({ dueTime: e.target.value || null })}
                className="h-10 w-[110px]"
                aria-label={t("time")}
              />
            </div>

            <span className="text-muted">{tc("priority")}</span>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={readOnly}
                  onClick={() => save({ priority: p })}
                  aria-pressed={task.priority === p}
                  title={t(`priority.${p}` as "priority.1")}
                  className={cn(
                    "inline-flex h-9 w-11 items-center justify-center gap-1 rounded-full border text-[13px]",
                    task.priority === p ? "border-ink bg-panel" : "border-line-strong hover:border-ink",
                  )}
                >
                  <Flag size={13} className={priorityTone(p)} />
                  {p < 4 ? p : "–"}
                </button>
              ))}
            </div>

            <span className="text-muted">{t("owner")}</span>
            <div className="flex flex-col gap-2">
              <div className="flex gap-1.5">
                {(["me", "org", "person"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={ownerMode === m}
                    onClick={() => {
                      if (m === "me") save({ ownerKind: "me" });
                      if (m === "org" && orgs[0]) save({ ownerOrgId: task.ownerOrgId ?? orgs[0].id });
                      if (m === "person") save({ ownerName: task.ownerName || "?" });
                    }}
                    className={cn("h-9 rounded-full border px-3 text-[13px]", ownerMode === m ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:border-ink")}
                  >
                    {m === "me" ? t("ownerMe") : m === "org" ? t("ownerOrg") : t("ownerPerson")}
                  </button>
                ))}
              </div>
              {ownerMode === "org" ? (
                <Select value={task.ownerOrgId ?? ""} disabled={readOnly} onChange={(e) => save({ ownerOrgId: e.target.value })} className="h-10">
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.shortName || o.name}
                    </option>
                  ))}
                </Select>
              ) : null}
              {ownerMode === "person" ? (
                <div className="flex gap-2">
                  <Select
                    value={task.ownerContactId ?? ""}
                    disabled={readOnly}
                    onChange={(e) => (e.target.value ? save({ ownerContactId: e.target.value }) : undefined)}
                    className="h-10 flex-1"
                  >
                    <option value="">{task.ownerName && task.ownerKind === "person" ? task.ownerName : t("ownerPersonPlaceholder")}</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    defaultValue={task.ownerKind === "person" ? (task.ownerName ?? "") : ""}
                    placeholder={t("ownerPersonPlaceholder")}
                    disabled={readOnly}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== task.ownerName && save({ ownerName: e.target.value.trim() })}
                    className="h-10 flex-1"
                  />
                </div>
              ) : null}
            </div>

            <span className="text-muted">{t("repeat")}</span>
            <div className="flex flex-col gap-1">
              <Input
                value={repeat}
                disabled={readOnly}
                onChange={(e) => setRepeat(e.target.value)}
                onBlur={() => {
                  if (!repeat.trim() && task.recurrence) save({ recurrence: null });
                  else if (repeatParsed) save({ recurrence: repeatParsed, recurrenceLabel: describeRule(repeatParsed, locale === "en" ? "en" : "tr") });
                }}
                placeholder={t("repeatPlaceholder")}
                className="h-10"
              />
              {repeat.trim() && repeat !== task.recurrenceLabel ? (
                <span className={cn("text-[12px]", repeatParsed ? "text-muted" : "text-overdue")}>
                  {repeatParsed ? describeRule(repeatParsed, locale === "en" ? "en" : "tr") : t("repeatUnknown")}
                </span>
              ) : null}
            </div>

            <span className="text-muted">{t("estimate")}</span>
            <Select
              value={String(task.estimateMin ?? "")}
              disabled={readOnly}
              onChange={(e) => save({ estimateMin: e.target.value ? Number(e.target.value) : null })}
              className="h-10"
            >
              <option value="">—</option>
              {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? t("minutes", { n: m }) : `${m / 60} ${locale === "en" ? "h" : "sa"}`}
                </option>
              ))}
            </Select>

            <span className="text-muted">{t("reminder")}</span>
            <Input
              type="datetime-local"
              disabled={readOnly}
              defaultValue={task.reminderAt ? toLocalInput(task.reminderAt) : ""}
              onBlur={(e) => save({ reminderAt: e.target.value ? new Date(e.target.value) : null })}
              className="h-10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("notes")}</Label>
            <Textarea
              value={notes}
              disabled={readOnly}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (task.notes ?? "") && save({ notes: notes || null })}
              placeholder={t("notesPlaceholder")}
              className="min-h-28"
            />
          </div>

          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <h3 className="label-caps">{t("subtasks")}</h3>
              {!readOnly && shell?.aiConfigured ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  disabled={splitting}
                  onClick={async () => {
                    setSplitting(true);
                    const res = await runAction(splitTaskAction(task.id));
                    setSplitting(false);
                    if (res) setSteps(res.map((s) => ({ ...s, keep: true })));
                  }}
                >
                  <Sparkles size={14} className="text-accent" />
                  {splitting ? tc("working") : t("splitWithAi")}
                </Button>
              ) : null}
            </div>
            <ul className="flex flex-col">
              {(task.subtasks ?? []).map((s) => (
                <li key={s.id} className="flex min-h-10 items-center gap-3 border-b border-line-soft last:border-0">
                  <Checkbox round checked={s.status === "done"} disabled={readOnly} onCheckedChange={(v) => runAction(setTaskDoneAction(s.id, v === true))} aria-label={s.title} />
                  <Link href={`/tasks?open=${s.id}`} className={cn("flex-1 text-[14px] hover:underline", s.status === "done" && "text-muted line-through")}>
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
            {!readOnly ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!subTitle.trim()) return;
                  await runAction(createTaskAction({ title: subTitle.trim(), parentId: task.id }));
                  setSubTitle("");
                }}
                className="flex items-center gap-2"
              >
                <Plus size={16} className="text-muted" />
                <input
                  value={subTitle}
                  onChange={(e) => setSubTitle(e.target.value)}
                  placeholder={t("addSubtask")}
                  className="h-10 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
                  aria-label={t("addSubtask")}
                />
              </form>
            ) : null}
          </section>

          <div className="flex flex-col gap-1.5">
            <h3 className="label-caps">{tc("tags")}</h3>
            <TagEditor self={{ type: "task", id: task.id }} initial={task.tags} readOnly={readOnly} />
          </div>

          {source ? (
            <div className="flex items-center gap-2 text-[14px]">
              <span className="text-muted">{t("source")}:</span>
              <Link href={source.href} className="underline-offset-4 hover:underline">
                {source.title}
              </Link>
            </div>
          ) : null}

          <LinksPanel self={{ type: "task", id: task.id }} items={links} readOnly={readOnly} />

          <section className="flex flex-col gap-1.5">
            <h3 className="label-caps">{tc("history")}</h3>
            <ol className="flex flex-col">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 border-b border-line-soft py-1.5 text-[13px] last:border-0">
                  <span className="text-faint">{formatDateTime(h.at, locale)}</span>
                  <span>{ta.has(h.action as "create") ? ta(h.action as "create") : h.action}</span>
                  {h.summary ? <span className="text-muted">· {h.summary}</span> : null}
                  {h.actor === "ai" ? (
                    <Badge variant="ai" size="sm">
                      {tc("aiBadge")}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <Button variant="danger" size="sm" onClick={() => trash("task", task.id, { title: task.title, onDone: onClose })}>
            <Trash2 size={15} />
            {t("deleteTask")}
          </Button>
          <span className="text-[12px] text-faint">{formatDateTime(task.createdAt, locale)}</span>
        </div>
      ) : null}

      {steps ? (
        <ExtractTasksDialog
          open
          onOpenChange={(v) => !v && setSteps(null)}
          title={t("splitWithAi")}
          proposals={steps}
          source={{ type: "task", id: task.id }}
          onDone={() => setSteps(null)}
        />
      ) : null}
    </div>
  );
}

function toLocalInput(v: Date | string) {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
