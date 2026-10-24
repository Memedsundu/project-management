"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { ShellContext } from "@/components/shell/shell-context";

/** ⓘ explanation with a "Yapay zekâya sor" link that opens the assistant with the question. */
export function InfoTip({ children, ask }: { children: React.ReactNode; ask?: string }) {
  const t = useTranslations("common");
  const shell = useContext(ShellContext);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("moreInfo")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-faint hover:text-ink"
        >
          <Info size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[300px] text-[13px] leading-snug">
        <div className="flex flex-col gap-2">
          <div className="text-ink-2">{children}</div>
          {ask && shell ? (
            <button type="button" onClick={() => shell.openAssistant(ask)} className="self-start text-[13px] font-medium text-accent-ink underline-offset-4 hover:underline">
              {t("askAi")} →
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
