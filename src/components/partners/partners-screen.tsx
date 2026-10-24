"use client";

import { AlertTriangle, CalendarClock, Handshake, Mail, MapPin, MoreHorizontal, Pencil, Phone, Plus, ScrollText, Search, Trash2, User, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { dayOf, formatDay, relativeDayLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { PartnersScreenData } from "@/server/views/partners";
import { ContactDialog, OrgDialog } from "./org-form";
import type { ContactRow, PartnerCardData } from "./types";

/** One organisation as a card (Attio's company list): what is late, what is next, who to call. */
function PartnerCard({ c, today }: { c: PartnerCardData; today: string }) {
  const t = useTranslations("partners.card");
  const tk = useTranslations("partners.kinds");
  const locale = useLocale();
  const title = c.shortName || c.name;
  const counts = [
    c.openTasks ? t("open", { count: c.openTasks }) : null,
    c.waitingOn ? t("waiting", { count: c.waitingOn }) : null,
  ].filter(Boolean);
  return (
    <li>
      <Link href={`/partners/${c.id}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line px-5 py-4 transition-colors hover:border-ink" data-testid="partner-card">
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-display text-[28px] leading-tight">{title}</span>
            {c.shortName ? <span className="truncate text-[14px] text-muted">{c.name}</span> : null}
          </span>
          {c.kind !== "partner" ? (
            <Badge variant="outline" size="sm" className="mt-2 shrink-0">
              {tk(c.kind as "partner")}
            </Badge>
          ) : null}
        </span>
        {c.provinces.length ? (
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">{c.provinces.join(", ")}</span>
          </span>
        ) : null}
        {c.statusLine ? <span className="line-clamp-2 text-[14px] text-ink-2">{c.statusLine}</span> : null}
        {c.lateReports.length ? (
          <span className="flex flex-col gap-1">
            {c.lateReports.map((r) => (
              <span key={r.label} className="flex items-center gap-1.5 text-[13px] font-medium text-overdue">
                <AlertTriangle size={13} className="shrink-0" />
                {t("reportLate", { label: r.label, days: r.daysLate })}
              </span>
            ))}
          </span>
        ) : null}
        <span className="mt-auto flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[13px] text-muted">
          {counts.length || c.overdue ? (
            <span className="flex flex-wrap gap-x-2">
              {counts.join(" · ")}
              {c.overdue ? <span className="font-medium text-overdue">{(counts.length ? "· " : "") + t("overdue", { count: c.overdue })}</span> : null}
            </span>
          ) : (
            <span>{t("nothingOpen")}</span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarClock size={13} className="shrink-0" />
            {c.nextMeeting ? (
              <span className="truncate">{t("nextMeeting", { date: relativeDayLabel(dayOf(c.nextMeeting.startsAt), locale, today) })}</span>
            ) : (
              <span>{t("noMeeting")}</span>
            )}
          </span>
          {c.nextReport ? (
            <span className="flex items-center gap-1.5">
              <ScrollText size={13} className="shrink-0" />
              <span className="truncate">{t("nextReport", { label: c.nextReport.label, date: formatDay(c.nextReport.due, locale) })}</span>
            </span>
          ) : null}
          {c.focal ? (
            <span className="flex items-center gap-1.5">
              <User size={13} className="shrink-0" />
              <span className="truncate">{c.focal.name}</span>
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** "Kişiler": every work contact, searchable, with one-tap email and phone. */
function ContactsTable({ rows, orgs }: { rows: ContactRow[]; orgs: PartnersScreenData["orgs"] }) {
  const t = useTranslations("partners.contacts");
  const tc = useTranslations("common");
  const shell = useShell();
  const trash = useTrash();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const needle = q.trim().toLocaleLowerCase("tr");
  const list = needle
    ? rows.filter((r) => [r.name, r.role, r.orgName, r.email, r.phone].some((v) => v?.toLocaleLowerCase("tr").includes(needle)))
    : rows;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex max-w-[420px] items-center gap-2 rounded-full border border-line-strong px-3.5 focus-within:border-ink">
        <Search size={16} className="shrink-0 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={tc("search")} className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
      </label>
      {list.length === 0 ? (
        <p className="px-1 text-[14px] text-muted">{tc("noResults")}</p>
      ) : (
        <ul className="flex flex-col">
          <li className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_150px_40px] gap-4 border-b border-line px-3 pb-2 text-[12px] font-medium uppercase tracking-wide text-muted md:grid" aria-hidden>
            <span>{t("name")}</span>
            <span>{t("organisation")}</span>
            <span>{t("email")}</span>
            <span>{t("phone")}</span>
            <span />
          </li>
          {list.map((r) => (
            <li
              key={r.id}
              id={r.id}
              className="group grid scroll-mt-24 grid-cols-[minmax(0,1fr)_40px] items-center gap-x-4 gap-y-0.5 border-b border-line-soft px-3 py-2.5 last:border-0 target:bg-accent-soft/40 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_150px_40px]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-medium">{r.name}</span>
                {r.role ? <span className="truncate text-[13px] text-muted">{r.role}</span> : null}
              </span>
              <span className="col-start-1 min-w-0 truncate text-[14px] md:col-start-auto">
                {r.organisationId ? (
                  <Link href={`/partners/${r.organisationId}?contact=${r.id}`} className="hover:underline">
                    {r.orgName}
                  </Link>
                ) : (
                  <span className="text-muted">{t("noOrg")}</span>
                )}
              </span>
              <span className="col-start-1 min-w-0 truncate text-[14px] md:col-start-auto">
                {r.email ? (
                  <a href={`mailto:${r.email}`} className="inline-flex max-w-full items-center gap-1.5 hover:underline">
                    <Mail size={13} className="shrink-0 text-muted" />
                    <span className="truncate">{r.email}</span>
                  </a>
                ) : null}
              </span>
              <span className="col-start-1 text-[14px] tabular-nums md:col-start-auto">
                {r.phone ? (
                  <a href={`tel:${r.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Phone size={13} className="shrink-0 text-muted" />
                    {r.phone}
                  </a>
                ) : null}
              </span>
              {!shell.readOnly ? (
                <span className="col-start-2 row-span-4 row-start-1 self-start md:col-start-auto md:row-span-1 md:row-start-auto md:self-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-9" aria-label={t("menu", { name: r.name })}>
                        <MoreHorizontal size={17} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setEditing(r)}>
                        <Pencil size={15} />
                        {tc("edit")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger onSelect={() => trash("contact", r.id, { title: r.name })}>
                        <Trash2 size={15} />
                        {tc("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? <ContactDialog open onOpenChange={(v) => !v && setEditing(null)} orgs={orgs} initial={editing} /> : null}
    </div>
  );
}

/** "Ortaklar": the three partners first, then donors and ministries, then everyone she works with. */
export function PartnersScreen({ data }: { data: PartnersScreenData }) {
  const t = useTranslations("partners");
  const router = useRouter();
  const shell = useShell();
  const [orgOpen, setOrgOpen] = useState<string | null>(data.newOrg);
  const [contactOpen, setContactOpen] = useState(false);
  useScreenContext({ kind: "partners", title: t("title") });

  const closeOrg = () => {
    setOrgOpen(null);
    if (data.newOrg) router.replace(data.tab === "partners" ? "/partners" : `/partners?tab=${data.tab}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          !shell.readOnly ? (
            <>
              {data.tab === "contacts" ? (
                <Button variant="outline" onClick={() => setContactOpen(true)}>
                  <Plus size={16} />
                  {t("newContact")}
                </Button>
              ) : null}
              <Button onClick={() => setOrgOpen(data.tab === "stakeholders" ? "other" : "partner")} data-testid="new-org">
                <Plus size={16} />
                {data.tab === "stakeholders" ? t("newStakeholder") : t("newOrg")}
              </Button>
            </>
          ) : null
        }
      />

      <SegmentedLinks
        active={data.tab}
        items={[
          { key: "partners", label: t("tabs.partners"), href: "/partners", count: data.counts.partners },
          { key: "stakeholders", label: t("tabs.stakeholders"), href: "/partners?tab=stakeholders", count: data.counts.stakeholders },
          { key: "contacts", label: t("tabs.contacts"), href: "/partners/contacts", count: data.counts.contacts },
        ]}
      />

      {data.tab === "contacts" ? (
        data.contacts.length ? (
          <ContactsTable rows={data.contacts} orgs={data.orgs} />
        ) : (
          <EmptyState
            title={t("contacts.emptyTitle")}
            body={t("contacts.emptyBody")}
            icon={<Users size={22} />}
            action={
              !shell.readOnly ? (
                <Button onClick={() => setContactOpen(true)}>
                  <Plus size={16} />
                  {t("newContact")}
                </Button>
              ) : undefined
            }
          />
        )
      ) : data.cards.length ? (
        <ul className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", data.cards.length >= 3 ? "xl:grid-cols-3" : "")}>
          {data.cards.map((c) => (
            <PartnerCard key={c.id} c={c} today={data.today} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={data.tab === "stakeholders" ? t("emptyStakeholdersTitle") : t("emptyTitle")}
          body={data.tab === "stakeholders" ? t("emptyStakeholdersBody") : t("emptyBody")}
          icon={<Handshake size={22} />}
          action={
            !shell.readOnly ? (
              <Button onClick={() => setOrgOpen(data.tab === "stakeholders" ? "other" : "partner")}>
                <Plus size={16} />
                {data.tab === "stakeholders" ? t("newStakeholder") : t("newOrg")}
              </Button>
            ) : undefined
          }
        />
      )}

      {orgOpen ? <OrgDialog open onOpenChange={(v) => !v && closeOrg()} defaultKind={orgOpen} /> : null}
      {contactOpen ? <ContactDialog open onOpenChange={setContactOpen} orgs={data.orgs} /> : null}
    </div>
  );
}
