"use client";

import { RefreshCw, Send, WifiOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { flushCaptures, keepPage, rememberPage, useOnline, usePendingCount } from "@/lib/client/offline";

const noSubscribe = () => () => {};

/** A marker the service worker adds to a page it served from its saved copies. */
export function useMeta(name: string) {
  return useSyncExternalStore(
    noSubscribe,
    () => document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? null,
    () => null,
  );
}

/**
 * Registers the service worker, keeps each page she opens for offline
 * reading, sends what she added offline once the connection is back, and
 * says so in a quiet line at the top of the page.
 */
export function OfflineSupport({ preload }: { preload?: () => Promise<unknown> }) {
  const t = useTranslations("common.offline");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnline();
  const pending = usePendingCount();
  const [firstPath] = useState(pathname);
  const savedAt = useMeta("x-offline-copy");
  // The marker belongs to the page that loaded first, not to the next ones.
  const copy = savedAt !== null && pathname === firstPath;

  const flush = useCallback(async () => {
    const saved = await flushCaptures({ saved: (count) => t("synced", { count }), refused: (title, error) => t("refused", { title, error }) });
    if (saved) router.refresh();
  }, [t, router]);

  useEffect(() => {
    // Development serves files that change on every edit, so only the built app gets a service worker.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(async (reg) => {
        // Load quick add now, so it opens offline even if she never used it on this device.
        await preload?.().catch(() => {});
        // Files this page loaded before the service worker took over, so they work offline too.
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.includes("/_next/static/"));
        reg.active?.postMessage({ type: "warm", urls });
        if (!window.location.search) reg.active?.postMessage({ type: "keep", url: window.location.pathname });
      })
      .catch(() => {});
  }, [preload]);

  useEffect(() => {
    const url = window.location.pathname + window.location.search;
    const handle = window.setTimeout(() => {
      rememberPage(url, document.title);
      // Pages with a query (a search, an open drawer) are kept only when loaded in full.
      if (!window.location.search) keepPage(url);
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [pathname]);

  useEffect(() => {
    void flush();
    const onVisible = () => document.visibilityState === "visible" && void flush();
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [flush]);

  if (online && !copy && !pending) return null;
  const time = copy && savedAt ? formatDateTime(new Date(Number(savedAt)), locale) : null;
  return (
    <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-panel px-4 py-2.5 text-[14px] lg:mx-10" data-testid="offline-banner">
      <WifiOff size={15} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        {!online ? (time ? t("offlineCopy", { time }) : t("offline")) : copy && time ? t("copy", { time }) : null}
        {pending ? <span className="text-muted"> {online ? t("pendingOnline", { count: pending }) : t("pending", { count: pending })}</span> : null}
      </span>
      {online && copy ? (
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw size={14} />
          {t("reload")}
        </Button>
      ) : null}
      {online && pending ? (
        <Button size="sm" variant="outline" onClick={() => void flush()} data-testid="offline-send">
          <Send size={14} />
          {t("sendNow")}
        </Button>
      ) : null}
    </div>
  );
}
