"use client";

import { CalendarClock, CalendarPlus, ExternalLink, FolderOpen, Gavel, Loader2, MoreHorizontal, Pencil, Sparkles, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { partnerBriefAction, updateOrganisationAction } from "@/app/(app)/partners/actions";
import { LinksPanel } from "@/components/common/links-panel";
import { useTrash } from "@/components/common/use-trash";
import { safeUrl } from "@/components/meetings/types";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { dayOf, daysBetween, formatDay, formatTime, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { ContactDialog, OrgDialog } from "./org-form";
import { BriefCard, MineSection, OwedSection, PeopleSection, ReportCalendar, Timeline } from "./partner-parts";
import type { PartnerPageData } from "./types";

/** The one-line status ("Saha ekibi Haziran'da Adana'da"), edited in place like an Attio attribute. */
function StatusLine({ orgId, value, readOnly }: { orgId: string; value: string | null; readOnly: boolean }) {
  const t = useTranslations("partners.page");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const save = async () => {
    setEditing(false);
    if (text.trim() === (value ?? "")) return;
    await runAction(updateOrganisationAction(orgId, { statusLine: text.trim() || null }));
  };
  if (editing)
    return (
      <input
        autoFocus
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            setText(value ?? "");
            setEditing(false);
          }
        }}
        aria-label={t("statusLine")}
        className="h-11 w-full max-w-[70ch] rounded-xl border border-ink bg-transparent px-3 text-[16px] outline-none"
      />
    );
  if (readOnly) return value ? <p className="max-w-[70ch] text-[16px] text-ink-2">{value}</p> : null;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn("-mx-3 min-h-11 max-w-[70ch] rounded-xl px-3 text-left text-[16px] hover:bg-panel", value ? "text-ink-2" : "text-faint")}
      data-testid="status-line"
    >
      {value || t("statusPlaceholder")}
    </button>
  );
}

