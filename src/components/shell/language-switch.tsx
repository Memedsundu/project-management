"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/actions/preferences";
import { cn } from "@/lib/utils";

export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const options = [
    { value: "tr", label: "Türkçe" },
    { value: "en", label: "English" },
  ];
  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label="Dil / Language">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={locale === o.value}
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setLocaleAction(o.value);
              router.refresh();
            })
          }
          className={cn(
            "h-9 rounded-full border px-3 text-[14px] transition-colors",
            locale === o.value ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
