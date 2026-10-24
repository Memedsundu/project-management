"use client";

import { FileSearch, NotebookPen, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { updateNoteAction } from "@/app/(app)/notes/actions";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { TaskList } from "@/components/tasks/task-list";
import { TaskSheet, type TaskSheetData } from "@/components/tasks/task-sheet";
import type { ContactOption, OrgOption, TaskItem } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/card";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { SuggestionCard, type InboxSuggestion } from "./suggestion-card";

export type InboxProps = {
  tasks: TaskItem[];
  notes: { id: string; title: string; preview: string; createdAt: string }[];
  suggestions: InboxSuggestion[];
  filesToCheck: number;
  flagged: number;
  folderNames: Record<string, string>;
  orgs: OrgOption[];
  contacts: ContactOption[];
  detail: TaskSheetData | null;
};

/** Things' Inbox: captures without a home, files to check and Claude's proposals, until she decides. */
export function InboxScreen(props: InboxProps) {
  const t = useTranslations("inbox");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const trash = useTrash();
  useScreenContext({ kind: "inbox", title: t("title") });
  const partnerNames = new Map(props.orgs.map((o) => [o.id, o.shortName || o.name]));
  const empty = !props.tasks.length && !props.notes.length && !props.suggestions.length && !props.filesToCheck && !props.flagged;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {empty ? <EmptyState title={t("empty.title")} body={t("empty.body")} /> : null}

      {props.flagged || props.filesToCheck ? (
        <section className="flex flex-col gap-2">
          {props.flagged ? (
            <Link href="/files/check?tab=flagged" className="flex items-start gap-3 rounded-2xl bg-accent-soft px-5 py-4 text-accent-ink hover:brightness-[0.98]">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{t("flagged.title", { count: props.flagged })}</span>
                <span className="text-[14px]">{t("flagged.body")}</span>
              </span>
            </Link>
          ) : null}
          {props.filesToCheck ? (
            <Link href="/files/check" className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4 hover:border-ink">
              <FileSearch size={18} className="shrink-0 text-muted" />
              <span className="flex-1 text-[15px]">{t("filesToCheck", { count: props.filesToCheck })}</span>
              <span className="text-[14px] text-muted">{tc("open")} →</span>
            </Link>
          ) : null}
        </section>
      ) : null}

      {props.suggestions.length ? (
        <section aria-labelledby="sugg" className="flex flex-col gap-3">
          <SectionTitle id="sugg">{t("suggestions", { count: props.suggestions.length })}</SectionTitle>
          {props.suggestions.map((s) => (
            <SuggestionCard key={s.id} s={s} readOnly={shell.readOnly} folderNames={props.folderNames} />
          ))}
        </section>
      ) : null}

      {props.tasks.length ? (
        <section aria-labelledby="captured" className="flex flex-col gap-3">
          <SectionTitle id="captured">{t("tasks", { count: props.tasks.length })}</SectionTitle>
          <p className="text-[14px] text-muted">{t("tasksHint")}</p>
          <TaskList partnerNames={partnerNames} readOnly={shell.readOnly} groups={[{ key: "inbox", label: "", items: props.tasks }]} />
        </section>
      ) : null}

      {props.notes.length ? (
        <section aria-labelledby="notes" className="flex flex-col gap-3">
          <SectionTitle id="notes">{t("notes", { count: props.notes.length })}</SectionTitle>
          <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line">
            {props.notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <NotebookPen size={16} className="mt-1 shrink-0 text-muted" />
                <Link href={`/notes/${n.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-medium">{n.title || tc("untitled")}</span>
                  {n.preview ? <span className="line-clamp-2 text-[14px] text-muted">{n.preview}</span> : null}
                  <span className="text-[12px] text-faint">{relativeDayLabel(n.createdAt.slice(0, 10), locale)}</span>
                </Link>
                {!shell.readOnly ? (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => runAction(updateNoteAction(n.id, { inbox: false }), { success: t("noteKept") })}>
                      {t("keepNote")}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label={tc("delete")} onClick={() => trash("note", n.id, { title: n.title })}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TaskSheet detail={props.detail} orgs={props.orgs} contacts={props.contacts} />
    </div>
  );
}