/** Attio's attribute strip: the facts she checks before every call. */
function Facts({ data }: { data: PartnerPageData }) {
  const t = useTranslations("partners.facts");
  const tr = useTranslations("partners.rhythms");
  const locale = useLocale();
  const { org } = data;
  const focal = data.contacts.find((c) => c.id === org.focalContactId);
  const left = org.agreementEnd ? daysBetween(data.today, org.agreementEnd) : null;
  const web = safeUrl(org.website);
  const items: { key: string; label: string; value: React.ReactNode }[] = [
    {
      key: "agreement",
      label: t("agreement"),
      value:
        org.agreementStart || org.agreementEnd ? (
          <span>
            {[org.agreementStart ? formatDay(org.agreementStart, locale, true) : "…", org.agreementEnd ? formatDay(org.agreementEnd, locale, true) : "…"].join(" – ")}
            {left !== null && left < 0 ? <span className="text-muted"> · {t("ended")}</span> : null}
            {left !== null && left >= 0 && left <= 90 ? <span className="font-medium text-overdue"> · {t("daysLeft", { days: left })}</span> : null}
          </span>
        ) : (
          <span className="text-faint">{t("notSet")}</span>
        ),
    },
    {
      key: "rhythm",
      label: t("reporting"),
      value: org.reportingRhythm === "none" ? <span className="text-faint">{tr("none")}</span> : tr(org.reportingRhythm as "none"),
    },
    { key: "focal", label: t("focal"), value: focal ? focal.name : <span className="text-faint">{t("notSet")}</span> },
    {
      key: "files",
      label: t("files"),
      value: (
        <Link href={`/files?org=${org.id}`} className="hover:underline">
          {t("fileCount", { count: data.docCount })}
        </Link>
      ),
    },
  ];
  if (web)
    items.push({
      key: "web",
      label: t("website"),
      value: (
        <a href={web} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
          {web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          <ExternalLink size={12} />
        </a>
      ),
    });
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-line-soft py-3">
      {items.map((i) => (
        <div key={i.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[12px] font-medium uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="text-[15px]">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One partner on one screen (Attio record page): what they owe, what she owes, reports, the timeline and the people. */
export function PartnerPage({ data, history }: { data: PartnerPageData; history: React.ReactNode }) {
  const t = useTranslations("partners.page");
  const tp = useTranslations("partners");
  const tk = useTranslations("partners.kinds");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const trash = useTrash();
  const { org } = data;
  const readOnly = shell.readOnly;
  const [editOpen, setEditOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  useScreenContext({ kind: "organisation", id: org.id, title: org.shortName ? `${org.shortName} (${org.name})` : org.name, detail: org.statusLine ?? undefined });

  const isPartner = org.kind === "partner";
  const partners = data.orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName }));
  const runBrief = async () => {
    setBriefBusy(true);
    const res = await runAction(partnerBriefAction(org.id, locale === "en" ? "en" : "tr"));
    setBriefBusy(false);
    if (res) setBrief(res.text);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          compact
          eyebrow={
            <nav className="flex flex-wrap items-center gap-1" aria-label={t("breadcrumb")}>
              <Link href={isPartner ? "/partners" : "/partners?tab=stakeholders"} className="hover:text-ink">
                {isPartner ? tp("title") : tp("tabs.stakeholders")}
              </Link>
            </nav>
          }
          title={<span className="break-words">{org.name}</span>}
          subtitle={[org.shortName, tk(org.kind as "partner"), org.provinces.join(", ")].filter(Boolean).join(" · ")}
          actions={
            <>
              {shell.aiConfigured ? (
                <Button variant="outline" onClick={runBrief} disabled={briefBusy} data-testid="brief-button">
                  {briefBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {t("brief")}
                </Button>
              ) : null}
              {!readOnly ? (
                <Button asChild>
                  <Link href={`/meetings/new?org=${org.id}`}>
                    <CalendarPlus size={16} />
                    {t("newMeeting")}
                  </Link>
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("menu")}>
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[240px]">
                  {!readOnly ? (
                    <>
                      <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                        <Pencil size={15} />
                        {tc("edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setContactOpen(true)}>
                        <UserPlus size={15} />
                        {t("addContact")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuItem href={`/files?org=${org.id}`}>
                    <FolderOpen size={15} />
                    {t("openFiles")}
                  </DropdownMenuItem>
                  <DropdownMenuItem href={`/meetings?org=${org.id}`}>
                    <CalendarClock size={15} />
                    {t("allMeetings")}
                  </DropdownMenuItem>
                  <DropdownMenuItem href={`/meetings/decisions?org=${org.id}`}>
                    <Gavel size={15} />
                    {t("allDecisions")}
                  </DropdownMenuItem>
                  {!readOnly ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger onSelect={() => trash("organisation", org.id, { title: org.name, redirectTo: "/partners" })}>
                        <Trash2 size={15} />
                        {t("delete")}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
        <StatusLine key={org.statusLine ?? ""} orgId={org.id} value={org.statusLine} readOnly={readOnly} />
        <Facts data={data} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {brief ? <BriefCard text={brief} busy={briefBusy} onRegenerate={runBrief} onClose={() => setBrief(null)} /> : null}
          <OwedSection data={data} partners={partners} readOnly={readOnly} />
          <MineSection data={data} partners={partners} readOnly={readOnly} />
          {isPartner || org.reportingRhythm !== "none" ? <ReportCalendar data={data} readOnly={readOnly} onEditRhythm={() => setEditOpen(true)} /> : null}
          <Timeline data={data} />
          {history}
        </div>

        <aside className="flex flex-col gap-7">
          <PeopleSection data={data} readOnly={readOnly} onAdd={() => setContactOpen(true)} />

          <section className="flex flex-col gap-2" aria-labelledby="p-meetings">
            <div className="flex items-center justify-between gap-2">
              <h2 id="p-meetings" className="label-caps">
                {t("meetings")}
              </h2>
              <Link href={`/meetings?org=${org.id}`} className="text-[13px] text-muted hover:text-ink hover:underline">
                {t("seeAll")}
              </Link>
            </div>
            {data.upcoming.length ? (
              <ul className="flex flex-col">
                {data.upcoming.map((m) => (
                  <li key={m.id}>
                    <Link href={`/meetings/${m.id}`} className={cn("flex items-start gap-3 rounded-xl px-3 py-2 hover:bg-panel", m.status === "canceled" && "opacity-55")}>
                      <span className="w-[70px] shrink-0 text-[13px] tabular-nums text-ink-2">
                        <span className="block font-medium text-ink">{relativeDayLabel(dayOf(m.startsAt), locale, data.today)}</span>
                        {formatTime(m.startsAt)}
                      </span>
                      <span className={cn("min-w-0 flex-1 text-[14px]", m.status === "canceled" && "line-through")}>{m.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">{t("noUpcoming")}</p>
            )}
            {data.lastMeeting ? (
              <p className="px-3 text-[13px] text-muted">
                {t("lastMeeting")}{" "}
                <Link href={`/meetings/${data.lastMeeting.id}`} className="text-ink underline-offset-4 hover:underline">
                  {data.lastMeeting.title}
                </Link>{" "}
                · {formatDay(dayOf(data.lastMeeting.startsAt), locale)}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="p-decisions">
            <div className="flex items-center justify-between gap-2">
              <h2 id="p-decisions" className="label-caps">
                {t("decisions")}
              </h2>
              {data.decisions.length ? (
                <Link href={`/meetings/decisions?org=${org.id}`} className="text-[13px] text-muted hover:text-ink hover:underline">
                  {t("seeAll")}
                </Link>
              ) : null}
            </div>
            {data.decisions.length ? (
              <ul className="flex flex-col gap-2.5">
                {data.decisions.map((d) => (
                  <li key={d.id} className="flex flex-col gap-0.5">
                    <span className="line-clamp-3 text-[14px]">{d.text}</span>
                    <span className="text-[12px] text-muted">
                      {formatDay(d.decidedOn, locale)}
                      {d.meetingId ? (
                        <>
                          {" · "}
                          <Link href={`/meetings/${d.meetingId}`} className="hover:text-ink hover:underline">
                            {d.meetingTitle}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">{t("noDecisions")}</p>
            )}
          </section>

          {org.notes ? (
            <section className="flex flex-col gap-2" aria-labelledby="p-notes">
              <h2 id="p-notes" className="label-caps">
                {t("notes")}
              </h2>
              <p className="whitespace-pre-wrap text-[14px] text-ink-2">{org.notes}</p>
            </section>
          ) : null}

          <LinksPanel self={{ type: "organisation", id: org.id }} items={data.links} readOnly={readOnly} />
        </aside>
      </div>

      {editOpen ? <OrgDialog open onOpenChange={setEditOpen} initial={org} /> : null}
      {contactOpen ? <ContactDialog open onOpenChange={setContactOpen} orgs={data.orgs} defaultOrgId={org.id} focal={!org.focalContactId} /> : null}
    </div>
  );
}
