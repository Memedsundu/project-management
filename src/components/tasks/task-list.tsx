"use client";

import { CalendarDays, CheckCheck, Flag, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { restoreManyAction, trashManyAction } from "@/app/actions/common";
import { bulkUpdateTasksAction, updateTaskAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { DatePanel } from "./date-menu";
import { priorityTone, TaskRow } from "./task-row";
import type { TaskItem } from "./types";
import { useTaskOps } from "./use-task-ops";

export type TaskGroup = { key: string; label: React.ReactNode; items: TaskItem[]; empty?: React.ReactNode; action?: React.ReactNode };

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * Grouped task list with the keyboard moves of Things and Superhuman:
 * J/K to move, X to select, Enter to open, E to complete, D for a date,
 * 1–4 (or P to cycle) for priority. Selected rows get a bulk bar.
 */
export function TaskList({
  groups,
  partnerNames,
  showOwner = true,
  readOnly,
  keyboard = true,
  hideEmptyGroups,
}: {
  groups: TaskGroup[];
  partnerNames?: Map<string, string>;
  showOwner?: boolean;
  readOnly?: boolean;
  keyboard?: boolean;
  hideEmptyGroups?: boolean;
}) {
  const t = useTranslations("tasks");
  const ops = useTaskOps();
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneLocal, setDoneLocal] = useState<Record<string, boolean>>({});
  const [dateFor, setDateFor] = useState<string[] | null>(null);

  // Forget local state for rows that left the list after a refresh.
  const idsKey = flat.map((x) => x.id).join(",");
  const [seenIds, setSeenIds] = useState(idsKey);
  if (seenIds !== idsKey) {
    setSeenIds(idsKey);
    const ids = new Set(flat.map((x) => x.id));
    setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
    setDoneLocal({});
  }

  const toggleDone = useCallback(
    async (task: TaskItem, done: boolean) => {
      setDoneLocal((m) => ({ ...m, [task.id]: done }));
      const ok = await ops.toggleDone(task, done);
      if (!ok) setDoneLocal((m) => ({ ...m, [task.id]: !done }));
    },
    [ops],
  );

  const select = useCallback((task: TaskItem) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(task.id)) n.delete(task.id);
      else n.add(task.id);
      return n;
    });
  }, []);

  const targets = useCallback(() => (selected.size ? [...selected] : focus ? [focus] : []), [selected, focus]);

  const setPriority = useCallback(
    async (ids: string[], priority: number) => {
      if (!ids.length) return;
      if (ids.length === 1) await runAction(updateTaskAction(ids[0]!, { priority }));
      else await runAction(bulkUpdateTasksAction(ids, { priority }), { success: t("bulk.updated", { count: ids.length }) });
    },
    [t],
  );

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (document.querySelector("[role=dialog]")) return;
      const idx = focus ? flat.findIndex((x) => x.id === focus) : -1;
      const move = (d: number) => {
        if (!flat.length) return;
        const next = flat[Math.max(0, Math.min(flat.length - 1, idx < 0 ? 0 : idx + d))]!;
        setFocus(next.id);
        document.querySelector(`[data-task-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const current = idx >= 0 ? flat[idx]! : null;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "x":
          if (current) {
            e.preventDefault();
            select(current);
          }
          break;
        case "Enter":
          if (current) {
            e.preventDefault();
            ops.open(current);
          }
          break;
        case "e":
          if (current && !readOnly) {
            e.preventDefault();
            toggleDone(current, !(doneLocal[current.id] ?? current.status === "done"));
          }
          break;
        case "d":
          if (!readOnly && targets().length) {
            e.preventDefault();
            setDateFor(targets());
          }
          break;
        case "p":
          if (current && !readOnly) {
            e.preventDefault();
            setPriority(targets(), current.priority === 1 ? 4 : current.priority - 1);
          }
          break;
        case "1":
        case "2":
        case "3":
        case "4":
          if (!readOnly && targets().length) {
            e.preventDefault();
            setPriority(targets(), Number(e.key));
          }
          break;
        case "Escape":
          setSelected(new Set());
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, flat, focus, ops, readOnly, select, toggleDone, doneLocal, targets, setPriority]);

  const selIds = [...selected];

  return (
    <div className="flex flex-col gap-7" role="grid" aria-multiselectable>
      {groups.map((g) => {
        if (hideEmptyGroups && g.items.length === 0) return null;
        return (
          <section key={g.key} className="flex flex-col gap-1" aria-label={typeof g.label === "string" ? g.label : undefined}>
            <div className="flex items-baseline justify-between gap-3 px-3 pb-1">
              <h2 className="text-[17px] font-semibold">
                {g.label}
                {g.items.length ? <span className="ml-2 text-[13px] font-normal text-muted">{g.items.length}</span> : null}
              </h2>
              {g.action}
            </div>
            {g.items.length === 0 ? (
              g.empty ? <p className="px-3 py-2 text-[14px] text-muted">{g.empty}</p> : null
            ) : (
              <div className="flex flex-col">
                {g.items.map((task) => {
                  const localDone = doneLocal[task.id];
                  const item = localDone === undefined ? task : { ...task, status: localDone ? "done" : task.status === "done" ? "todo" : task.status };
                  return (
                    <TaskRow
                      key={task.id}
                      task={item}
                      focused={focus === task.id}
                      selected={selected.has(task.id)}
                      onToggleDone={toggleDone}
                      onOpen={(x) => {
                        setFocus(x.id);
                        ops.open(x);
                      }}
                      onSelect={select}
                      showOwner={showOwner}
                      partnerNames={partnerNames}
                      readOnly={readOnly}
                    />
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {selIds.length ? <BulkBar ids={selIds} onClear={() => setSelected(new Set())} onDate={() => setDateFor(selIds)} onPriority={(p) => setPriority(selIds, p)} /> : null}

      <Dialog open={Boolean(dateFor)} onOpenChange={(v) => !v && setDateFor(null)}>
        {dateFor ? (
          <DialogContent title={t("bulk.setDate")} className="max-w-[320px]">
            <DatePanel
              value={null}
              onChange={async (d) => {
                const ids = dateFor;
                setDateFor(null);
                if (ids.length === 1) await runAction(updateTaskAction(ids[0]!, { dueDate: d }));
                else await runAction(bulkUpdateTasksAction(ids, { dueDate: d }), { success: t("bulk.updated", { count: ids.length }) });
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function BulkBar({ ids, onClear, onDate, onPriority }: { ids: string[]; onClear: () => void; onDate: () => void; onPriority: (p: number) => void }) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  return (
    <div className="no-print fixed inset-x-0 bottom-20 z-40 flex justify-center px-3 lg:bottom-6">
      <div className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-bg px-2 py-1.5 shadow-[var(--shadow)]" role="toolbar" aria-label={tc("selectedCount", { count: ids.length })}>
        <span className="px-3 text-[14px] font-medium">{tc("selectedCount", { count: ids.length })}</span>
        <Button variant="ghost" size="sm" onClick={onDate}>
          <CalendarDays size={15} />
          {t("bulk.setDate")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <Flag size={15} />
              {t("bulk.setPriority")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {[1, 2, 3, 4].map((p) => (
              <DropdownMenuItem key={p} onSelect={() => onPriority(p)}>
                <Flag size={14} className={priorityTone(p)} />
                {t(`priority.${p}` as "priority.1")}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            const res = await runAction(bulkUpdateTasksAction(ids, { status: "done" }), { success: t("bulk.updated", { count: ids.length }) });
            if (res) onClear();
          }}
        >
          <CheckCheck size={15} />
          {t("bulk.complete")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger"
          onClick={async () => {
            const res = await runAction(trashManyAction("task", ids));
            if (!res) return;
            onClear();
            toast(tc("movedToTrash"), {
              duration: 6000,
              action: { label: tc("undo"), onClick: () => runAction(restoreManyAction("task", ids)) },
            });
          }}
        >
          <Trash2 size={15} />
          {t("bulk.delete")}
        </Button>
        <button type="button" onClick={onClear} aria-label={t("bulk.clear")} className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink")}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

