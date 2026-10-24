"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { dailyNoteAction } from "@/app/(app)/notes/actions";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/client/run-action";

/** A day without a daily note yet: nothing is created until she asks. */
export function DailyEmpty({ day, label, prev, next }: { day: string; label: string; prev: string; next: string }) {
  const t = useTranslations("notes.daily");
  const tc = useTranslations("common");
  const router = useRouter();
  const { readOnly } = useShell();
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[36px] leading-tight sm:text-[44px]">{label}</h1>
        <span className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" asChild aria-label={t("prev")}>
            <Link href={`/notes/daily?day=${prev}`}>
              <ChevronLeft size={18} />
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/notes/daily">{tc("today")}</Link>
          </Button>
          <Button size="icon-sm" variant="ghost" asChild aria-label={t("next")}>
            <Link href={`/notes/daily?day=${next}`}>
              <ChevronRight size={18} />
            </Link>
          </Button>
        </span>
      </div>
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-6">
        <p className="text-[15px] text-muted">{t("none")}</p>
        {!readOnly ? (
          <Button
            onClick={async () => {
              const res = await runAction(dailyNoteAction(day));
              if (res) router.push(`/notes/${res.id}`);
            }}
          >
            <Plus size={16} />
            {t("create")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
