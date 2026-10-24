"use client";

import { CalendarDays, LayoutTemplate, NotebookPen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createPageAction } from "@/app/(app)/notes/actions";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/card";
import { formatLongDay, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { NewPageMenu, type TemplateOption } from "./new-page-menu";

export type HomeNote = { id: string; title: string; icon: string | null; preview: string; updatedDay: string };
export type HomeDaily = { id: string; day: string; preview: string };

/** Notlar home: what she touched last, the daily notes, and templates to start from. */
export function NotesHome({ recent, daily, templates, today }: { recent: HomeNote[]; daily: HomeDaily[]; templates: TemplateOption[]; today: string }) {
  const t = useTranslations("notes.home");
  const locale = useLocale();
  const router = useRouter();
  const { readOnly } = useShell();
  useScreenContext({ kind: "notes", title: t("title") });

  const fromTemplate = async (tpl: TemplateOption) => {
    const res = await runAction(createPageAction({ templateId: tpl.id, title: tpl.name }));
    if (res) router.push(`/notes/${res.id}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-10">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          !readOnly ? (
            <NewPageMenu
              templates={templates}
              parentId={null}
              onCreated={(id) => router.push(`/notes/${id}`)}
              trigger={
                <Button>
                  <Plus size={16} />
                  {t("newPage")}
                </Button>
              }
            />
          ) : null
        }
      />

      <Link href="/notes/daily" className="flex items-center gap-4 rounded-2xl border border-line px-5 py-4 hover:border-ink">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-panel">
          <CalendarDays size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[16px] font-semibold">{t("dailyTitle")}</span>
          <span className="text-[14px] text-muted">{formatLongDay(today, locale)}</span>
        </span>
        <span className="text-[14px] text-muted">{t("open")} →</span>
      </Link>

      <section className="flex flex-col gap-3" aria-labelledby="recent-notes">
        <SectionTitle id="recent-notes">{t("recent")}</SectionTitle>
        {recent.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((n) => (
              <li key={n.id}>
                <Link href={`/notes/${n.id}`} className="flex h-full flex-col gap-1.5 rounded-2xl border border-line px-4 py-3.5 hover:border-ink">
                  <span className="flex items-center gap-2">
                    {n.icon ? <span className="text-[16px]">{n.icon}</span> : <NotebookPen size={16} className="text-muted" />}
                    <span className="truncate text-[15px] font-medium">{n.title || t("untitled")}</span>
                  </span>
                  {n.preview ? <span className="line-clamp-2 text-[13px] text-muted">{n.preview}</span> : null}
                  <span className="mt-auto pt-1 text-[12px] text-faint">{relativeDayLabel(n.updatedDay, locale, today)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("emptyTitle")} body={t("emptyBody")} />
        )}
      </section>

      {daily.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="daily-notes">
          <SectionTitle id="daily-notes">{t("dailyList")}</SectionTitle>
          <ul className="flex flex-col">
            {daily.map((d) => (
              <li key={d.id} className="border-b border-line-soft last:border-0">
                <Link href={`/notes/${d.id}`} className="flex min-h-12 items-center gap-4 py-2 hover:underline">
                  <span className="w-40 shrink-0 text-[14px] font-medium">{formatLongDay(d.day, locale)}</span>
                  <span className="truncate text-[14px] text-muted">{d.preview || "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {templates.length && !readOnly ? (
        <section className="flex flex-col gap-3" aria-labelledby="note-templates">
          <SectionTitle id="note-templates">{t("templates")}</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <button type="button" onClick={() => fromTemplate(tpl)} className="flex h-full w-full flex-col items-start gap-1.5 rounded-2xl bg-panel px-4 py-3.5 text-left hover:bg-panel-2">
                  <span className="flex items-center gap-2 text-[15px] font-medium">
                    <LayoutTemplate size={15} className="text-muted" />
                    {tpl.name}
                  </span>
                  {tpl.description ? <span className="line-clamp-2 text-[13px] text-muted">{tpl.description}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
