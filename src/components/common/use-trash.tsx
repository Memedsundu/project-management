"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { restoreAction, trashAction } from "@/app/actions/common";
import { runAction } from "@/lib/client/run-action";
import type { EntityType } from "@/server/entities";

/** Delete with Gmail-style undo: the toast offers "Geri al" for six seconds. */
export function useTrash() {
  const t = useTranslations("common");
  const router = useRouter();
  return useCallback(
    async (type: EntityType, id: string, opts: { title?: string; redirectTo?: string; onDone?: () => void } = {}) => {
      const res = await runAction(trashAction(type, id));
      if (!res) return false;
      opts.onDone?.();
      if (opts.redirectTo) router.push(opts.redirectTo);
      toast(opts.title ? t("movedToTrashNamed", { title: opts.title }) : t("movedToTrash"), {
        duration: 6000,
        action: {
          label: t("undo"),
          onClick: async () => {
            const ok = await runAction(restoreAction(type, id));
            if (ok !== undefined) {
              toast(t("restored"));
              router.refresh();
            }
          },
        },
      });
      return true;
    },
    [router, t],
  );
}
