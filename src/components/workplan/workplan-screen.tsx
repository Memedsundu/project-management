"use client";

import { CalendarOff, ChevronDown, Download, FileSpreadsheet, ListFilter, MoreHorizontal, Plus, Sparkles, Wheat, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { proposePrepAction, summariseDelaysAction } from "@/app/(app)/workplan/actions";
import { ChatMarkdown } from "@/components/common/chat-markdown";
import { SuggestionCard } from "@/components/inbox/suggestion-card";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { ActivityDialog } from "./activity-form";
import { ActivitySheet } from "./activity-sheet";
import { ActivityTable } from "./activity-table";
import { WorkplanCalendar } from "./calendar";
import { HolidaysDialog, SeasonsDialog } from "./calendar-settings";
import { ImportDialog } from "./import-dialog";
import { orgName } from "./shared";
import { Timeline } from "./timeline";
import type { WorkplanData } from "./types";
import { useHrefWith } from "./use-href";

type DialogKind = "new" | "import" | "seasons" | "holidays" | null;

export function WorkplanScreen({ data }: { data: WorkplanData }) {
  const t = useTranslations("workplan");
  const tc = useTranslations("common");
  const shell = useShell();
  const router = useRouter();
  const hrefWith = useHrefWith();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prep" | "summary" | null>(null);
  // Prep ideas stay folded so the plan itself is the first thing on the screen; they are in the inbox too.
  const [showPrep, setShowPrep] = useState(false);
  const readOnly = shell.readOnly;
  const late = data.activities.filter((a) => a.late).length;
  const risk = data.activities.filter((a) => a.atRisk).length;
  const filtered = Boolean(data.filters.partner || data.filters.status);
  const nothing = data.activities.length === 0 && !filtered;

  const open = (id: string) => router.push(hrefWith({ open: id }), { scroll: false });
  const close = () => router.push(hrefWith({ open: null }), { scroll: false });

  const d = data.detail?.activity;
  useScreenContext(
    d
      ? { kind: "activity", id: d.id, title: `${d.code} ${d.title}`, detail: [d.startDate, d.endDate].filter(Boolean).join(" – ") || undefined }
      : { kind: "workplan", title: t("title"), detail: `${data.activities.length} activities, ${late} late, ${risk} at risk` },
  );

  async function prep() {
    setBusy("prep");
    const res = await runAction(proposePrepAction(null));
    setBusy(null);
    if (!res) return;
    toast(res.suggestions ? t("ai.prepDone", { count: res.suggestions, tasks: res.tasks }) : t("ai.nothing"));
    if (res.suggestions) setShowPrep(true);
  }

  async function summarise() {
    setBusy("summary");
    const res = await runAction(summariseDelaysAction());
    setBusy(null);
    if (res) setSummary(res.text);
  }

  const views = (["timeline", "table", "calendar"] as const).map((v) => ({ key: v, label: t(`views.${v}`), href: hrefWith({ view: v === "timeline" ? null : v, open: null }) }));
  const subtitle = nothing
    ? t("subtitle")
    : [t("summary", { count: data.activities.length }), late ? t("summaryLate", { count: late }) : null, risk ? t("summaryRisk", { count: risk }) : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={<span className={cn(late && "[&>span]:text-accent-ink")}>{subtitle}</span>}
        actions={
          <>
            {!readOnly && data.aiReady && !nothing ? (
              <Button variant="outline" onClick={prep} disabled={busy === "prep"} data-testid="wp-prep">
                <Sparkles size={16} />
                {busy === "prep" ? t("ai.proposing") : t("ai.prep")}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("more")}>
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {!readOnly ? (
                  <DropdownMenuItem onSelect={() => setDialog("import")}>
                    <FileSpreadsheet size={15} />
                    {t("import.title")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <a href="/api/workplan/export" download>
                    <Download size={15} />
                    {t("export")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDialog("seasons")}>
                  <Wheat size={15} />
                  {t("seasons")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("holidays")}>
                  <CalendarOff size={15} />
                  {t("holidays")}
                </DropdownMenuItem>
                {data.aiReady && !nothing ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={summarise} disabled={busy === "summary"}>
                      <Sparkles size={15} />
                      {t("ai.summarise")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {!readOnly ? (
              <Button onClick={() => setDialog("new")} data-testid="wp-new">
                <Plus size={16} />
                {t("newActivity")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedLinks items={views} active={data.view} />
        {data.view !== "calendar" ? (
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  {t(`group.${data.group}`)}
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{t("group.label")}</DropdownMenuLabel>
                {(["output", "partner", "none"] as const).map((g) => (
                  <DropdownMenuItem key={g} href={hrefWith({ group: g === "output" ? null : g })}>
                    {t(`group.${g}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={filtered ? "secondary" : "outline"} size="sm" data-testid="wp-filter">
                  <ListFilter size={14} />
                  {[data.filters.partner ? orgName(data.orgs, data.filters.partner) : null, data.filters.status ? (data.filters.status === "late" ? t("filters.late") : t(`status.${data.filters.status}`)) : null].filter(Boolean).join(" · ") || t("filters.label")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-[70vh] overflow-y-auto">
                <DropdownMenuLabel>{t("filters.partner")}</DropdownMenuLabel>
                <DropdownMenuItem href={hrefWith({ partner: null })}>{t("filters.allPartners")}</DropdownMenuItem>
                {data.orgs.map((o) => (
                  <DropdownMenuItem key={o.id} href={hrefWith({ partner: o.id })}>
                    {o.shortName || o.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("filters.status")}</DropdownMenuLabel>
                <DropdownMenuItem href={hrefWith({ status: null })}>{t("filters.allStatuses")}</DropdownMenuItem>
                <DropdownMenuItem href={hrefWith({ status: "late" })}>{t("filters.late")}</DropdownMenuItem>
                {(["planned", "ongoing", "done", "delayed", "canceled"] as const).map((s) => (
                  <DropdownMenuItem key={s} href={hrefWith({ status: s })}>
                    {t(`status.${s}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {filtered ? (
              <Link href={hrefWith({ partner: null, status: null })} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[14px] text-muted hover:bg-panel hover:text-ink">
                <X size={14} />
                {t("filters.clear")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {summary ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-line px-5 py-4" aria-live="polite" data-testid="wp-summary">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <Sparkles size={15} />
              {t("ai.summaryTitle")}
            </h2>
            <Button variant="ghost" size="icon-sm" onClick={() => setSummary(null)} aria-label={tc("close")}>
              <X size={16} />
            </Button>
          </div>
          <ChatMarkdown text={summary} />
        </section>
      ) : null}

      {data.prep.length && !data.detail ? (
        <section className="flex flex-col gap-3" data-testid="wp-prep-list">
          <button
            type="button"
            onClick={() => setShowPrep((v) => !v)}
            aria-expanded={showPrep}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-line px-4 text-[14px] font-medium hover:bg-panel"
            data-testid="wp-prep-toggle"
          >
            <Sparkles size={15} />
            {t("ai.prepTitle", { count: data.prep.length })}
            <ChevronDown size={15} className={cn("text-muted transition-transform", showPrep && "rotate-180")} />
          </button>
          {showPrep ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.prep.map((s) => (
                <SuggestionCard key={s.id} s={s} readOnly={readOnly} folderNames={{}} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {nothing && data.view !== "calendar" ? (
        <EmptyState
          icon={<FileSpreadsheet size={22} />}
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            !readOnly ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDialog("import")}>
                  <FileSpreadsheet size={16} />
                  {t("import.title")}
                </Button>
                <Button variant="outline" onClick={() => setDialog("new")}>
                  <Plus size={16} />
                  {t("newActivity")}
                </Button>
                <Button variant="ghost" onClick={() => setDialog("seasons")}>
                  <Wheat size={16} />
                  {t("seasons")}
                </Button>
              </div>
            ) : null
          }
        />
      ) : null}

      {data.view === "timeline" && !nothing ? <Timeline data={data} onOpen={open} readOnly={readOnly} /> : null}
      {data.view === "table" && !nothing ? <ActivityTable data={data} onOpen={open} readOnly={readOnly} /> : null}
      {data.view === "calendar" ? <WorkplanCalendar data={data} /> : null}
      {filtered && data.activities.length === 0 && data.view !== "calendar" ? <p className="text-[14px] text-muted">{t("filters.none")}</p> : null}

      <ActivitySheet data={data} readOnly={readOnly} onClose={close} onOpen={open} />
      {dialog === "new" ? <ActivityDialog open onOpenChange={(v) => !v && setDialog(null)} data={data} onCreated={open} /> : null}
      <ImportDialog open={dialog === "import"} onOpenChange={(v) => setDialog(v ? "import" : null)} data={data} />
      <SeasonsDialog open={dialog === "seasons"} onOpenChange={(v) => setDialog(v ? "seasons" : null)} data={data} readOnly={readOnly} />
      <HolidaysDialog open={dialog === "holidays"} onOpenChange={(v) => setDialog(v ? "holidays" : null)} data={data} readOnly={readOnly} />
    </div>
  );
}
