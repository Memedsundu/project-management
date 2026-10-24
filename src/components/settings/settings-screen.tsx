"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useScreenContext } from "@/components/shell/shell-context";
import { PageHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SettingsData } from "@/server/views/settings";
import { AccountSection } from "./account-section";
import { AiSection } from "./ai-section";
import { DataSection } from "./data-section";
import { HoursSection, LookSection } from "./general-sections";
import { HelpersSection } from "./helpers-section";
import { ListsSection } from "./lists-section";
import { InstallSection, NotificationsSection } from "./notifications-section";
import { ProjectSection } from "./project-section";

const SECTIONS = ["project", "look", "hours", "notifications", "install", "ai", "helpers", "lists", "account", "data"] as const;
type SectionId = (typeof SECTIONS)[number];

/**
 * Ayarlar on one page with a section list beside it (Linear, Stripe): she
 * scrolls or jumps; each change saves where it is made.
 */
export function SettingsScreen({ data }: { data: SettingsData }) {
  const t = useTranslations("settings");
  const [active, setActive] = useState<SectionId>("project");
  useScreenContext({ kind: "settings", title: t("title") });

  // The list marks the section at the top of the screen.
  useEffect(() => {
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = SECTIONS.find((id) => seen.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    for (const id of SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const label = (id: SectionId) => t(`${id}.title`);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {data.readOnly ? <p className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink">{t("readOnly")}</p> : null}

      <nav aria-label={t("sections")} className="no-print -mx-4 overflow-x-auto px-4 lg:hidden">
        <ul className="flex w-max gap-1.5">
          {SECTIONS.map((id) => (
            <li key={id}>
              <a href={`#${id}`} className={cn("inline-flex h-9 items-center rounded-full border px-3.5 text-[14px]", active === id ? "border-ink bg-ink text-on-ink" : "border-line text-ink-2 hover:bg-panel")}>
                {label(id)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex items-start gap-12">
        <nav aria-label={t("sections")} className="no-print sticky top-8 hidden w-[200px] shrink-0 lg:block">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? "true" : undefined}
                  className={cn("flex h-10 items-center rounded-full px-4 text-[15px]", active === id ? "bg-panel font-medium text-ink" : "text-muted hover:bg-panel hover:text-ink")}
                >
                  {label(id)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-14 pb-24">
          <ProjectSection data={data} />
          <LookSection />
          <HoursSection data={data} />
          <NotificationsSection data={data} />
          <InstallSection />
          <AiSection data={data} />
          <HelpersSection data={data} />
          <ListsSection data={data} />
          <AccountSection data={data} />
          <DataSection data={data} />
        </div>
      </div>
    </div>
  );
}
