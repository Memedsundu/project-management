"use client";

import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";
import { ArrowUpRight, Check, CornerDownLeft } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createTaskAction, setTaskDoneAction } from "@/app/(app)/tasks/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { parsedToInput } from "@/components/tasks/parse-chips";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { parseTaskInput, type PartnerRef } from "@/lib/parse-task";
import { cn } from "@/lib/utils";

export type TaskState = { title: string; status: string; dueDate: string | null; deleted: boolean };

type EditorEnv = {
  noteId: string;
  today: string;
  partners: PartnerRef[];
  readOnly: boolean;
  tasks: Record<string, TaskState>;
  setTask: (id: string, state: TaskState) => void;
};

export const NoteEditorEnv = createContext<EditorEnv | null>(null);

function useEnv() {
  const env = useContext(NoteEditorEnv);
  if (!env) throw new Error("NoteEditorEnv missing");
  return env;
}

const HREF: Record<string, (id: string) => string> = {
  task: (id) => `/tasks?open=${id}`,
  note: (id) => `/notes/${id}`,
  meeting: (id) => `/meetings/${id}`,
  document: (id) => `/files/d/${id}`,
  folder: (id) => `/files/f/${id}`,
  organisation: (id) => `/partners/${id}`,
  contact: (id) => `/partners/contacts#${id}`,
  indicator: (id) => `/indicators/${id}`,
  activity: (id) => `/workplan?open=${id}`,
  report: (id) => `/reports/${id}`,
  collection: (id) => `/collections/${id}`,
  decision: (id) => `/meetings/decisions#${id}`,
};

export function hrefFor(kind: string, id: string) {
  return (HREF[kind] ?? HREF.note!)(id);
}

/** "@" link to any record: a partner, task, file, meeting, indicator or page (Obsidian-style backlinks). */
export const Mention = createReactInlineContentSpec(
  {
    type: "mention",
    propSchema: { kind: { default: "note" }, id: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const { kind, id, title } = inlineContent.props;
      return (
        <Link
          href={hrefFor(kind, id)}
          contentEditable={false}
          className="mx-px inline-flex items-baseline gap-1 rounded-md bg-panel px-1.5 text-[0.95em] font-medium text-ink no-underline hover:bg-panel-2"
        >
          <EntityIcon type={kind} size={13} className="relative top-[2px] text-muted" />
          {title || "—"}
        </Link>
      );
    },
  },
);

/** A real task inside a page. Ticking it here completes it everywhere. */
export const TaskBlock = createReactBlockSpec(
  {
    type: "task",
    propSchema: { taskId: { default: "" }, title: { default: "" }, done: { default: false } },
    content: "none",
  },
  {
    render: ({ block, editor }) => <TaskBlockView block={block} editor={editor} />,
  },
);

function TaskBlockView({
  block,
  editor,
}: {
  // BlockNote's generic block and editor types are long; this view only needs props and updateBlock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: { id: string; props: { taskId: string; title: string; done: boolean } } & any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
}) {
  const env = useEnv();
  const t = useTranslations("notes.blocks");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isNew = !block.props.taskId;

  // A new task block takes the cursor once the "/" menu has closed.
  useEffect(() => {
    if (!isNew || env.readOnly) return;
    const handle = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(handle);
  }, [isNew, env.readOnly]);
  const { taskId, title, done } = block.props as { taskId: string; title: string; done: boolean };
  const live = taskId ? env.tasks[taskId] : undefined;

  if (!taskId) {
    const create = async () => {
      const text = draft.trim();
      if (!text || busy) return;
      setBusy(true);
      const parsed = parseTaskInput(text, { today: env.today, partners: env.partners });
      const input = parsedToInput(parsed, { locale });
      const res = await runAction(createTaskAction({ ...input, links: [{ type: "note", id: env.noteId }] }));
      setBusy(false);
      if (!res) return;
      env.setTask(res.id, { title: res.title, status: "todo", dueDate: input.dueDate ?? null, deleted: false });
      editor.updateBlock(block, { props: { taskId: res.id, title: res.title, done: false } });
    };
    return (
      <div className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-2" contentEditable={false}>
        <span className="size-[18px] shrink-0 rounded-[5px] border-[1.5px] border-line-strong" aria-hidden />
        <input
          ref={inputRef}
          value={draft}
          disabled={env.readOnly || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
          placeholder={t("taskPlaceholder")}
          aria-label={t("taskPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <span className="hidden items-center gap-1 text-[12px] text-faint sm:flex">
          <CornerDownLeft size={12} /> {t("taskCreate")}
        </span>
      </div>
    );
  }

  const isDone = live ? live.status === "done" : done;
  const shownTitle = live?.title ?? title;
  const due = live?.dueDate ?? null;
  const toggle = async () => {
    if (env.readOnly || busy || live?.deleted) return;
    setBusy(true);
    const next = !isDone;
    const res = await runAction(setTaskDoneAction(taskId, next));
    setBusy(false);
    if (res === undefined) return;
    env.setTask(taskId, { title: shownTitle, status: next ? "done" : "todo", dueDate: due, deleted: false });
    editor.updateBlock(block, { props: { done: next } });
  };

  return (
    <div className="group flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2" contentEditable={false}>
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={shownTitle}
        onClick={toggle}
        disabled={env.readOnly || busy || live?.deleted}
        className={cn(
          "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]",
          isDone ? "border-ink bg-ink text-on-ink" : "border-ink/60 hover:border-ink",
        )}
      >
        {isDone ? <Check size={12} strokeWidth={3} /> : null}
      </button>
      <span className={cn("min-w-0 flex-1 truncate text-[15px]", isDone && "text-muted line-through", live?.deleted && "text-faint")}>{shownTitle}</span>
      {live?.deleted ? <span className="text-[12px] text-faint">{t("taskDeleted")}</span> : null}
      {due && !isDone ? <span className={cn("shrink-0 text-[12.5px]", due < env.today ? "font-medium text-overdue" : "text-muted")}>{relativeDayLabel(due, locale, env.today)}</span> : null}
      <Link href={`/tasks?open=${taskId}`} className="shrink-0 text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus:opacity-100" aria-label={t("openTask")}>
        <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}

/** A card for a file, meeting or sub-page (Notion's page link, Drive's file chip). */
export const EntityCard = createReactBlockSpec(
  {
    type: "entityCard",
    propSchema: { kind: { default: "document" }, id: { default: "" }, title: { default: "" } },
    content: "none",
  },
  {
    render: ({ block }) => {
      const { kind, id, title } = block.props;
      return (
        <Link
          href={hrefFor(kind, id)}
          contentEditable={false}
          className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 no-underline hover:border-ink"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-panel">
            <EntityIcon type={kind} size={16} className="text-ink-2" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{title || "—"}</span>
          <ArrowUpRight size={16} className="shrink-0 text-muted" />
        </Link>
      );
    },
  },
);

export const noteSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, task: TaskBlock(), entityCard: EntityCard() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: Mention },
});

export type NoteEditor = typeof noteSchema.BlockNoteEditor;
