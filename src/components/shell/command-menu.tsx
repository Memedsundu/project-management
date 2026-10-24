"use client";

import { Command } from "cmdk";
import {
  ArrowRight,
  CalendarPlus,
  FilePlus2,
  Handshake,
  Languages,
  Moon,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  Sun,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { commandSearchAction } from "@/app/actions/common";
import { setLocaleAction } from "@/app/actions/preferences";
import { EntityIcon } from "@/components/common/entity-icon";
import { Highlight } from "@/components/common/highlight";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Kbd } from "@/components/ui/card";
import { foldText } from "@/lib/fold";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS } from "./nav-items";
import type { QuickAddPrefill } from "./shell-context";

type Hit = { type: string; id: string; title: string; href: string; snippet: string; page: number | null };

const QUESTION_START =
  /^(ne|neden|niye|nasil|kim|hangi|kac|nerede|ne zaman|hangisi|var mi|mi|what|why|how|who|which|when|where|did|does|do|is|are|can|should|was|were)\b/;

export function looksLikeQuestion(q: string) {
  const f = foldText(q);
  return q.trim().endsWith("?") || QUESTION_START.test(f) || /\b(mi|mu|mı|mü)\b\??$/.test(q.trim());
}

const GROUPS = ["task", "note", "document", "meeting", "organisation", "contact", "decision", "activity", "indicator", "report", "collection", "folder", "series", "visual", "logframe", "template"];

