"use client";

import { WifiOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { keptPages, usePendingCount, type RecentPage } from "@/lib/client/offline";
import { useMeta } from "./offline-support";

/** "%s · [uygulama]" → "%s" */
const pageTitle = (title: string) => {
  const parts = title.split(" · ");
  return (parts.length > 1 ? parts.slice(0, -1).join(" · ") : title) || title;
};

/** The offline page: what she can still read, and what waits to be sent. */
export function OfflineScreen() {
  const t = useTranslations("common.offline");
  const locale = useLocale();
  const pending = usePendingCount();
  // The address she tried to open (the service worker shows this page in its place).
  const target = useMeta("x-offline-for");
  const [pages, setPages] = useState<RecentPage[] | null>(null);

  useEffect(() => {
    keptPages().then(setPages);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <WifiOff size={26} className="text-muted" aria-hidden />
        <h1 className="font-display text-[44px] leading-none">{t("title")}</h1>
        <p className="text-[16px] leading-relaxed text-ink-2">{target ? t("notKept") : t("body")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            if (target) window.location.assign(target);
            else window.location.reload();
          }}
          data-testid="offline-retry"
        >
          {t("retry")}
        </Button>
        <Button variant="outline" asChild>
          <a href="/today">{t("toToday")}</a>
        </Button>
      </div>
      {pending ? <p className="rounded-xl bg-panel px-4 py-3 text-[14px]">{t("pendingLong", { count: pending })}</p> : null}
      <section className="flex flex-col gap-2" aria-labelledby="kept-h">
        <h2 id="kept-h" className="label-caps">
          {t("keptTitle")}
        </h2>
        {pages === null ? null : pages.length ? (
          <ul className="flex flex-col" data-testid="offline-kept">
            {pages.map((p) => (
              <li key={p.url}>
                <a href={p.url} className="flex min-h-11 items-center justify-between gap-3 border-b border-line-soft py-2 text-[15px] hover:text-ink-2">
                  <span className="truncate">{pageTitle(p.title)}</span>
                  <span className="shrink-0 text-[12px] text-muted">{formatDateTime(new Date(p.at), locale)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t("noneKept")}</p>
        )}
      </section>
    </main>
  );
}
