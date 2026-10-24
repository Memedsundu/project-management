"use client";

import { CalendarCheck2, CheckCheck, Handshake, Loader2, RefreshCw, ScrollText, Sparkles, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { makeBriefAction, markBriefsReadAction } from "@/app/(app)/briefs/actions";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { formatDay, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { BriefKind, BriefListItem } from "@/server/services/briefs";

type Helpers = { dailyBrief: boolean; weeklyReview: boolean; partnerCheck: boolean };

export const BRIEF_ICONS: Record<BriefKind, typeof Sun> = { daily: Sun, weekly: CalendarCheck2, partner_check: Handshake, recipe: ScrollText };

const HELPERS = [
  { kind: "daily", setting: "dailyBrief" },
  { kind: "weekly", setting: "weeklyReview" },
  { kind: "partner_check", setting: "partnerCheck" },
] as const;

/**
 * Özetler: what the helpers wrote, newest first (Notion Custom Agents'
 * activity, Sunsama's weekly review). The helpers sit on top with their
 * schedule and a button to write one now.
 */
export function BriefsScreen({ items, kind, helpers, last, aiReady }: { items: BriefListItem[]; kind: BriefKind | null; helpers: Helpers; last: Partial<Record<BriefKind, string>>; aiReady: boolean }) {
  const t = useTranslations("briefs");
  const locale = useLocale();
  const shell = useShell();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  useScreenContext({ kind: "briefs", title: t("title"), detail: kind ? t(`kinds.${kind}`) : undefined });

  const unread = items.filter((i) => !i.read && i.kind !== "daily");
  const months = useMemo(() => {
    const out: { key: string; label: string; items: BriefListItem[] }[] = [];
    for (const it of items) {
      const key = it.day.slice(0, 7);
      let g = out.at(-1);
      if (!g || g.key !== key) {
        g = { key, label: new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`)), items: [] };
        out.push(g);
      }
      g.items.push(it);
    }
    return out;
  }, [items, locale]);

  const make = async (k: (typeof HELPERS)[number]["kind"]) => {
    setBusy(k);
    const res = await runAction(makeBriefAction(k));
    setBusy(null);
    if (res) router.push(`/briefs/${res.id}`);
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          unread.length ? (
            <Button variant="outline" onClick={() => runAction(markBriefsReadAction(unread.map((u) => u.id)), { success: t("allRead") })} data-testid="briefs-read-all">
              <CheckCheck size={17} />
              {t("markAllRead")}
            </Button>
          ) : null
        }
      />

      <section aria-labelledby="helpers-h" className="flex flex-col gap-3">
        <SectionTitle
          id="helpers-h"
          action={
            <Link href="/settings#helpers" className="text-[14px] text-muted hover:text-ink">
              {t("helpers.manage")}
            </Link>
          }
        >
          {t("helpers.title")}
        </SectionTitle>
        <ul className="grid gap-3 md:grid-cols-3">
          {HELPERS.map((h) => {
            const Icon = BRIEF_ICONS[h.kind];
            const on = helpers[h.setting];
            return (
              <li key={h.kind} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 md:flex-col md:items-stretch md:gap-2 md:py-4" data-testid="briefs-helper">
                <span className="flex min-w-0 flex-1 flex-col gap-1 md:gap-2">
                  <span className="flex items-center gap-2">
                    <Icon size={16} className="shrink-0 text-muted" />
                    <span className="text-[15px] font-medium">{t(`kindOne.${h.kind}`)}</span>
                  </span>
                  <span className="text-[13px] text-muted">
                    {t(`helpers.when.${h.kind}`)} · <span className={cn(on ? "text-ink-2" : "text-faint")}>{on ? t("helpers.on") : t("helpers.off")}</span>
                  </span>
                  <span className="text-[13px] text-muted">{last[h.kind] ? t("helpers.last", { date: relativeDayLabel(last[h.kind]!, locale) }) : t("helpers.never")}</span>
                </span>
                {!shell.readOnly ? (
                  <Button size="sm" variant="outline" className="shrink-0 md:mt-1 md:self-start" onClick={() => make(h.kind)} disabled={busy !== null} data-testid={`briefs-make-${h.kind}`}>
                    {busy === h.kind ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {busy === h.kind ? t("helpers.making") : t("helpers.makeNow")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!aiReady ? <p className="text-[13px] text-muted">{t("helpers.plain")}</p> : null}
      </section>

      <div className="flex flex-col gap-4">
        <SegmentedLinks
          active={kind ?? "all"}
          items={(["all", "daily", "weekly", "partner_check", "recipe"] as const).map((k) => ({
            key: k,
            label: t(`kinds.${k}`),
            href: k === "all" ? "/briefs" : `/briefs?kind=${k}`,
          }))}
        />
        {!items.length ? (
          kind ? (
            <p className="rounded-2xl border border-line px-5 py-6 text-[15px] text-muted">{t("emptyKind")}</p>
          ) : (
            <EmptyState icon={<Sparkles size={22} />} title={t("empty.title")} body={t("empty.body")} />
          )
        ) : (
          months.map((m) => (
            <section key={m.key} aria-label={m.label} className="flex flex-col gap-2">
              <h2 className="label-caps px-1">{m.label}</h2>
              <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line">
                {m.items.map((it) => (
                  <BriefRow key={it.id} it={it} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function BriefRow({ it }: { it: BriefListItem }) {
  const t = useTranslations("briefs");
  const locale = useLocale();
  const Icon = BRIEF_ICONS[it.kind];
  const fresh = !it.read && it.kind !== "daily";
  return (
    <li>
      <Link href={`/briefs/${it.id}`} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-panel" data-testid="brief-row">
        <Icon size={17} className="mt-0.5 shrink-0 text-muted" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate text-[15px]", fresh ? "font-semibold" : "font-medium")}>{it.title}</span>
            {fresh ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t("unread")} /> : null}
          </span>
          {it.preview ? <span className="line-clamp-2 text-[14px] text-muted">{it.preview}</span> : null}
        </span>
        <span className="shrink-0 text-[13px] text-muted" title={formatDay(it.day, locale, true)}>
          {relativeDayLabel(it.day, locale)}
        </span>
      </Link>
    </li>
  );
}
