"use client";

import type { LinkItem } from "@/components/common/links-panel";
import { useShell } from "@/components/shell/shell-context";
import { Dialog, SheetContent } from "@/components/ui/overlay";
import { TaskDetail, type HistoryRow } from "./task-detail";
import type { ContactOption, OrgOption, TaskItem } from "./types";
import { useTaskOps } from "./use-task-ops";

export type TaskSheetData = { task: TaskItem; links: LinkItem[]; history: HistoryRow[]; source: { title: string; href: string; type: string } | null };

/** The task side panel, opened from any list through ?open=<id>. */
export function TaskSheet({ detail, orgs, contacts }: { detail: TaskSheetData | null; orgs: OrgOption[]; contacts: ContactOption[] }) {
  const shell = useShell();
  const ops = useTaskOps();
  return (
    <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && ops.close()}>
      {detail ? (
        <SheetContent title={detail.task.title} className="w-[min(500px,100vw)]">
          <TaskDetail
            key={detail.task.id}
            task={detail.task}
            orgs={orgs}
            contacts={contacts}
            links={detail.links}
            history={detail.history}
            source={detail.source}
            readOnly={shell.readOnly}
            onClose={ops.close}
          />
        </SheetContent>
      ) : null}
    </Dialog>
  );
}
