"use client";

import { ListChecks, MoreHorizontal, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createNextInSeriesAction, updateSeriesAction } from "@/app/(app)/meetings/actions";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { dayOf } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { SeriesPageData } from "@/server/views/meetings";
import { DecisionList } from "./decisions-screen";
import { repeatOptions } from "./meeting-form";
import { MeetingListRow } from "./meetings-screen";

/** A recurring meeting (Fellow): every occurrence, what carries over, and what was decided. */
export function SeriesScreen({ data }: { data: SeriesPageData }) {
  const t = useTranslations("meetings.seriesPage");
  const tm = useTranslations("meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const shell = useShell();
  const trash = useTrash();
  const [now] = useState(() => Date.now());
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState(data.series.title);
  const { series } = data;
  useScreenContext({ kind: "series", id: series.id, title: series.title });

  const upcoming = data.meetings.filter((m) => new Date(m.endsAt ?? m.startsAt).getTime() >= now);
  const past = data.meetings.filter((m) => new Date(m.endsAt ?? m.startsAt).getTime() < now).reverse();
  const org = data.orgs.find((o) => o.id === series.organisationId);
  const anchorDay = data.meetings.at(-1) ? dayOf(data.meetings.at(-1)!.startsAt) : data.today;
  const createNext = async () => {
    const res = await runAction(createNextInSeriesAction(series.id));
    if (res) router.push(`/meetings/${res.id}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        compact
        eyebrow={
          <nav className="flex flex-wrap items-center gap-1" aria-label={tm("page.breadcrumb")}>
            <Link href="/meetings" className="hover:text-ink">
              {tm("title")}
            </Link>
            <span aria-hidden>/</span>
            <Link href="/meetings?tab=series" className="hover:text-ink">
              {tm("tabs.series")}
            </Link>
          </nav>
        }
        title={
          <span className="flex items-start gap-3">
            <Repeat size={24} className="mt-1.5 shrink-0 text-muted" />
            <span className="min-w-0 break-words">{series.title}</span>
          </span>
        }
        subtitle={[series.recurrenceLabel ?? t("noRule"), org ? org.shortName || org.name : null, tm("series.count", { count: data.meetings.length })].filter(Boolean).join(" · ")}
        actions={
          !shell.readOnly ? (
            <>
              <Button onClick={createNext}>
                <Plus size={16} />
                {tm("page.createNext")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("menu")}>
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[260px]">
                  <DropdownMenuItem onSelect={() => setRename(true)}>
                    <Pencil size={15} />
                    {tc("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Repeat size={15} />
                      {t("changeRule")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {repeatOptions(anchorDay, tm).map((o) => (
                        <DropdownMenuItem key={o.key} onSelect={() => runAction(updateSeriesAction(series.id, { recurrence: o.rule, recurrenceLabel: o.label }), { success: t("ruleChanged") })}>
                          {o.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onSelect={() => trash("series", series.id, { title: series.title, redirectTo: "/meetings?tab=series" })}>
                    <Trash2 size={15} />
                    {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          <section className="flex flex-col gap-1" aria-labelledby="s-upcoming">
            <h2 id="s-upcoming" className="label-caps px-3">
              {t("upcoming")}
            </h2>
            {upcoming.length ? (
              <ul className="flex flex-col">
                {upcoming.map((m) => (
                  <MeetingListRow key={m.id} m={m} orgs={data.orgs} showDay now={now} />
                ))}
              </ul>
            ) : (
              <p className="px-3 text-[14px] text-muted">{t("noUpcoming")}</p>
            )}
          </section>
          <section className="flex flex-col gap-1" aria-labelledby="s-past">
            <h2 id="s-past" className="label-caps px-3">
              {t("past")}
            </h2>
            {past.length ? (
              <ul className="flex flex-col">
                {past.map((m) => (
                  <MeetingListRow key={m.id} m={m} orgs={data.orgs} showDay now={now} />
                ))}
              </ul>
            ) : (
              <p className="px-3 text-[14px] text-muted">{t("noPast")}</p>
            )}
          </section>
          <section className="flex flex-col gap-2" aria-labelledby="s-decisions">
            <h2 id="s-decisions" className="label-caps">
              {t("decisions")}
            </h2>
            {data.decisions.length ? <DecisionList rows={data.decisions} orgs={data.orgs} /> : <p className="text-[14px] text-muted">{t("noDecisions")}</p>}
          </section>
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <h2 className="label-caps flex items-center gap-1.5">
            <ListChecks size={13} />
            {t("carried")}
          </h2>
          {data.carried.length ? (
            <ul className="flex flex-col gap-1.5 rounded-2xl bg-panel px-4 py-3">
              {data.carried.map((text, i) => (
                <li key={i} className="text-[14px]">
                  {text}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("nothingCarried")} body={t("carriedHint")} className="px-4 py-5" />
          )}
        </aside>
      </div>

      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent title={tc("rename")}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              const res = await runAction(updateSeriesAction(series.id, { title: title.trim() }));
              if (res !== undefined) setRename(false);
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={tc("title")} autoFocus />
            <p className="text-[13px] text-muted">{t("renameHint")}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRename(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
