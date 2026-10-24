"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { relativeDayLabel } from "@/lib/dates";
import { TaskList } from "./task-list";
import type { TaskItem } from "./types";

export type WaitingGroup = { label: string; orgId: string | null; items: TaskItem[] };

/** Beklediğimler: what partners and people owe her, with a follow-up draft one click away. */
export function WaitingView({ groups, readOnly }: { groups: WaitingGroup[]; readOnly?: boolean }) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const shell = useShell();
  if (!groups.length) {
    return <p className="rounded-2xl border border-dashed border-line-strong px-6 py-8 text-[15px] text-muted">{t("emptyWaiting")}</p>;
  }
  return (
    <TaskList
      showOwner={false}
      readOnly={readOnly}
      groups={groups.map((g) => ({
        key: g.orgId ?? g.label,
        label: g.orgId ? (
          <Link href={`/partners/${g.orgId}`} className="hover:underline">
            {g.label}
          </Link>
        ) : (
          g.label
        ),
        items: g.items,
        action:
          shell.aiConfigured && !readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                shell.openAssistant(
                  t("waiting.followUpPrompt", {
                    name: g.label,
                    items: g.items
                      .map((x) => `- ${x.title}${x.dueDate ? ` (${relativeDayLabel(x.dueDate, locale)})` : ""}`)
                      .join("\n"),
                  }),
                )
              }
            >
              <Mail size={15} />
              {t("waiting.followUp")}
            </Button>
          ) : null,
      }))}
    />
  );
}
