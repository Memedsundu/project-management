"use client";

import { AlarmClock, ArrowRight, CalendarDays, Flag, ListChecks, Repeat, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/controls";
import { daysBetween, relativeDayLabel, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TaskItem } from "./types";

export function priorityTone(p: number) {
  return p === 1 ? "text-accent" : p === 2 ? "text-ink" : p === 3 ? "text-muted" : "text-faint";
}

export function TaskMeta({ task, showOwner = true, partnerNames }: { task: TaskItem; showOwner?: boolean; partnerNames?: Map<string, string> }) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const today = todayStr();
  const parts: React.ReactNode[] = [];
  const done = task.status === "done";
  if (task.startDate && task.startDate > today && task.dueDate !== task.startDate) {
    parts.push(
      <span key="start" className="inline-flex items-center gap-1">
        <CalendarDays size={12} />
        {t("starts", { date: relativeDayLabel(task.startDate, locale, today) })}
      </span>,
    );
  }
  if (task.dueDate) {
    const late = task.overdue && !done;
    parts.push(
      <span key="due" className={cn("inline-flex items-center gap-1", late && "font-medium text-overdue")}>
        <CalendarDays size={12} />
        {late
          ? `${t("overdueBy", { days: daysBetween(task.dueDate, today) })} · ${relativeDayLabel(task.dueDate, locale, today)}`
          : task.startDate && task.startDate > today
            ? t("due", { date: relativeDayLabel(task.dueDate, locale, today) })
            : relativeDayLabel(task.dueDate, locale, today)}
        {task.dueTime ? ` · ${task.dueTime}` : ""}
      </span>,
    );
  }
  if (task.recurrence) {
    parts.push(
      <span key="rec" className="inline-flex items-center gap-1">
        <Repeat size={12} />
        {task.recurrenceLabel}
      </span>,
    );
  }
  if (showOwner && task.ownerKind !== "me" && task.ownerLabel) {
    parts.push(
      <span key="owner" className="inline-flex items-center gap-1 font-medium text-ink-2">
        <ArrowRight size={12} />
        {task.ownerLabel}
      </span>,
    );
  }
  if (partnerNames) {
    for (const id of task.orgIds) {
      if (id === task.ownerOrgId) continue;
      const name = partnerNames.get(id);
      if (name) parts.push(<span key={`org-${id}`}>{name}</span>);
    }
  }
  if (task.subtaskCount) {
    parts.push(
      <span key="subs" className="inline-flex items-center gap-1">
        <ListChecks size={12} />
        {task.subtaskDone}/{task.subtaskCount}
      </span>,
    );
  }
  if (task.estimateMin) {
    parts.push(
      <span key="est" className="inline-flex items-center gap-1">
        <Timer size={12} />
        {t("minutes", { n: task.estimateMin })}
      </span>,
    );
  }
  if (task.reminderAt && !done) {
    parts.push(<AlarmClock key="rem" size={12} aria-label={t("reminder")} />);
  }
  for (const tag of task.tags) parts.push(<span key={`tag-${tag.slug}`}>#{tag.name}</span>);
  if (!parts.length) return null;
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">{parts}</div>;
}

export function TaskRow({
  task,
  selected,
  focused,
  onToggleDone,
  onOpen,
  onSelect,
  showOwner = true,
  partnerNames,
  draggable,
  onDragStart,
  readOnly,
}: {
  task: TaskItem;
  selected?: boolean;
  focused?: boolean;
  onToggleDone: (task: TaskItem, done: boolean) => void;
  onOpen: (task: TaskItem) => void;
  onSelect?: (task: TaskItem, additive: boolean) => void;
  showOwner?: boolean;
  partnerNames?: Map<string, string>;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, task: TaskItem) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("tasks");
  const done = task.status === "done";
  return (
    <div
      role="row"
      aria-selected={selected}
      data-task-id={task.id}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, task)}
      onClick={(e) => {
        if ((e.metaKey || e.ctrlKey || e.shiftKey) && onSelect) {
          e.preventDefault();
          onSelect(task, true);
          return;
        }
        onOpen(task);
      }}
      className={cn(
        "group flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
        selected ? "bg-accent-soft/70" : focused ? "bg-panel" : "hover:bg-panel/70",
        focused && "ring-1 ring-line-strong",
      )}
    >
      <span className="pt-0.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          round
          checked={done}
          disabled={readOnly}
          onCheckedChange={(v) => onToggleDone(task, v === true)}
          aria-label={done ? t("reopen") : t("complete")}
          className={cn(task.priority === 1 && !done && "border-accent")}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-[15px] leading-snug", done && "text-muted line-through")}>
          {task.title}
          {task.priority < 4 && !done ? <Flag size={12} className={cn("ml-1.5 inline -translate-y-px", priorityTone(task.priority))} aria-label={`p${task.priority}`} /> : null}
        </span>
        <TaskMeta task={task} showOwner={showOwner} partnerNames={partnerNames} />
      </div>
    </div>
  );
}
