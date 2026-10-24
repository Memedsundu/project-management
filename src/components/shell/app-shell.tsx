"use client";

import { Menu, Plus, Search, Sparkles, Sun, CheckSquare, FolderOpen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, SheetContent } from "@/components/ui/overlay";
import { Kbd } from "@/components/ui/card";
import { formatLongDay, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ShellData } from "@/server/services/shell";
import { ALL_NAV_ITEMS, activeNavKey } from "./nav-items";
import { ShellContext, type QuickAddPrefill, type ScreenContext } from "./shell-context";
import { Sidebar, SidebarNav } from "./sidebar";
import { LanguageSwitch } from "./language-switch";
import { ThemeSwitch } from "./theme-switch";
import { useMediaQuery } from "./use-media-query";

const CommandMenu = dynamic(() => import("./command-menu").then((m) => m.CommandMenu), { ssr: false });
const QuickAdd = dynamic(() => import("./quick-add").then((m) => m.QuickAdd), { ssr: false });
const AssistantPanel = dynamic(() => import("./assistant-panel").then((m) => m.AssistantPanel), { ssr: false });
const ShortcutsSheet = dynamic(() => import("./shortcuts-sheet").then((m) => m.ShortcutsSheet), { ssr: false });

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function AppShell({ data, children }: { data: ShellData; children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const wide = useMediaQuery("(min-width: 1280px)");
  const router = useRouter();
  const pathname = usePathname();
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [quickAdd, setQuickAdd] = useState<QuickAddPrefill | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [screen, setScreen] = useState<ScreenContext | null>(null);
  const goPending = useRef<number | null>(null);

  const api = useMemo(
    () => ({
      openCommand: (q?: string) => {
        setCommandQuery(q ?? "");
        setCommandOpen(true);
      },
      openQuickAdd: (prefill?: QuickAddPrefill) => setQuickAdd(prefill ?? {}),
      openAssistant: (prompt?: string) => {
        setAssistantPrompt(prompt);
        setAssistantOpen(true);
      },
      toggleAssistant: () => setAssistantOpen((v) => !v),
      assistantOpen,
      setScreen,
      screen,
      readOnly: data.readOnly,
      aiConfigured: data.aiConfigured,
    }),
    [assistantOpen, screen, data.readOnly, data.aiConfigured],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandQuery("");
        setCommandOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setAssistantOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (goPending.current) {
        window.clearTimeout(goPending.current);
        goPending.current = null;
        const item = ALL_NAV_ITEMS.find((i) => i.shortcut === e.key.toLowerCase());
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (e.key === "g") {
        goPending.current = window.setTimeout(() => (goPending.current = null), 900);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setCommandQuery("");
        setCommandOpen(true);
      } else if (e.key === "n" && !data.readOnly) {
        e.preventDefault();
        setQuickAdd({});
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    },
    [router, data.readOnly],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const active = activeNavKey(pathname);

  return (
    <ShellContext.Provider value={api}>
      <a
        href="#main"
        className="sr-only z-[70] rounded-full bg-ink px-4 py-2 text-on-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t("skipToContent")}
      </a>
      <div className="flex min-h-dvh">
        <Sidebar data={data} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone and tablet header */}
          <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t("menu")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel"
            >
              <Menu size={20} />
            </button>
            <Link href="/today" className="font-display text-[24px] leading-none">
              {data.appName}
            </Link>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => api.openCommand()}
                aria-label={t("askOrSearch")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel"
              >
                <Search size={20} />
              </button>
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                aria-label={t("assistant")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-panel"
              >
                <Sparkles size={19} />
              </button>
            </div>
          </header>

          {/* Laptop top bar */}
          <div className="no-print hidden items-center gap-4 px-10 pt-6 lg:flex">
            <button
              type="button"
              onClick={() => api.openCommand()}
              className="flex h-12 flex-1 items-center gap-2.5 rounded-full border border-line-strong px-4 text-left text-[15px] text-faint transition-colors hover:border-ink"
              data-testid="open-search"
            >
              <Search size={18} className="text-muted" />
              <span className="flex-1 truncate">{t("askPlaceholder")}</span>
              <Kbd>⌘K</Kbd>
            </button>
            <span className="hidden whitespace-nowrap text-[14px] text-muted xl:inline">
              {formatLongDay(todayStr(), locale)}
            </span>
            {!data.readOnly ? (
              <button
                type="button"
                onClick={() => setQuickAdd({})}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-[15px] font-medium text-on-ink hover:bg-ink/85"
                data-testid="quick-add-button"
              >
                <Plus size={18} />
                {t("quickAdd")}
                <Kbd className="border-on-ink/30 bg-transparent text-on-ink/70">N</Kbd>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAssistantOpen((v) => !v)}
              aria-pressed={assistantOpen}
              className={cn(
                "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-colors",
                assistantOpen ? "border-ink bg-panel" : "border-line-strong hover:border-ink",
              )}
            >
              <Sparkles size={17} />
              {t("assistant")}
            </button>
          </div>

          {data.readOnly ? (
            <div className="mx-4 mt-4 rounded-xl bg-accent-soft px-4 py-2.5 text-[14px] text-accent-ink lg:mx-10">
              {tc("readOnly")}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-8 lg:px-10 lg:pb-16 lg:pt-8">
              {children}
            </main>
            {assistantOpen && wide ? (
              <aside className="no-print sticky top-0 h-dvh w-[380px] shrink-0 border-l border-line">
                <AssistantPanel
                  onClose={() => setAssistantOpen(false)}
                  initialPrompt={assistantPrompt}
                  onPromptUsed={() => setAssistantPrompt(undefined)}
                />
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      {/* Phone bottom bar with quick add in the centre */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {[
            { key: "today", href: "/today", icon: Sun, label: t("today") },
            { key: "tasks", href: "/tasks", icon: CheckSquare, label: t("tasks") },
          ].map((it) => (
            <Link
              key={it.key}
              href={it.href}
              className={cn(
                "flex flex-col items-center gap-0.5 text-[11px]",
                active === it.key ? "font-semibold text-ink" : "text-muted",
              )}
            >
              <it.icon size={21} strokeWidth={1.8} />
              {it.label}
            </Link>
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setQuickAdd({})}
              aria-label={t("quickAdd")}
              disabled={data.readOnly}
              className="inline-flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-ink text-on-ink shadow-[var(--shadow)] disabled:opacity-40"
            >
              <Plus size={26} />
            </button>
          </div>
          <Link
            href="/files"
            className={cn(
              "flex flex-col items-center gap-0.5 text-[11px]",
              active === "files" ? "font-semibold text-ink" : "text-muted",
            )}
          >
            <FolderOpen size={21} strokeWidth={1.8} />
            {t("files")}
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="relative flex flex-col items-center gap-0.5 text-[11px] text-muted"
          >
            <Menu size={21} strokeWidth={1.8} />
            {t("menu")}
            {data.counts.inbox ? (
              <span className="absolute right-[22%] top-0 h-2 w-2 rounded-full bg-accent" aria-hidden />
            ) : null}
          </button>
        </div>
      </nav>

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent title={t("menu")} side="left" className="overflow-y-auto px-4 py-6">
          <div className="flex flex-col gap-1 px-3 pb-5">
            <span className="font-display text-[26px] leading-none">{data.appName}</span>
            <span className="text-[13px] text-muted">
              {data.projectName} · {data.years}
            </span>
          </div>
          <SidebarNav data={data} onNavigate={() => setMenuOpen(false)} />
          <div className="mt-6 flex flex-col gap-2 px-1">
            <LanguageSwitch />
            <ThemeSwitch />
          </div>
        </SheetContent>
      </Dialog>

      {/* Phone and tablet assistant */}
      <Dialog open={assistantOpen && !wide} onOpenChange={setAssistantOpen}>
        {assistantOpen && !wide ? (
          <SheetContent title={t("assistant")} side="right">
            <AssistantPanel
              onClose={() => setAssistantOpen(false)}
              initialPrompt={assistantPrompt}
              onPromptUsed={() => setAssistantPrompt(undefined)}
            />
          </SheetContent>
        ) : null}
      </Dialog>

      {commandOpen ? (
        <CommandMenu
          open={commandOpen}
          initialQuery={commandQuery}
          onOpenChange={setCommandOpen}
          onQuickAdd={(p) => setQuickAdd(p ?? {})}
          onAsk={(q) => api.openAssistant(q)}
        />
      ) : null}
      {quickAdd ? <QuickAdd prefill={quickAdd} onClose={() => setQuickAdd(null)} /> : null}
      {shortcutsOpen ? <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} /> : null}
    </ShellContext.Provider>
  );
}
