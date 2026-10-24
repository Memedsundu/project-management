"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useMounted } from "./use-media-query";

export function ThemeSwitch({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const options = [
    { value: "light", label: t("themeLight"), icon: Sun },
    { value: "dark", label: t("themeDark"), icon: Moon },
    { value: "system", label: t("themeSystem"), icon: Monitor },
  ];
  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label={t("theme")}>
      {options.map((o) => {
        const active = mounted && theme === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
              active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
