"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { setTaskDoneAction } from "@/app/(app)/tasks/actions";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { TaskItem } from "./types";

/** Shared task moves: complete with undo, and open the detail panel in the URL. */
export function useTaskOps() {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const toggleDone = useCallback(
    async (task: Pick<TaskItem, "id" | "title">, done: boolean) => {
      const res = await runAction(setTaskDoneAction(task.id, done));
      if (!res) return false;
      if (done) {
        toast(res.spawnedDue ? t("nextCreated", { date: relativeDayLabel(res.spawnedDue, locale) }) : t("completedNamed", { title: task.title }), {
          duration: 5000,
          action: res.spawnedId
            ? undefined
            : {
                label: tc("undo"),
                onClick: () => runAction(setTaskDoneAction(task.id, false)),
              },
        });
      }
      return true;
    },
    [t, tc, locale],
  );

  const hrefWith = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  const open = useCallback((task: Pick<TaskItem, "id">) => router.push(hrefWith({ open: task.id }), { scroll: false }), [router, hrefWith]);
  const close = useCallback(() => router.push(hrefWith({ open: null }), { scroll: false }), [router, hrefWith]);

  return { toggleDone, open, close, hrefWith };
}
