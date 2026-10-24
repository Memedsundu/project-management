"use client";

import { BarChart3, Check, Copy, Download, FileDown, LayoutTemplate, Lock, MoreHorizontal, Pencil, Plus, Printer, Save, Sparkles, Trash2, Undo2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { addSectionAction, addSourcesAction, removeSourceAction, reorderSectionsAction, suggestSourcesAction, updateReportAction } from "@/app/(app)/reports/actions";
import { StudioPane } from "@/components/collections/studio-pane";
import { EntityIcon } from "@/components/common/entity-icon";
import { EntityPicker } from "@/components/common/entity-picker";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tip } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";
import type { SourceIdea } from "@/server/services/reports";
import type { ReportPageData } from "@/server/views/reports";
import { DueLabel } from "./reports-screen";
import { DuplicateDialog, ReportDetailsDialog, SaveTemplateDialog } from "./report-dialogs";
import { SectionCard, wordsOf } from "./section-card";
import { NewVisualDialog } from "./visual-dialogs";

type Pane = "sections" | "sources" | "studio";
const SOURCE_TYPES: EntityType[] = ["document", "note", "meeting", "decision", "indicator", "activity", "organisation", "collection"];
const keyOf = (i: { type: string; id: string }) => `${i.type}:${i.id}`;

