"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateTaskAction } from "@/app/(app)/tasks/actions";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { TaskRow } from "./task-row";
import type { TaskItem } from "./types";
import { useTaskOps } from "./use-task-ops";

const COLUMNS = ["todo", "doing", "waiting", "done"] as const;
type Col = (typeof COLUMNS)[number];

/** Pano: drag a card between Yapılacak, Yapılıyor, Bekliyor and Tamamlandı (Trello). */
export function TaskBoard({
  columns,
  partnerNames,
  readOnly,
}: {
  columns: Record<Col, TaskItem[]>;
  partnerNames?: Map<string, string>;
  readOnly?: boolean;
}) {
  const t = useTranslations("tasks");
  const ops = useTaskOps();
  const [moved, setMoved] = useState<Record<string, Col>>({});
  const [over, setOver] = useState<Col | null>(null);

  const key = COLUMNS.map((c) => columns[c].map((x) => x.id + x.status).join(",")).join("|");
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setMoved({});
  }

  const all = COLUMNS.flatMap((c) => columns[c]);
  const view: Record<Col, TaskItem[]> = { todo: [], doing: [], waiting: [], done: [] };
  for (const task of all) {
    const col = moved[task.id] ?? (task.status as Col);
    if (view[col]) view[col].push(moved[task.id] ? { ...task, status: col } : task);
  }

  const drop = async (col: Col, id: string) => {
    const task = all.find((x) => x.id === id);
    if (!task || (moved[id] ?? task.status) === col) return;
    setMoved((m) => ({ ...m, [id]: col }));
    const ok = await runAction(updateTaskAction(id, { status: col }));
    if (ok === undefined) setMoved((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      <div className="grid min-w-[880px] grid-cols-4 gap-4">
        {COLUMNS.map((col) => (
          <section
            key={col}
            aria-label={t(`status.${col}`)}
            onDragOver={(e) => {
              if (readOnly) return;
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/task-id");
              if (id) drop(col, id);
            }}
            className={cn("flex min-h-[320px] flex-col gap-1 rounded-2xl bg-panel p-2 transition-colors", over === col && "ring-2 ring-ink")}
          >
            <h2 className="flex items-baseline justify-between px-2 pb-1 pt-1.5 text-[15px] font-semibold">
              {t(`status.${col}`)}
              <span className="text-[13px] font-normal text-muted">{view[col].length}</span>
            </h2>
            {view[col].map((task) => (
              <div key={task.id} className="rounded-xl bg-bg shadow-[0_1px_0_var(--line)]">
                <TaskRow
                  task={task}
                  draggable={!readOnly}
                  onDragStart={(e, x) => {
                    e.dataTransfer.setData("text/task-id", x.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onToggleDone={(x, done) => drop(done ? "done" : "todo", x.id)}
                  onOpen={ops.open}
                  partnerNames={partnerNames}
                  readOnly={readOnly}
                />
                {!readOnly ? (
                  <label className="sr-only">
                    {t("moveTo")}
                    <select value={task.status} onChange={(e) => drop(e.target.value as Col, task.id)}>
                      {COLUMNS.map((c) => (
                        <option key={c} value={c}>
                          {t(`status.${c}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ))}
            {view[col].length === 0 ? <p className="px-2 py-3 text-[13px] text-faint">{t("boardEmpty")}</p> : null}
          </section>
        ))}
      </div>
    </div>
  );
}
