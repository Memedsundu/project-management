"use client";

import { Download, Gavel, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { addDecisionAction } from "@/app/(app)/meetings/actions";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { formatDay, parseDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { DecisionsScreenData } from "@/server/views/meetings";
import { MeetingTabs, PartnerFilter } from "./meetings-screen";
import type { DecisionRow, Org } from "./types";

/** One decision: the day, the words, the meeting it came from. */
export function DecisionList({ rows, orgs }: { rows: DecisionRow[]; orgs: Org[] }) {
  const locale = useLocale();
  const groups = new Map<string, DecisionRow[]>();
  for (const d of rows) groups.set(d.decidedOn.slice(0, 7), [...(groups.get(d.decidedOn.slice(0, 7)) ?? []), d]);
  const month = (key: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric" }).format(parseDay(`${key}-01`));
  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} className="flex flex-col gap-1" aria-labelledby={`dm-${key}`}>
          <h2 id={`dm-${key}`} className="text-[14px] font-semibold text-ink-2">
            {month(key)}
          </h2>
          <ul className="flex flex-col">
            {list.map((d) => (
              <li key={d.id} id={d.id} className="flex scroll-mt-24 items-start gap-4 border-b border-line-soft py-2.5 last:border-0 target:bg-accent-soft/40">
                <span className="w-[56px] shrink-0 pt-0.5 text-[13px] tabular-nums text-muted">{formatDay(d.decidedOn, locale)}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px]">{d.text}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                    {d.meetingId ? (
                      <Link href={`/meetings/${d.meetingId}`} className="underline-offset-4 hover:text-ink hover:underline">
                        {d.meetingTitle}
                      </Link>
                    ) : null}
                    {d.orgIds.map((id) => {
                      const o = orgs.find((x) => x.id === id);
                      return o ? <span key={id}>· {o.shortName || o.name}</span> : null;
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Kararlar": the log of everything agreed with partners and the donor, searchable. */
export function DecisionsScreen({ data }: { data: DecisionsScreenData }) {
  const t = useTranslations("meetings.decisionsLog");
  const tc = useTranslations("common");
  const shell = useShell();
  const [text, setText] = useState("");
  const [day, setDay] = useState(data.today);
  const [org, setOrg] = useState(data.org ?? "");
  const [busy, setBusy] = useState(false);
  useScreenContext({ kind: "decisions", title: t("title") });
  const exportHref = `/api/meetings/decisions/export${data.org || data.q ? `?${new URLSearchParams({ ...(data.org ? { org: data.org } : {}), ...(data.q ? { q: data.q } : {}) })}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          data.rows.length ? (
            <Button variant="outline" asChild>
              <a href={exportHref}>
                <Download size={16} />
                {t("export")}
              </a>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3">
        <MeetingTabs active="decisions" org={data.org} />
        <div className="flex flex-wrap items-center gap-3">
          <form action="/meetings/decisions" className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-line-strong px-3.5 focus-within:border-ink">
            <Search size={16} className="shrink-0 text-muted" />
            {data.org ? <input type="hidden" name="org" value={data.org} /> : null}
            <input name="q" defaultValue={data.q ?? ""} placeholder={t("searchPlaceholder")} aria-label={tc("search")} className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
          </form>
          <PartnerFilter orgs={data.orgs} active={data.org} base={`/meetings/decisions${data.q ? `?q=${encodeURIComponent(data.q)}` : ""}`} />
        </div>
      </div>

      {!shell.readOnly ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-line px-4 py-3 sm:flex-row sm:items-center"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || busy) return;
            setBusy(true);
            const res = await runAction(addDecisionAction({ text: text.trim(), decidedOn: day || null, organisationId: org || null }), { success: t("added") });
            setBusy(false);
            if (res) setText("");
          }}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Plus size={18} className="shrink-0 text-muted" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("addPlaceholder")}
              aria-label={t("add")}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
            />
          </span>
          <span className="flex gap-2">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label={tc("date")} className="h-10 w-[150px]" />
            {data.orgs.length ? (
              <Select value={org} onChange={(e) => setOrg(e.target.value)} aria-label={tc("partner")} className="h-10 w-[140px]">
                <option value="">{t("noPartner")}</option>
                {data.orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <Button type="submit" size="sm" className="h-10" disabled={!text.trim() || busy}>
              {tc("add")}
            </Button>
          </span>
        </form>
      ) : null}

      {data.rows.length ? (
        <DecisionList rows={data.rows} orgs={data.orgs} />
      ) : (
        <EmptyState title={data.q ? t("noMatch") : t("emptyTitle")} body={data.q ? undefined : t("emptyBody")} icon={<Gavel size={22} />} />
      )}
    </div>
  );
}
