"use client";

import { ListChecks, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { TaskBoard } from "./board";
import { FilterBar, type SavedViewItem, type TaskFilterState } from "./filter-bar";
import { InlineAdd } from "./inline-add";
import { LogbookView } from "./logbook";
import { TaskList } from "./task-list";
import { ApplyTaskSetDialog } from "./task-set-dialogs";
import { TaskSheet, type TaskSheetData } from "./task-sheet";
import type { ContactOption, OrgOption, TaskItem } from "./types";
import { UpcomingView, type UpcomingDay } from "./upcoming";
import { WaitingView, type WaitingGroup } from "./waiting";

export type TasksTab = "list" | "upcoming" | "board" | "logbook" | "waiting";

export type TasksScreenProps = {
  tab: TasksTab;
  today: string;
  filters: TaskFilterState;
  activeViewId: string | null;
  savedViews: SavedViewItem[];
  orgs: OrgOption[];
  contacts: ContactOption[];
  tags: { name: string; slug: string; count?: number }[];
  waitingCount: number;
  list?: { today: TaskItem[]; week: TaskItem[]; later: TaskItem[] };
  upcoming?: UpcomingDay[];
  board?: { todo: TaskItem[]; doing: TaskItem[]; waiting: TaskItem[]; done: TaskItem[] };
  logbook?: { items: TaskItem[]; month: string };
  waiting?: WaitingGroup[];
  detail: TaskSheetData | null;
};

export function TasksScreen(props: TasksScreenProps) {
  const t = useTranslations("tasks");
  const shell = useShell();
  const readOnly = shell.readOnly;
  const partnerNames = useMemo(() => new Map(props.orgs.map((o) => [o.id, o.shortName || o.name])), [props.orgs]);
  const partners = useMemo(() => props.orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })), [props.orgs]);
  const [setsOpen, setSetsOpen] = useState(false);
  useScreenContext({ kind: "tasks", title: t("title"), detail: t(`views.${props.tab}`) });

  const tabHref = (tab: TasksTab) => {
    const p = new URLSearchParams();
    if (tab !== "list") p.set("tab", tab);
    if (props.activeViewId && (tab === "list" || tab === "board")) p.set("view", props.activeViewId);
    const qs = p.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };

  const showFilters = props.tab === "list" || props.tab === "board";

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          !readOnly ? (
            <>
              <Button variant="outline" onClick={() => setSetsOpen(true)} data-testid="tasks-apply-set">
                <ListChecks size={18} />
                {t("sets.apply")}
              </Button>
              <Button onClick={() => shell.openQuickAdd({ mode: "task" })}>
                <Plus size={18} />
                {t("newTask")}
              </Button>
            </>
          ) : null
        }
      />

      <SegmentedLinks
        active={props.tab}
        items={(["list", "upcoming", "board", "logbook", "waiting"] as const).map((key) => ({
          key,
          label: t(`views.${key}`),
          href: tabHref(key),
          count: key === "waiting" ? props.waitingCount : undefined,
        }))}
      />

      {showFilters ? (
        <FilterBar
          filters={props.filters}
          orgs={props.orgs}
          tags={props.tags}
          savedViews={props.savedViews}
          activeViewId={props.activeViewId}
        />
      ) : null}

      {props.tab === "list" && props.list ? (
        <div className="flex flex-col gap-6">
          <InlineAdd today={props.today} partners={partners} />
          <TaskList
            partnerNames={partnerNames}
            readOnly={readOnly}
            groups={[
              { key: "today", label: t("groups.today"), items: props.list.today, empty: t("emptyToday") },
              { key: "week", label: t("groups.week"), items: props.list.week, empty: t("emptyWeek") },
              { key: "later", label: t("groups.later"), items: props.list.later, empty: t("emptyLater") },
            ]}
          />
          <p className="px-3 text-[13px] text-faint">{t("keyboardHint")}</p>
        </div>
      ) : null}

      {props.tab === "upcoming" && props.upcoming ? (
        <UpcomingView days={props.upcoming} today={props.today} partnerNames={partnerNames} readOnly={readOnly} />
      ) : null}

      {props.tab === "board" && props.board ? <TaskBoard columns={props.board} partnerNames={partnerNames} readOnly={readOnly} /> : null}

      {props.tab === "logbook" && props.logbook ? (
        <LogbookView items={props.logbook.items} month={props.logbook.month} partnerNames={partnerNames} />
      ) : null}

      {props.tab === "waiting" && props.waiting ? <WaitingView groups={props.waiting} readOnly={readOnly} /> : null}

      <TaskSheet detail={props.detail} orgs={props.orgs} contacts={props.contacts} />
      {!readOnly ? <ApplyTaskSetDialog open={setsOpen} onOpenChange={setSetsOpen} /> : null}
    </div>
  );
}
