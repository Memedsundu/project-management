"use client";

import { BookOpen, Copy, FileText, Loader2, Mail, MessagesSquare, NotebookPen, Presentation, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { deleteOutputAction, generateOutputAction, saveOutputAsNoteAction } from "@/app/(app)/collections/actions";
import { generateReportOutputAction } from "@/app/(app)/reports/actions";
import { CitedText, plainCited, SourceList } from "@/components/common/cited-text";
import { useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDateTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { StudioKind, StudioOutputView } from "@/server/ai/collections";
import type { EntityRef } from "@/server/entities";

const KINDS: { kind: StudioKind; icon: typeof FileText; language: "tr" | "en" }[] = [
  { kind: "brief", icon: FileText, language: "en" },
  { kind: "talking_points", icon: MessagesSquare, language: "en" },
  { kind: "slide_outline", icon: Presentation, language: "en" },
  { kind: "partner_email", icon: Mail, language: "tr" },
  { kind: "section", icon: BookOpen, language: "en" },
];

export const kindIcon = (kind: StudioKind) => KINDS.find((k) => k.kind === kind)?.icon ?? FileText;

/** Open a saved note from a toast. */
export function useNoteToast() {
  const t = useTranslations("collections.studio");
  const router = useRouter();
  return (id: string) => toast(t("noteSaved"), { duration: 6000, action: { label: t("openNote"), onClick: () => router.push(`/notes/${id}`) } });
}

/** One output in full: Claude's draft with its numbered sources, to copy or keep as a note. */
function OutputDialog({ output, onClose }: { output: StudioOutputView; onClose: () => void }) {
  const t = useTranslations("collections.studio");
  const ta = useTranslations("search.ask");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  // The dialog blocks the toast's button, so the saved note opens from here.
  const [noteId, setNoteId] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t(`kinds.${output.kind}`)} description={`${output.title} · ${formatDateTime(output.createdAt, locale)}`} wide>
        <article className="flex flex-col gap-5" data-testid="studio-output">
          <p className="-mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Badge variant="ai" size="sm">
              <Sparkles size={11} />
              {tc("aiBadge")}
            </Badge>
            {t("draftNote")}
          </p>
          <CitedText text={output.content} citations={output.citations} idPrefix="out-" />
          {output.citations.length ? (
            <section className="flex flex-col gap-2">
              <h3 id="out-sources" className="label-caps">
                {ta("sources")}
              </h3>
              <SourceList citations={output.citations} idPrefix="out-" headingId="out-sources" />
            </section>
          ) : (
            <p className="text-[13px] text-muted">{ta("noCitations")}</p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-4">
            {!shell.readOnly ? (
              <Button
                variant="ghost"
                className="mr-auto text-overdue"
                disabled={busy}
                onClick={async () => {
                  const res = await runAction(deleteOutputAction(output.id), { success: t("deleted") });
                  if (res !== undefined) onClose();
                }}
                data-testid="out-delete"
              >
                <Trash2 size={15} />
                {tc("delete")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(plainCited(output.content, output.citations, { page: (page) => ta("page", { page }) }));
                toast(tc("copied"));
              }}
              data-testid="out-copy"
            >
              <Copy size={15} />
              {tc("copy")}
            </Button>
            {noteId ? (
              <Button asChild>
                <Link href={`/notes/${noteId}`} data-testid="out-open-note">
                  <NotebookPen size={15} />
                  {t("openNote")}
                </Link>
              </Button>
            ) : !shell.readOnly ? (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const res = await runAction(saveOutputAsNoteAction(output.id, `${t(`kinds.${output.kind}`)}: ${output.title}`), { success: t("noteSaved") });
                  setBusy(false);
                  if (res) setNoteId(res.id);
                }}
                data-testid="out-note"
              >
                <NotebookPen size={15} />
                {t("saveAsNote")}
              </Button>
            ) : null}
          </div>
        </article>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Çıktılar" (NotebookLM Studio): a brief, talking points, a slide outline,
 * an email to a partner or a report section, written from the sources she
 * ticked in a collection, or from a report's sources. Each one is a draft
 * with citations.
 */
export function StudioPane({
  scope,
  kinds,
  outputs,
  notes,
  refs,
  usable,
  aiReady,
  className,
  switcher,
}: {
  scope: { type: "collection" | "report"; id: string };
  /** The outputs offered; a report has its own sections, so it leaves "section" out. */
  kinds?: StudioKind[];
  outputs: StudioOutputView[];
  notes: { id: string; title: string; href: string }[];
  refs: EntityRef[] | undefined;
  usable: number;
  aiReady: boolean;
  className?: string;
  switcher?: React.ReactNode;
}) {
  const t = useTranslations("collections.studio");
  const locale = useLocale();
  const shell = useShell();
  const [making, setMaking] = useState<StudioKind | null>(null);
  const [focus, setFocus] = useState("");
  const [language, setLanguage] = useState<"tr" | "en">("en");
  const [busy, setBusy] = useState<StudioKind | null>(null);
  const [open, setOpen] = useState<StudioOutputView | null>(null);
  const canMake = aiReady && !shell.readOnly && usable > 0;
  const offered = kinds ? KINDS.filter((k) => kinds.includes(k.kind)) : KINDS;

  const pick = (kind: StudioKind) => {
    setMaking(kind);
    setLanguage(KINDS.find((k) => k.kind === kind)!.language);
  };

  async function make() {
    if (!making || busy) return;
    const kind = making;
    setBusy(kind);
    setMaking(null);
    const res = await runAction(
      scope.type === "report"
        ? generateReportOutputAction(scope.id, { kind, focus: focus.trim() || null, language })
        : generateOutputAction(scope.id, { kind, focus: focus.trim() || null, language, refs }),
    );
    setBusy(null);
    if (!res) return;
    setFocus("");
    setOpen(res);
  }

  return (
    <section className={cn("flex min-w-0 flex-col gap-4", className)} aria-labelledby="c-studio-h">
      {switcher}
      <h2 id="c-studio-h" className={cn("label-caps", switcher && "lg:sr-only 2xl:not-sr-only")}>
        {t("title")}
      </h2>
      {!aiReady ? (
        <p className="text-[14px] text-muted">{t("notConnected")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {offered.map(({ kind, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                disabled={!canMake || Boolean(busy)}
                onClick={() => pick(kind)}
                aria-pressed={making === kind}
                className={cn(
                  "flex min-h-[76px] flex-col items-start justify-between gap-2 rounded-2xl border px-3.5 py-3 text-left text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  making === kind ? "border-ink bg-panel" : "border-line hover:border-ink",
                )}
                data-testid="studio-kind"
              >
                {busy === kind ? <Loader2 size={17} className="animate-spin text-muted" /> : <Icon size={17} className="text-muted" />}
                <span className="leading-snug">{t(`kinds.${kind}`)}</span>
              </button>
            ))}
          </div>
          {usable === 0 && !shell.readOnly ? <p className="text-[13px] text-muted">{scope.type === "report" ? t("needReportSources") : t("needSources")}</p> : null}

          {making ? (
            <form
              className="flex flex-col gap-3 rounded-2xl border border-line-strong px-4 py-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                void make();
              }}
            >
              <p className="text-[14px]">
                <span className="font-medium">{t(`kinds.${making}`)}</span>
                <span className="text-muted"> · {t(`hints.${making}`)}</span>
              </p>
              <Field label={t("focus")}>
                <Textarea value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={600} placeholder={t("focusPlaceholder")} className="min-h-16 text-[14px]" data-testid="studio-focus" />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-medium" id="studio-lang">
                  {t("language")}
                </span>
                <div className="flex gap-1" role="radiogroup" aria-labelledby="studio-lang">
                  {(["tr", "en"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={language === l}
                      onClick={() => setLanguage(l)}
                      className={cn("inline-flex h-9 items-center rounded-full px-3.5 text-[14px] transition-colors", language === l ? "bg-ink text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
                      data-testid="studio-lang"
                    >
                      {t(`languages.${l}`)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[13px] text-muted">{scope.type === "report" ? t("fromReport", { count: usable }) : t("fromSources", { count: usable })}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setMaking(null)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" size="sm" data-testid="studio-make">
                  <Sparkles size={14} />
                  {t("make")}
                </Button>
              </div>
            </form>
          ) : null}

          {busy ? (
            <p className="flex items-center gap-2 text-[14px] text-muted" aria-live="polite">
              <Loader2 size={15} className="animate-spin" />
              {t("writing", { kind: t(`kinds.${busy}`) })}
            </p>
          ) : null}
        </>
      )}

      {outputs.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="label-caps pt-1">{t("saved")}</h3>
          <ul className="flex flex-col">
            {outputs.map((o) => {
              const Icon = kindIcon(o.kind);
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => setOpen(o)} className="flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-panel" data-testid="studio-item">
                    <Icon size={15} className="mt-0.5 shrink-0 text-muted" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-medium">{t(`kinds.${o.kind}`)}</span>
                      <span className="truncate text-[12px] text-muted">
                        {o.title} · {formatDateTime(o.createdAt, locale)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {notes.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="label-caps pt-1">{t("notes")}</h3>
          <ul className="flex flex-col">
            {notes.map((n) => (
              <li key={n.id}>
                <Link href={n.href} className="flex min-h-9 items-center gap-2.5 rounded-xl px-2 text-[14px] hover:bg-panel">
                  <NotebookPen size={15} className="shrink-0 text-muted" />
                  <span className="truncate">{n.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {open ? <OutputDialog key={open.id} output={outputs.find((o) => o.id === open.id) ?? open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