export function CommandMenu({
  open,
  initialQuery,
  onOpenChange,
  onQuickAdd,
  onAsk,
}: {
  open: boolean;
  initialQuery: string;
  onOpenChange: (v: boolean) => void;
  onQuickAdd: (prefill?: QuickAddPrefill) => void;
  onAsk: (q: string) => void;
}) {
  const t = useTranslations("search");
  const tn = useTranslations("nav");
  const tk = useTranslations("common.kinds");
  const router = useRouter();
  const locale = useLocale();
  const { setTheme } = useTheme();
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const n = ++seq.current;
    if (query.length < 2) {
      const clear = window.setTimeout(() => n === seq.current && setHits([]), 0);
      return () => window.clearTimeout(clear);
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const res = await runAction(commandSearchAction(query), { silent: true });
      if (n !== seq.current) return;
      setLoading(false);
      setHits(res ?? []);
    }, 120);
    return () => window.clearTimeout(handle);
  }, [q]);

  const close = () => onOpenChange(false);
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const commands = useMemo(
    () => [
      { key: "newTask", label: t("cmdNewTask"), icon: Plus, run: () => (close(), onQuickAdd({ mode: "task" })) },
      { key: "newNote", label: t("cmdNewNote"), icon: NotebookPen, run: () => go("/notes/new") },
      { key: "upload", label: t("cmdUpload"), icon: Upload, run: () => go("/files?upload=1") },
      { key: "newMeeting", label: t("cmdNewMeeting"), icon: CalendarPlus, run: () => go("/meetings/new") },
      { key: "newOrg", label: t("cmdNewOrg"), icon: Handshake, run: () => go("/partners/new") },
      { key: "newReport", label: t("cmdNewReport"), icon: FilePlus2, run: () => go("/reports/new") },
      { key: "dark", label: t("cmdDark"), icon: Moon, run: () => (setTheme("dark"), close()) },
      { key: "light", label: t("cmdLight"), icon: Sun, run: () => (setTheme("light"), close()) },
      {
        key: "lang",
        label: locale === "tr" ? "Switch to English" : "Türkçeye geç",
        icon: Languages,
        run: async () => {
          close();
          await setLocaleAction(locale === "tr" ? "en" : "tr");
          router.refresh();
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, t],
  );

  const fq = foldText(q);
  const matchedCommands = fq ? commands.filter((c) => foldText(c.label).includes(fq)) : commands;
  const navItems = ALL_NAV_ITEMS.filter((i) => !fq || foldText(tn(i.labelKey as "today")).includes(fq));
  const grouped = GROUPS.map((g) => ({ type: g, items: hits.filter((h) => h.type === g) })).filter((g) => g.items.length);
  const question = q.trim().length > 3;

  const itemCls =
    "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-[15px] outline-none data-[selected=true]:bg-panel";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={tn("askOrSearch")} hideTitle wide className="top-[10vh] max-w-[680px] [&>div:last-child]:p-0">
        <Command shouldFilter={false} loop className="flex flex-col" label={tn("askOrSearch")}>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={18} className="text-muted" />
            <Command.Input
              value={q}
              onValueChange={setQ}
              autoFocus
              placeholder={tn("askPlaceholder")}
              className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
              data-testid="command-input"
            />
            {loading ? <span className="text-[13px] text-faint">…</span> : <Kbd>Esc</Kbd>}
          </div>
          <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
            {question ? (
              <Command.Group heading={t("askGroup")} className="cmdk-group">
                <Command.Item value="ask" onSelect={() => (close(), onAsk(q.trim()))} className={itemCls}>
                  <Sparkles size={17} className="text-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    {t("askAi")}: <span className="font-medium">{q.trim()}</span>
                  </span>
                  {looksLikeQuestion(q) ? <Kbd>↵</Kbd> : null}
                </Command.Item>
                <Command.Item value="ask-cited" onSelect={() => go(`/search/ask?q=${encodeURIComponent(q.trim())}`)} className={itemCls}>
                  <Sparkles size={17} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate">{t("askWithSources")}</span>
                </Command.Item>
              </Command.Group>
            ) : null}

            {grouped.map((g) => (
              <Command.Group key={g.type} heading={tk(g.type as "task")} className="cmdk-group">
                {g.items.slice(0, 6).map((h) => (
                  <Command.Item key={`${h.type}:${h.id}`} value={`${h.type}:${h.id}`} onSelect={() => go(h.page ? `${h.href}${h.href.includes("?") ? "&" : "?"}page=${h.page}` : h.href)} className={itemCls}>
                    <EntityIcon type={h.type} className="shrink-0 text-muted" size={17} />
                    <span className="flex min-w-0 flex-1 flex-col py-1.5">
                      <span className="truncate">
                        <Highlight text={h.title} query={q} />
                      </span>
                      {h.snippet ? (
                        <span className="line-clamp-1 text-[13px] text-muted">
                          {h.page ? `s. ${h.page} · ` : ""}
                          <Highlight text={h.snippet} query={q} />
                        </span>
                      ) : null}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}

            {q.trim().length >= 2 ? (
              <Command.Item value="all-results" onSelect={() => go(`/search?q=${encodeURIComponent(q.trim())}`)} className={itemCls}>
                <ArrowRight size={17} className="text-muted" />
                {t("allResults")}
              </Command.Item>
            ) : null}

            {matchedCommands.length ? (
              <Command.Group heading={t("commands")} className="cmdk-group">
                {matchedCommands.map((c) => (
                  <Command.Item key={c.key} value={`cmd-${c.key}`} onSelect={c.run} className={itemCls}>
                    <c.icon size={17} className="text-muted" />
                    {c.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {navItems.length ? (
              <Command.Group heading={t("goTo")} className="cmdk-group">
                {navItems.map((i) => (
                  <Command.Item key={i.key} value={`nav-${i.key}`} onSelect={() => go(i.href)} className={cn(itemCls)}>
                    <i.icon size={17} className="text-muted" />
                    <span className="flex-1">{tn(i.labelKey as "today")}</span>
                    {i.shortcut ? (
                      <span className="flex gap-1">
                        <Kbd>G</Kbd>
                        <Kbd>{i.shortcut.toUpperCase()}</Kbd>
                      </span>
                    ) : null}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            {!loading && q.trim().length >= 2 && !hits.length && !matchedCommands.length && !navItems.length ? (
              <Command.Empty className="px-3 py-6 text-[14px] text-muted">{t("nothingFound")}</Command.Empty>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