/** "Dönemden öner": what the period points to, all ticked; she adds the ones she wants. */
function SuggestDialog({ data, ideas, onClose }: { data: ReportPageData; ideas: SourceIdea[]; onClose: () => void }) {
  const t = useTranslations("reports.sources");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const chosen = ideas.filter((i) => !off.has(keyOf(i)));
  const groups = (["values", "period", "dates"] as const).map((reason) => ({ reason, list: ideas.filter((i) => i.reason === reason) })).filter((g) => g.list.length);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t("suggestTitle")} description={data.periodLabel ? t("suggestHint", { period: data.periodLabel }) : t("suggestHintNoPeriod")} wide>
        {ideas.length ? (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <section key={g.reason} className="flex flex-col gap-1">
                <h3 className="label-caps pb-1">{t(`reasons.${g.reason}`)}</h3>
                <ul className="flex flex-col">
                  {g.list.map((i) => {
                    const k = keyOf(i);
                    return (
                      <li key={k}>
                        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-2 hover:bg-panel" data-testid="suggest-row">
                          <Checkbox
                            checked={!off.has(k)}
                            onCheckedChange={(v) => {
                              const next = new Set(off);
                              if (v) next.delete(k);
                              else next.add(k);
                              setOff(next);
                            }}
                          />
                          <EntityIcon type={i.type} size={15} className="shrink-0 text-muted" />
                          <span className="min-w-0 flex-1 truncate text-[14px]">{i.title}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-4">
              <span className="mr-auto text-[13px] text-muted">{t("chosen", { count: chosen.length, total: ideas.length })}</span>
              <Button variant="ghost" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button
                disabled={!chosen.length || busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await runAction(addSourcesAction(data.id, chosen.map((i) => ({ type: i.type as "document", id: i.id }))), { success: t("addedMany", { count: chosen.length }) });
                  setBusy(false);
                  if (res) onClose();
                }}
                data-testid="suggest-add"
              >
                <Plus size={16} />
                {t("addChosen", { count: chosen.length })}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[14px] text-muted">{t("suggestNone")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Kaynaklar": the only material Claude reads for this report (NotebookLM). */
function SourcesPane({ data, className, switcher }: { data: ReportPageData; className?: string; switcher?: React.ReactNode }) {
  const t = useTranslations("reports.sources");
  const tk = useTranslations("common.kinds");
  const tc = useTranslations("common");
  const shell = useShell();
  const [ideas, setIdeas] = useState<SourceIdea[] | null>(null);
  const [loading, setLoading] = useState(false);
  const offCount = data.sources.filter((s) => s.aiOff).length;

  const remove = async (s: ReportPageData["sources"][number]) => {
    const res = await runAction(removeSourceAction(data.id, { type: s.type as "document", id: s.id }));
    if (res === undefined) return;
    toast(t("removed", { title: s.title }), {
      duration: 6000,
      action: { label: tc("undo"), onClick: () => runAction(addSourcesAction(data.id, [{ type: s.type as "document", id: s.id }])) },
    });
  };

  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)} aria-labelledby="r-sources-h">
      {switcher}
      <div className="flex items-center justify-between gap-2">
        <h2 id="r-sources-h" className={cn("label-caps", switcher && "lg:sr-only 2xl:not-sr-only")}>
          {t("title", { count: data.sources.length })}
        </h2>
        {!shell.readOnly ? (
          <EntityPicker
            types={SOURCE_TYPES}
            keepOpen
            align="end"
            placeholder={t("addPlaceholder")}
            exclude={data.sources.map(keyOf)}
            onPick={async (item) => {
              await runAction(addSourcesAction(data.id, [{ type: item.type as "document", id: item.id }]), { success: t("added", { title: item.title }) });
            }}
            trigger={
              <Button variant="outline" size="sm" className="h-9" data-testid="r-source-add">
                <Plus size={15} />
                {t("add")}
              </Button>
            }
          />
        ) : null}
      </div>
      <p className="text-[13px] text-muted">{t("only")}</p>
      {!shell.readOnly ? (
        <Button
          variant="subtle"
          size="sm"
          className="self-start"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            const res = await runAction(suggestSourcesAction(data.id));
            setLoading(false);
            if (res) setIdeas(res);
          }}
          data-testid="r-source-suggest"
        >
          <Wand2 size={15} />
          {data.periodLabel ? t("suggest", { period: data.periodLabel }) : t("suggestRecent")}
        </Button>
      ) : null}
      {data.sources.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-3.5 py-3 text-[14px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="scrollbar-thin flex flex-col 2xl:max-h-[calc(100dvh-320px)] 2xl:overflow-y-auto" data-testid="r-source-list">
          {data.sources.map((s) => (
            <li key={keyOf(s)} className="group flex min-h-10 items-center gap-2.5 rounded-xl px-2 hover:bg-panel" data-testid="r-source-row">
              <EntityIcon type={s.type} size={15} className="shrink-0 text-muted" />
              {s.missing ? (
                <span className="min-w-0 flex-1 truncate py-2 text-[14px] text-muted line-through">{t("missing")}</span>
              ) : (
                <Link href={s.href} className={cn("min-w-0 flex-1 truncate py-2 text-[14px] hover:underline", s.aiOff && "text-muted")} title={`${tk(s.type as "task")}: ${s.title}`}>
                  {s.title}
                </Link>
              )}
              {s.aiOff ? (
                <Tip content={t("aiOff")}>
                  <span className="inline-flex text-muted" aria-label={t("aiOff")}>
                    <Lock size={13} />
                  </span>
                </Tip>
              ) : null}
              {!shell.readOnly ? (
                <button
                  type="button"
                  onClick={() => void remove(s)}
                  aria-label={t("remove", { title: s.title })}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-ink focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  data-testid="r-source-remove"
                >
                  <X size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {offCount ? <p className="text-[13px] text-muted">{t("offNote", { count: offCount })}</p> : null}
      {ideas ? <SuggestDialog data={data} ideas={ideas} onClose={() => setIdeas(null)} /> : null}
    </section>
  );
}

function SideSwitch({ value, onChange, counts }: { value: "sources" | "studio"; onChange: (v: "sources" | "studio") => void; counts: { sources: number; studio: number } }) {
  const t = useTranslations("reports.page.tabs");
  return (
    <div className="hidden gap-1 lg:flex 2xl:hidden" role="tablist" aria-label={t("label")}>
      {(["sources", "studio"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors", value === k ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
        >
          {t(k)}
          {counts[k] ? <span className={cn("text-[12px]", value === k ? "text-on-ink/70" : "text-faint")}>{counts[k]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The outline: every section with how far it has come; a click jumps to it. */
function Outline({ data }: { data: ReportPageData }) {
  const t = useTranslations("reports.page.outline");
  return (
    <nav aria-label={t("label")} className="flex flex-col gap-1">
      <ol className="flex flex-wrap gap-1.5" data-testid="r-outline">
        {data.sections.map((s, i) => {
          const mismatch = s.check && !s.checkStale && s.check.items.some((x) => x.status === "mismatch");
          const state = s.draft ? "draft" : mismatch ? "mismatch" : s.content.trim() ? "written" : "empty";
          return (
            <li key={s.id}>
              <a
                href={`#sec-${s.id}`}
                className={cn("inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors hover:border-ink", state === "empty" ? "border-dashed border-line-strong text-muted" : "border-line text-ink-2")}
                title={`${s.heading} · ${t(state)}`}
              >
                {state === "draft" ? <Sparkles size={12} className="shrink-0 text-accent-ink" /> : state === "mismatch" ? <span className="size-2 shrink-0 rounded-full bg-accent" /> : state === "written" ? <Check size={12} className="shrink-0" /> : null}
                <span className="truncate">
                  {i + 1}. {s.heading}
                </span>
                <span className="sr-only">· {t(state)}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * One report as a NotebookLM notebook: sources on the left, the sections in
 * the middle (each with Claude's draft and the number check), and Studio
 * outputs and visuals on the right. A phone shows one at a time.
 */
export function ReportPage({ data }: { data: ReportPageData }) {
  const t = useTranslations("reports");
  const tp = useTranslations("reports.page");
  const tl = useTranslations("reports.languages");
  const tc = useTranslations("common");
  const shell = useShell();
  const trash = useTrash();
  const [pane, setPane] = useState<Pane>("sections");
  const [side, setSide] = useState<"sources" | "studio">("sources");
  const [dialog, setDialog] = useState<"details" | "duplicate" | "template" | "chart" | "onepager" | null>(null);
  const [adding, setAdding] = useState<{ afterId: string | null } | null>(null);
  const [heading, setHeading] = useState("");
  useScreenContext({ kind: "report", id: data.id, title: data.title, detail: data.periodLabel ?? undefined });

  const readOnly = shell.readOnly;
  const usable = data.sources.filter((s) => !s.aiOff && !s.missing).length;
  const words = data.sections.reduce((n, s) => n + wordsOf(s.content), 0);
  const written = data.sections.filter((s) => s.content.trim()).length;
  const counts = { sources: data.sources.length, studio: data.outputs.length + data.visuals.length };
  const switcher = <SideSwitch value={side} onChange={setSide} counts={counts} />;
  const ctx = { readOnly, aiReady: data.aiReady, sourceCount: usable };
  const basics = { id: data.id, title: data.title, periodId: data.periodId, dueDate: data.dueDate, audience: data.audience, language: data.language };

  async function move(index: number, by: number) {
    const ids = data.sections.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    await runAction(reorderSectionsAction(data.id, ids));
  }

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    if (!heading.trim() || !adding) return;
    const res = await runAction(addSectionAction(data.id, { heading: heading.trim(), afterId: adding.afterId }));
    if (!res) return;
    setHeading("");
    setAdding(null);
    window.setTimeout(() => document.getElementById(`sec-${res.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 120);
  }

  const addForm = (
    <form onSubmit={addSection} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line-strong px-3 py-2.5">
      <Input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder={tp("newSectionPlaceholder")} maxLength={300} autoFocus className="h-10 min-w-[200px] flex-1" data-testid="r-section-heading" />
      <Button type="submit" size="sm" disabled={!heading.trim()} data-testid="r-section-save">
        {tp("addSection")}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(null)}>
        {tc("cancel")}
      </Button>
    </form>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        compact
        eyebrow={
          <Link href="/reports" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={data.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
            {data.status === "final" ? (
              <Badge variant="success" size="sm">
                {t("list.final")}
              </Badge>
            ) : null}
            {[data.periodLabel, data.audience, tl(data.language)].filter(Boolean).map((bit, i) => (
              <span key={i}>{i ? `· ${bit}` : bit}</span>
            ))}
            {data.dueDate ? (
              <span className="flex items-center gap-1.5">
                · <DueLabel due={data.dueDate} today={data.today} final={data.status === "final"} />
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="r-export">
                  <Download size={16} />
                  {tp("export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/${data.id}/export`} download data-testid="r-export-word">
                    <FileDown size={15} />
                    {tp("exportWord")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/reports/${data.id}/export?clean=1`} download data-testid="r-export-clean">
                    <FileDown size={15} />
                    {tp("exportClean")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/print/reports/${data.id}`} target="_blank" rel="noopener" data-testid="r-export-pdf">
                    <Printer size={15} />
                    {tp("exportPdf")}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!readOnly ? (
              <>
                <Button
                  variant={data.status === "final" ? "ghost" : "secondary"}
                  onClick={() => runAction(updateReportAction(data.id, { status: data.status === "final" ? "draft" : "final" }), { success: data.status === "final" ? tp("backToDraftDone") : tp("finalDone") })}
                  data-testid="r-status"
                >
                  {data.status === "final" ? <Undo2 size={16} /> : <Check size={16} />}
                  {data.status === "final" ? tp("backToDraft") : tp("markFinal")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={tp("menu")} data-testid="r-menu">
                      <MoreHorizontal size={18} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setDialog("details")}>
                      <Pencil size={15} />
                      {tp("details")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog("duplicate")} data-testid="r-duplicate">
                      <Copy size={15} />
                      {tp("duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog("template")} data-testid="r-save-template">
                      <Save size={15} />
                      {tp("saveTemplate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => trash("report", data.id, { title: data.title, redirectTo: "/reports" })}>
                      <Trash2 size={15} />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </>
        }
      />
      <p className="-mt-2 text-[13px] text-muted" data-testid="r-progress">
        {tp("progress", { done: written, total: data.sections.length, words })}
      </p>

      <div className="flex gap-1 lg:hidden" role="tablist" aria-label={tp("tabs.label")}>
        {(["sections", "sources", "studio"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pane === k}
            onClick={() => setPane(k)}
            className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] transition-colors", pane === k ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
            data-testid={`r-pane-${k}`}
          >
            {tp(`tabs.${k}`)}
            {k !== "sections" && counts[k] ? <span className={cn("text-[12px]", pane === k ? "text-on-ink/70" : "text-faint")}>{counts[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SourcesPane
          data={data}
          switcher={switcher}
          className={cn(pane === "sources" ? "flex" : "hidden", side === "sources" ? "lg:flex" : "lg:hidden", "lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 2xl:col-start-1 2xl:flex")}
        />

        <div className={cn("min-w-0 flex-col gap-10", pane === "sections" ? "flex" : "hidden", "lg:col-start-1 lg:row-start-1 lg:flex 2xl:col-start-2")}>
          {data.sections.length > 1 ? <Outline data={data} /> : null}
          {data.sources.length === 0 && !readOnly ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-panel px-5 py-4">
              <p className="font-display text-[24px] leading-tight">{tp("startTitle")}</p>
              <p className="max-w-[62ch] text-[15px] text-ink-2">{tp("startBody")}</p>
              <Button variant="outline" size="sm" className="self-start lg:hidden" onClick={() => setPane("sources")}>
                <Plus size={15} />
                {tp("goSources")}
              </Button>
            </div>
          ) : null}
          {data.sections.map((s, i) => (
            <div key={s.id} className="flex flex-col gap-4">
              <SectionCard section={s} index={i} count={data.sections.length} ctx={ctx} onMove={(by) => void move(i, by)} onAddBelow={() => setAdding({ afterId: s.id })} />
              {adding?.afterId === s.id ? addForm : null}
            </div>
          ))}
          {!readOnly ? (
            adding && adding.afterId === null ? (
              addForm
            ) : (
              <Button variant="outline" className="self-start" onClick={() => setAdding({ afterId: null })} data-testid="r-section-add">
                <Plus size={16} />
                {tp("addSection")}
              </Button>
            )
          ) : null}
        </div>

        <div className={cn("min-w-0 flex-col gap-8", pane === "studio" ? "flex" : "hidden", side === "studio" ? "lg:flex" : "lg:hidden", "lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 2xl:col-start-3 2xl:flex")}>
          <StudioPane scope={{ type: "report", id: data.id }} kinds={["brief", "talking_points", "slide_outline", "partner_email"]} outputs={data.outputs} notes={data.notes} refs={undefined} usable={usable} aiReady={data.aiReady} switcher={switcher} />
          <section className="flex flex-col gap-2" aria-labelledby="r-visuals-h">
            <h2 id="r-visuals-h" className="label-caps">
              {tp("visuals")}
            </h2>
            {data.visuals.length ? (
              <ul className="flex flex-col">
                {data.visuals.map((v) => (
                  <li key={v.id}>
                    <Link href={`/reports/visuals/${v.id}`} className="flex min-h-10 items-center gap-2.5 rounded-xl px-2 text-[14px] hover:bg-panel" data-testid="r-visual">
                      {v.kind === "chart" ? <BarChart3 size={15} className="shrink-0 text-muted" /> : <LayoutTemplate size={15} className="shrink-0 text-muted" />}
                      <span className="truncate">{v.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{tp("visualsEmpty")}</p>
            )}
            {!readOnly ? (
              <span className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setDialog("chart")} data-testid="r-visual-chart">
                  <BarChart3 size={15} />
                  {t("visuals.newChart")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDialog("onepager")}>
                  <LayoutTemplate size={15} />
                  {t("visuals.newOnePager")}
                </Button>
              </span>
            ) : null}
          </section>
        </div>
      </div>

      {dialog === "details" ? <ReportDetailsDialog open onOpenChange={(v) => !v && setDialog(null)} report={basics} periods={data.periods} /> : null}
      {dialog === "duplicate" ? <DuplicateDialog open onOpenChange={(v) => !v && setDialog(null)} report={{ ...basics, periodLabel: data.periodLabel }} periods={data.periods} /> : null}
      {dialog === "template" ? <SaveTemplateDialog open onOpenChange={(v) => !v && setDialog(null)} reportId={data.id} defaultName={data.title.replace(data.periodLabel ?? "\u0000", "").replace(/[\s·-]+$/, "").trim() || data.title} /> : null}
      {dialog === "chart" || dialog === "onepager" ? <NewVisualDialog open onOpenChange={(v: boolean) => !v && setDialog(null)} kind={dialog} reportId={data.id} aiReady={data.aiReady} /> : null}
    </div>
  );
}
