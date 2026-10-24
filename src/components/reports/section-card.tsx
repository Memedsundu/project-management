"use client";

import { ArrowDown, ArrowUp, Check, ChevronDown, Hash, Loader2, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { acceptDraftAction, checkNumbersAction, deleteSectionAction, discardDraftAction, draftSectionAction, updateSectionAction } from "@/app/(app)/reports/actions";
import { CitedText, SourceList } from "@/components/common/cited-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { formatDateTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { ReportSectionData } from "@/server/views/reports";

export const wordsOf = (text: string) => text.replace(/\[\d+\]/g, "").trim().split(/\s+/).filter(Boolean).length;

type Ctx = { readOnly: boolean; aiReady: boolean; sourceCount: number };

/** "Şablonun istediği" and the word limit, in their own small window. */
function GuidanceDialog({ section, onClose }: { section: ReportSectionData; onClose: () => void }) {
  const t = useTranslations("reports.section");
  const [heading, setHeading] = useState(section.heading);
  const [guidance, setGuidance] = useState(section.guidance ?? "");
  const [limit, setLimit] = useState(section.wordLimit ? String(section.wordLimit) : "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t("settingsTitle")} description={t("settingsHint")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const n = Number(limit);
            const res = await runAction(
              updateSectionAction(section.id, { heading: heading.trim(), guidance: guidance.trim() || null, wordLimit: limit && Number.isFinite(n) ? Math.max(10, Math.min(20000, Math.round(n))) : null }),
              { success: t("saved") },
            );
            setBusy(false);
            if (res !== undefined) onClose();
          }}
        >
          <Field label={t("heading")} htmlFor="sec-heading">
            <Input id="sec-heading" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={300} required data-testid="sec-heading-input" />
          </Field>
          <Field label={t("guidance")} htmlFor="sec-guidance" hint={t("guidanceHint")}>
            <Textarea id="sec-guidance" value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={4000} className="min-h-24" />
          </Field>
          <Field label={t("wordLimit")} htmlFor="sec-limit">
            <Input id="sec-limit" type="number" min={10} max={20000} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-[160px]" placeholder={t("noLimit")} data-testid="sec-limit" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !heading.trim()}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The number check under a section: what differs from the IPTT first, the matches folded away. */
function NumberCheckPanel({ section, onRecheck, busy }: { section: ReportSectionData; onRecheck: () => void; busy: boolean }) {
  const t = useTranslations("reports.check");
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const check = section.check!;
  const mismatches = check.items.filter((i) => i.status === "mismatch");
  const others = check.items.filter((i) => i.status !== "mismatch");
  const matches = check.items.filter((i) => i.status === "match").length;
  const missing = check.items.filter((i) => i.status === "not_in_iptt").length;
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border px-4 py-3", mismatches.length && !section.checkStale ? "border-accent/40" : "border-line-soft")} data-testid="number-check">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <Hash size={14} className="shrink-0" />
        <span className="font-medium text-ink-2">{t("title")}</span>
        <span>{formatDateTime(check.at, locale)}</span>
        {check.periodLabel ? <span>· {check.periodLabel}</span> : null}
        <span>
          ·{" "}
          {check.items.length
            ? t("summary", { total: check.items.length, mismatch: mismatches.length, match: matches, missing })
            : t("none")}
        </span>
      </p>
      {section.checkStale ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-accent-ink" data-testid="check-stale">
          {t("stale")}
          <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={onRecheck} disabled={busy}>
            {t("recheck")}
          </Button>
        </p>
      ) : null}
      {mismatches.length ? (
        <ul className="flex flex-col gap-2">
          {mismatches.map((i) => (
            <li key={i.quote} className="flex gap-2.5 text-[14px]" data-testid="check-mismatch">
              <span className="mt-[7px] size-2 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>
                  <span className="font-medium">“{i.quote}”</span>
                  {i.ipttValue ? (
                    <span className="text-muted">
                      {" "}
                      · {t("iptt")}: {i.indicatorCode ? `${i.indicatorCode} ` : ""}
                      {i.ipttValue}
                    </span>
                  ) : null}
                </span>
                <span className="text-[13px] text-ink-2">{i.note}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : check.items.length ? (
        <p className="flex items-center gap-2 text-[14px] text-ink-2">
          <Check size={15} className="shrink-0" />
          {t("allGood")}
        </p>
      ) : null}
      {others.length ? (
        <>
          <button type="button" onClick={() => setShowAll(!showAll)} className="inline-flex items-center gap-1 self-start text-[13px] text-muted hover:text-ink" aria-expanded={showAll}>
            <ChevronDown size={14} className={cn("transition-transform", showAll && "rotate-180")} />
            {showAll ? t("hideOthers") : t("showOthers", { count: others.length })}
          </button>
          {showAll ? (
            <ul className="flex flex-col gap-1.5">
              {others.map((i) => (
                <li key={i.quote} className="flex gap-2.5 text-[13px] text-ink-2">
                  {i.status === "match" ? <Check size={14} className="mt-0.5 shrink-0 text-muted" aria-label={t("match")} /> : <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-faint" aria-label={t("notInIptt")} />}
                  <span>
                    “{i.quote}” <span className="text-muted">· {i.status === "match" ? t("match") : t("notInIptt")}</span>
                    {i.status !== "match" && i.note ? <span className="text-muted"> · {i.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One section of a report: her text with its citations, Claude's draft
 * waiting beside it (Notion AI: Kullan, Sonuna ekle, Vazgeç), and the
 * number check against the IPTT.
 */
export function SectionCard({
  section,
  index,
  count,
  ctx,
  onMove,
  onAddBelow,
}: {
  section: ReportSectionData;
  index: number;
  count: number;
  ctx: Ctx;
  onMove: (by: number) => void;
  onAddBelow: () => void;
}) {
  const t = useTranslations("reports.section");
  const tq = useTranslations("reports.quick");
  const ta = useTranslations("search.ask");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(section.content);
  const [busy, setBusy] = useState<"draft" | "check" | "accept" | "save" | null>(null);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [settings, setSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const hasText = Boolean(section.content.trim());
  const words = wordsOf(editing ? text : section.content);
  const over = section.wordLimit ? words > section.wordLimit : false;
  const canAi = ctx.aiReady && !ctx.readOnly;
  const marks = section.check && !section.checkStale ? section.check.items.filter((i) => i.status === "mismatch").map((i) => i.quote) : [];
  const used = section.citations.filter((c) => new RegExp(`\\[${c.n}\\]`).test(section.content));
  const prefix = `s${index}-`;

  function startEdit() {
    if (ctx.readOnly) return;
    setText(section.content);
    setEditing(true);
  }

  async function save() {
    setEditing(false);
    if (text === section.content) return;
    setBusy("save");
    await runAction(updateSectionAction(section.id, { content: text }));
    setBusy(null);
  }

  async function draft(note?: string) {
    if (busy || !canAi) return;
    setAsking(false);
    setBusy("draft");
    await runAction(draftSectionAction(section.id, note?.trim() || null));
    setBusy(null);
    setInstruction("");
  }

  async function accept(mode: "replace" | "append") {
    setBusy("accept");
    await runAction(acceptDraftAction(section.id, mode), { success: mode === "append" ? t("appended") : t("used") });
    setBusy(null);
  }

  async function check() {
    setBusy("check");
    await runAction(checkNumbersAction(section.id));
    setBusy(null);
  }

  const quick = [
    { key: "fresh", label: tq("fresh"), note: "" },
    ...(hasText ? [{ key: "shorter", label: tq("shorter"), note: tq("shorterNote") }] : []),
    ...(hasText ? [{ key: "formal", label: tq("formal"), note: tq("formalNote") }] : []),
    ...(hasText ? [{ key: "numbers", label: tq("numbers"), note: tq("numbersNote") }] : []),
    ...(hasText && over && section.wordLimit ? [{ key: "limit", label: tq("fitLimit", { limit: section.wordLimit }), note: tq("fitLimitNote", { limit: section.wordLimit }) }] : []),
  ];

  return (
    <article id={`sec-${section.id}`} className="flex scroll-mt-24 flex-col gap-3" aria-labelledby={`sec-h-${section.id}`} data-testid="report-section">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`sec-h-${section.id}`} className="font-display text-[28px] leading-tight">
            <span className="mr-2 text-faint">{index + 1}.</span>
            {section.heading}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className={cn(over && "font-medium text-accent-ink")} data-testid="sec-words">
              {section.wordLimit ? t("wordsOf", { count: words, limit: section.wordLimit }) : t("words", { count: words })}
            </span>
            {busy === "save" ? <span>· {t("saving")}</span> : null}
          </p>
        </div>
        {!ctx.readOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("menu", { heading: section.heading })} data-testid="sec-menu">
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setSettings(true)}>
                <Pencil size={15} />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                <ArrowUp size={15} />
                {t("moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
                <ArrowDown size={15} />
                {t("moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddBelow}>
                <Plus size={15} />
                {t("addBelow")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger disabled={count <= 1} onSelect={() => setConfirmDelete(true)}>
                <Trash2 size={15} />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      {section.guidance ? <p className="max-w-[72ch] rounded-xl bg-panel px-3.5 py-2.5 text-[14px] text-ink-2">{t("asks", { guidance: section.guidance })}</p> : null}

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText(section.content);
                setEditing(false);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget as HTMLTextAreaElement).blur();
            }}
            autoFocus
            maxLength={200_000}
            aria-label={t("textLabel", { heading: section.heading })}
            className="min-h-48 text-[16px] leading-relaxed [field-sizing:content]"
            data-testid="sec-textarea"
          />
          <p className="text-[12px] text-muted">{t("editHint")}</p>
        </div>
      ) : hasText ? (
        <div
          className={cn("rounded-2xl", !ctx.readOnly && "-mx-3 cursor-text px-3 py-1 hover:bg-panel/60")}
          onDoubleClick={startEdit}
          onClickCapture={(e) => {
            // A citation number opens the section's source list and jumps to its source.
            const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(`a[href^="#${prefix}src-"]`);
            if (!a) return;
            e.preventDefault();
            setShowSources(true);
            const id = a.getAttribute("href")!.slice(1);
            window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
          }}
          data-testid="sec-text"
        >
          <CitedText text={section.content} citations={section.citations} idPrefix={prefix} marks={marks} className="text-[16px]" />
        </div>
      ) : !section.draft && busy !== "draft" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-4">
          <p className="text-[14px] text-muted">{ctx.sourceCount ? t("empty") : t("emptyNoSources")}</p>
          {!ctx.readOnly ? (
            <div className="flex flex-wrap gap-2">
              {ctx.aiReady ? (
                <Button size="sm" onClick={() => void draft()} disabled={!ctx.sourceCount} data-testid="sec-draft">
                  <Sparkles size={14} />
                  {t("draft")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={startEdit} data-testid="sec-write">
                <Pencil size={14} />
                {t("writeMyself")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {busy === "draft" ? (
        <p className="flex items-center gap-2 rounded-2xl bg-panel px-4 py-3 text-[14px] text-muted" aria-live="polite" data-testid="sec-drafting">
          <Loader2 size={15} className="animate-spin" />
          {t("drafting", { count: ctx.sourceCount })}
        </p>
      ) : null}

      {section.draft && busy !== "draft" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line-strong bg-bg-subtle px-4 py-4" data-testid="sec-draft-box">
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge variant="ai" size="sm">
              <Sparkles size={11} />
              {t("draftBadge")}
            </Badge>
            {section.draft.instruction ? <span>“{section.draft.instruction}”</span> : null}
            <span>{formatDateTime(section.draft.at, locale)}</span>
            <span>· {t("words", { count: wordsOf(section.draft.content) })}</span>
          </p>
          <CitedText text={section.draft.content} citations={section.draft.citations} idPrefix={`d${index}-`} className="text-[16px]" />
          {section.draft.citations.length ? (
            <div className="flex flex-col gap-1 rounded-xl border border-line-soft px-2 py-2">
              <p id={`d${index}-h`} className="label-caps px-1.5 pb-0.5">
                {ta("sources")}
              </p>
              <SourceList citations={section.draft.citations} idPrefix={`d${index}-`} headingId={`d${index}-h`} compact />
            </div>
          ) : (
            <p className="text-[13px] text-muted">{t("draftNoCitations")}</p>
          )}
          {!ctx.readOnly ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
              <Button size="sm" onClick={() => void accept("replace")} disabled={Boolean(busy)} data-testid="draft-use">
                <Check size={14} />
                {hasText ? t("replace") : t("use")}
              </Button>
              {hasText ? (
                <Button size="sm" variant="outline" onClick={() => void accept("append")} disabled={Boolean(busy)} data-testid="draft-append">
                  <Plus size={14} />
                  {t("append")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => runAction(discardDraftAction(section.id))} disabled={Boolean(busy)} data-testid="draft-discard">
                {t("discard")}
              </Button>
              <span className="ml-auto text-[12px] text-muted">{t("draftCheck")}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {asking ? (
        <form
          className="flex flex-col gap-2 rounded-2xl border border-line-strong px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim()) void draft(instruction);
          }}
        >
          <label htmlFor={`ins-${section.id}`} className="text-[14px] font-medium">
            {hasText ? t("instructionRewrite") : t("instructionWrite")}
          </label>
          <Textarea
            id={`ins-${section.id}`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            maxLength={800}
            placeholder={t("instructionPlaceholder")}
            className="min-h-16 text-[14px]"
            autoFocus
            data-testid="sec-instruction"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!instruction.trim()} data-testid="sec-instruction-go">
              <Sparkles size={14} />
              {t("go")}
            </Button>
          </div>
        </form>
      ) : null}

      {(hasText || section.draft) && !editing && !ctx.readOnly ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {ctx.aiReady ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={Boolean(busy) || !ctx.sourceCount} data-testid="sec-rewrite">
                  <Wand2 size={14} />
                  {hasText ? t("rewrite") : t("redraft")}
                  <ChevronDown size={13} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {quick.map((q) => (
                  <DropdownMenuItem key={q.key} onSelect={() => void draft(q.note)} data-testid={`quick-${q.key}`}>
                    {q.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAsking(true)} data-testid="quick-own">
                  <Pencil size={15} />
                  {tq("own")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {hasText && ctx.aiReady ? (
            <Button variant="outline" size="sm" onClick={() => void check()} disabled={Boolean(busy)} data-testid="sec-check">
              {busy === "check" ? <Loader2 size={14} className="animate-spin" /> : <Hash size={14} />}
              {busy === "check" ? t("checking") : t("check")}
            </Button>
          ) : null}
          {hasText ? (
            <Button variant="ghost" size="sm" onClick={startEdit} data-testid="sec-edit">
              <Pencil size={14} />
              {t("editText")}
            </Button>
          ) : null}
          {used.length ? (
            <Button variant="ghost" size="sm" onClick={() => setShowSources(!showSources)} aria-expanded={showSources} className="ml-auto text-muted">
              {t("sources", { count: used.length })}
              <ChevronDown size={13} className={cn("transition-transform", showSources && "rotate-180")} />
            </Button>
          ) : null}
        </div>
      ) : null}

      {showSources && used.length && !editing ? (
        <div className="rounded-xl border border-line-soft px-2 py-2">
          <SourceList citations={used} idPrefix={prefix} compact />
        </div>
      ) : null}

      {section.check && hasText && !editing ? <NumberCheckPanel section={section} onRecheck={() => void check()} busy={Boolean(busy)} /> : null}

      {settings ? <GuidanceDialog section={section} onClose={() => setSettings(false)} /> : null}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={t("deleteTitle")} description={t("deleteBody", { heading: section.heading })}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const res = await runAction(deleteSectionAction(section.id), { success: t("deleted") });
                if (res) setConfirmDelete(false);
              }}
              data-testid="sec-delete-confirm"
            >
              {t("delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
