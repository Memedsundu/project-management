"use client";

import { LogOut, Pin } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { signOutAction } from "@/app/(auth)/actions";
import { CountPill } from "@/components/ui/badge";
import { flushCaptures, forgetOfflineCopies, pendingCaptures } from "@/lib/client/offline";
import type { ShellData } from "@/server/services/shell";
import { cn } from "@/lib/utils";
import { LanguageSwitch } from "./language-switch";
import { activeNavKey, NAV } from "./nav-items";
import { ThemeSwitch } from "./theme-switch";

export function SidebarNav({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = activeNavKey(pathname);

  return (
    <nav aria-label={t("mainMenu")} className="flex flex-col gap-5 text-[15px]">
      {NAV.map((group, gi) => (
        <div
          key={gi}
          className={cn("flex flex-col gap-0.5", gi === NAV.length - 1 && "border-t border-line pt-3")}
        >
          {group.labelKey ? (
            <span className="label-caps px-3 pb-1">{t(group.labelKey as "groupWork")}</span>
          ) : null}
          {group.items.map((item) => {
            const isActive = active === item.key;
            const count = item.count ? data.counts[item.count] : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex min-h-10 items-center justify-between gap-2 rounded-[10px] px-3 transition-colors",
                  isActive ? "bg-ink font-medium text-on-ink" : "hover:bg-panel-2",
                )}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={17} strokeWidth={1.8} className={isActive ? "" : "text-muted group-hover:text-ink"} />
                  {t(item.labelKey as "today")}
                </span>
                {count ? (
                  item.count === "today" ? (
                    <span className={cn("text-[13px]", isActive ? "text-on-ink/70" : "text-muted")}>{count}</span>
                  ) : (
                    <CountPill value={count} tone="accent" />
                  )
                ) : null}
              </Link>
            );
          })}
          {gi === 3 && data.pinned.length ? (
            <div className="mt-1 flex flex-col gap-0.5">
              {data.pinned.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-[10px] px-3 text-[14px] text-ink-2 hover:bg-panel-2",
                    pathname === p.href && "bg-panel-2 font-medium text-ink",
                  )}
                >
                  <Pin size={13} className="text-faint" />
                  <span className="truncate">{p.label}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ data }: { data: ShellData }) {
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-bg-subtle px-4 py-6 scrollbar-thin lg:flex">
      <Link href="/today" className="flex flex-col gap-1 px-3">
        <span className="font-display text-[28px] leading-none">{data.appName}</span>
        <span className="truncate text-[13px] text-muted">
          {data.projectName} · {data.years}
        </span>
      </Link>
      <SidebarNav data={data} />
      <div className="mt-auto flex flex-col gap-2 px-1">
        <div className="flex items-center justify-between">
          <LanguageSwitch />
        </div>
        <div className="flex items-center justify-between">
          <ThemeSwitch />
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

/**
 * Sign out. What she added offline is sent first, then the pages kept for
 * offline reading are dropped from this device.
 */
export function SignOutButton({ withLabel, inline }: { withLabel?: boolean; inline?: boolean }) {
  const t = useTranslations("nav");
  const to = useTranslations("common.offline");
  return (
    <form
      action={async () => {
        if (!navigator.onLine) {
          toast.error(to("signOutOffline"));
          return;
        }
        await flushCaptures({ saved: (count) => to("synced", { count }), refused: (title, error) => to("refused", { title, error }) });
        if (pendingCaptures().length) {
          toast.error(to("signOutPending"));
          return;
        }
        await forgetOfflineCopies();
        await signOutAction();
      }}
    >
      <button
        type="submit"
        title={t("signOut")}
        aria-label={withLabel || inline ? undefined : t("signOut")}
        className={cn(
          "inline-flex items-center rounded-full text-muted hover:bg-panel-2 hover:text-ink",
          inline ? "h-9 gap-2 px-3 text-[14px] font-medium text-ink hover:bg-panel" : withLabel ? "h-11 w-full gap-3 px-3 text-[15px]" : "h-9 w-9 justify-center",
        )}
        data-testid="sign-out"
      >
        <LogOut size={inline ? 15 : 16} />
        {withLabel || inline ? t("signOut") : null}
      </button>
    </form>
  );
}
