"use client";

import { Calendar, Check, ChevronDown, Handshake, Search, Sparkles, User } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EntityIcon } from "@/components/common/entity-icon";
import { Highlight } from "@/components/common/highlight";
import { useScreenContext } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { dayOf, formatDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SearchPageData } from "@/server/views/search";

type Hit = SearchPageData["hits"][number];

const chipCls = (on: boolean) =>
  cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors", on ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:border-ink");

function HitRow({ h, q }: { h: Hit; q: string }) {
  const t = useTranslations("search.page");
  const locale = useLocale();
  return (
    <li>
      <Link href={h.href} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-panel" data-testid="search-hit">
        <EntityIcon type={h.type} size={17} className="mt-0.5 shrink-0 text-muted" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-medium">
            <Highlight text={h.title} query={q} />
          </span>
          {h.snippet ? (
            <span className="line-clamp-2 text-[14px] text-ink-2">
              <Highlight text={h.snippet} query={q} />
            </span>
          ) : null}
          <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            {h.occurredAt ? <span>{formatDay(dayOf(h.occurredAt), locale, true)}</span> : null}
            {h.page ? <span>{t("page", { page: h.page })}</span> : null}
            {h.match === "meaning" ? (
              <Badge variant="outline" size="sm">
                {t("byMeaning")}
              </Badge>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** "Ara" (Dropbox Dash): one box for everything, grouped by kind, filtered like Drive. */
export function SearchScreen({ data }: { data: SearchPageData }) {
  const t = useTranslations("search.page");
  const tk = useTranslations("common.kindsPlural");
  const tc = useTranslations("common");
  useScreenContext({ kind: "search", title: data.q ? `${t("title")}: ${data.q}` : t("title") });

  const href = (patch: Partial<Record<"type" | "org" | "date" | "owner", string | null>>) => {
    const p = new URLSearchParams();
    const next = { type: data.type, org: data.org, date: data.date, owner: data.owner, ...patch };
    if (data.q) p.set("q", data.q);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return `/search?${p}`;
  };
  const orgName = (id: string | null) => {
    const o = data.orgs.find((x) => x.id === id);
    return o ? o.shortName || o.name : null;
  };
  const dateLabel = (d: string | null) => (d ? t(`dates.${d}` as "dates.7d") : t("anyDate"));
  const groups = data.order.map((type) => ({ type, items: data.hits.filter((h) => h.type === type) }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex flex-col gap-3">
        <form action="/search" className="flex flex-wrap items-center gap-2" role="search">
          <label className="flex h-12 min-w-[260px] flex-1 items-center gap-2.5 rounded-full border border-line-strong px-4 focus-within:border-ink">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              name="q"
              defaultValue={data.q}
              autoFocus={!data.q}
              placeholder={t("placeholder")}
              aria-label={tc("search")}
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
              data-testid="search-input"
            />
            {data.type ? <input type="hidden" name="type" value={data.type} /> : null}
            {data.org ? <input type="hidden" name="org" value={data.org} /> : null}
            {data.date ? <input type="hidden" name="date" value={data.date} /> : null}
            {data.owner ? <input type="hidden" name="owner" value={data.owner} /> : null}
          </label>
          <Button type="submit" className="h-12">
            {tc("search")}
          </Button>
          {data.q && data.aiReady ? (
            <Button variant="outline" className="h-12" asChild>
              <Link href={`/search/ask?q=${encodeURIComponent(data.q)}`}>
                <Sparkles size={16} />
                {t("askClaude")}
              </Link>
            </Button>
          ) : null}
        </form>

        {data.q ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={t("filters")}>
            <Link href={href({ type: null })} className={chipCls(!data.type)} aria-current={!data.type ? "page" : undefined}>
              {tc("all")}
              <span className={cn("text-[12px]", !data.type ? "text-on-ink/70" : "text-faint")}>{data.total}</span>
            </Link>
            {data.order.map((type) => (
              <Link key={type} href={href({ type })} className={chipCls(data.type === type)} aria-current={data.type === type ? "page" : undefined}>
                <EntityIcon type={type} size={14} />
                {tk(type as "task")}
                <span className={cn("text-[12px]", data.type === type ? "text-on-ink/70" : "text-faint")}>{data.counts[type]}</span>
              </Link>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
            {data.orgs.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={chipCls(Boolean(data.org))}>
                    <Handshake size={14} />
                    {orgName(data.org) ?? t("anyPartner")}
                    <ChevronDown size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem href={href({ org: null })}>
                    {!data.org ? <Check size={15} /> : <span className="w-[15px]" />}
                    {t("anyPartner")}
                  </DropdownMenuItem>
                  {data.orgs.map((o) => (
                    <DropdownMenuItem key={o.id} href={href({ org: o.id })}>
                      {data.org === o.id ? <Check size={15} /> : <span className="w-[15px]" />}
                      {o.shortName || o.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={chipCls(Boolean(data.date))}>
                  <Calendar size={14} />
                  {dateLabel(data.date)}
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {[null, "7d", "30d", "year"].map((d) => (
                  <DropdownMenuItem key={d ?? "any"} href={href({ date: d })}>
                    {data.date === d ? <Check size={15} /> : <span className="w-[15px]" />}
                    {dateLabel(d)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={chipCls(Boolean(data.owner))}>
                  <User size={14} />
                  {data.owner ? t(`owners.${data.owner}`) : t("anyOwner")}
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {[null, "me", "others"].map((o) => (
                  <DropdownMenuItem key={o ?? "any"} href={href({ owner: o })}>
                    {data.owner === o ? <Check size={15} /> : <span className="w-[15px]" />}
                    {o ? t(`owners.${o}` as "owners.me") : t("anyOwner")}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {data.loose ? <p className="-mt-2 text-[14px] text-muted">{t("loose")}</p> : null}

      {!data.q ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(["tipTurkish", "tipInside", "tipAsk"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1 rounded-2xl bg-panel px-5 py-4">
              <p className="text-[15px] font-medium">{t(`${k}Title`)}</p>
              <p className="text-[14px] text-muted">{t(`${k}Body`)}</p>
            </div>
          ))}
        </div>
      ) : data.hits.length === 0 ? (
        <EmptyState
          title={t("noResults", { q: data.q })}
          body={data.aiReady ? t("noResultsAsk") : t("noResultsBody")}
          icon={<Search size={22} />}
          action={
            data.aiReady ? (
              <Button variant="outline" asChild>
                <Link href={`/search/ask?q=${encodeURIComponent(data.q)}`}>
                  <Sparkles size={16} />
                  {t("askClaude")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : data.type ? (
        <ul className="flex flex-col" aria-label={tk(data.type as "task")}>
          {data.hits.map((h) => (
            <HitRow key={`${h.type}:${h.id}`} h={h} q={data.q} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.type} className="flex flex-col gap-1" aria-labelledby={`sg-${g.type}`}>
              <div className="flex items-baseline justify-between gap-2 px-3">
                <h2 id={`sg-${g.type}`} className="text-[14px] font-semibold text-ink-2">
                  {tk(g.type as "task")}
                </h2>
                {g.items.length > 5 ? (
                  <Link href={href({ type: g.type })} className="text-[13px] text-muted hover:text-ink hover:underline">
                    {t("seeAll", { count: g.items.length })}
                  </Link>
                ) : null}
              </div>
              <ul className="flex flex-col">
                {g.items.slice(0, 5).map((h) => (
                  <HitRow key={`${h.type}:${h.id}`} h={h} q={data.q} />
                ))}
              </ul>
            </section>
          ))}
          <p className="px-3 text-[13px] text-muted">{data.semantic ? t("modeBoth") : data.meaningAvailable ? t("modeKeyword") : t("modeKeywordOnly")}</p>
        </div>
      )}
    </div>
  );
}
