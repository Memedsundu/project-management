"use client";

import { Check, FileArchive, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { readBackup, RestoreError, runRestore, type ChosenBackup, type RestoreOutcome, type RestoreProgress } from "@/lib/client/restore";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type State =
  | { kind: "choose"; error?: "bad" | "newer" }
  | { kind: "reading" }
  | { kind: "ready"; chosen: ChosenBackup }
  | { kind: "running"; chosen: ChosenBackup; progress: RestoreProgress }
  | { kind: "failed"; chosen: ChosenBackup; error: string }
  | { kind: "done"; outcome: RestoreOutcome };

const STEPS = ["begin", "files", "rows", "index"] as const;

/**
 * Restoring an export: she picks the ZIP (or all its parts), sees what is in
 * it, and starts. The steps run from this tab; if one fails she tries again
 * with the same ZIPs and it starts over cleanly.
 */
export function RestoreDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("settings.data");
  const tc = useTranslations("common");
  const [state, setState] = useState<State>({ kind: "choose" });
  const input = useRef<HTMLInputElement>(null);
  const running = state.kind === "running";

  // Leaving the page halfway would stop the restore.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function choose(files: File[]) {
    if (!files.length) return;
    setState({ kind: "reading" });
    const res = await readBackup(files);
    setState("error" in res ? { kind: "choose", error: res.error } : { kind: "ready", chosen: res });
  }

  async function start(chosen: ChosenBackup) {
    setState({ kind: "running", chosen, progress: { step: "begin" } });
    try {
      const outcome = await runRestore(chosen, (progress) => setState({ kind: "running", chosen, progress }), { uploadFailed: (name) => t("restoreUploadFailed", { name }) });
      setState({ kind: "done", outcome });
    } catch (err) {
      if (!(err instanceof RestoreError)) console.error(err);
      setState({ kind: "failed", chosen, error: err instanceof RestoreError ? err.message : "" });
    }
  }

  function setOpen(v: boolean) {
    if (running) return;
    onOpenChange(v);
    if (!v && state.kind !== "done") setState({ kind: "choose" });
  }

  const hold = (e: Event) => running && e.preventDefault();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={t("restoreTitle")} description={t("restoreDescription")} onEscapeKeyDown={hold} onInteractOutside={hold}>
        <div className="flex flex-col gap-5" data-testid="s-restore-dialog">
          {state.kind === "choose" ? (
            <>
              <input
                ref={input}
                type="file"
                accept=".zip,application/zip"
                multiple
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  void choose([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
                data-testid="s-restore-input"
              />
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void choose([...e.dataTransfer.files]);
                }}
                className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong px-6 py-9 text-center hover:border-ink hover:bg-panel"
              >
                <FileArchive size={26} className="text-muted" aria-hidden />
                <span className="text-[15px] font-medium">{t("restoreChoose")}</span>
              </button>
              {state.error ? (
                <p role="alert" className="rounded-xl bg-accent-soft px-4 py-2.5 text-[14px] text-accent-ink">
                  {state.error === "newer" ? t("restoreNewer") : t("restoreBad")}
                </p>
              ) : null}
            </>
          ) : null}

          {state.kind === "reading" ? (
            <p className="flex items-center gap-2 py-6 text-[15px] text-muted" role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t("restoreReading")}
            </p>
          ) : null}

          {state.kind === "ready" ? (
            <>
              <Summary chosen={state.chosen} />
              <p className="text-[14px] text-muted">{t("restoreWarning")}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setState({ kind: "choose" })}>
                  {tc("back")}
                </Button>
                <Button onClick={() => start(state.chosen)} data-testid="s-restore-start">
                  {t("restoreStart")}
                </Button>
              </div>
            </>
          ) : null}

          {state.kind === "running" ? <Steps progress={state.progress} /> : null}

          {state.kind === "failed" ? (
            <>
              <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink" data-testid="s-restore-failed">
                {state.error ? t("restoreFailed", { error: state.error }) : t("restoreFailedPlain")}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {tc("close")}
                </Button>
                <Button onClick={() => start(state.chosen)}>{t("restoreRetry")}</Button>
              </div>
            </>
          ) : null}

          {state.kind === "done" ? (
            <div className="flex flex-col gap-4" role="status" data-testid="s-restore-done">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink" aria-hidden>
                  <Check size={15} strokeWidth={2.5} />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-[16px] font-medium">{t("restoreDone")}</p>
                  <p className="text-[14px] text-muted">{t("restoreDoneHint")}</p>
                </div>
              </div>
              {state.outcome.skipped > 0 ? <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[14px] text-accent-ink">{t("restoreSkipped", { count: state.outcome.skipped })}</p> : null}
              {state.outcome.damaged.length ? (
                <ul className="flex flex-col gap-1 text-[14px] text-muted">
                  {state.outcome.damaged.map((name) => (
                    <li key={name}>{t("restoreDamaged", { name })}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex justify-end">
                <Button asChild>
                  {/* A full page load, so every screen starts from the restored project. */}
                  <a href="/today">{t("restoreGoToday")}</a>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ chosen }: { chosen: ChosenBackup }) {
  const t = useTranslations("settings.data");
  const locale = useLocale();
  const { backup, counts } = chosen;
  const versions = backup.tables.document_versions?.length ?? 0;
  const noFiles = versions > 0 && Object.keys(backup.files ?? {}).length === 0;
  const items = [
    t("countTasks", { count: counts.tasks }),
    t("countNotes", { count: counts.notes }),
    t("countMeetings", { count: counts.meetings }),
    t("countFiles", { count: counts.files }),
    t("countOrgs", { count: counts.organisations }),
    t("countReports", { count: counts.reports }),
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="s-restore-summary">
      <div className="flex flex-col gap-1 rounded-2xl bg-panel px-5 py-4">
        <p className="font-display text-[24px] leading-tight">{backup.projectName}</p>
        <p className="text-[13px] text-muted">{t("restoreExported", { date: formatDateTime(backup.exportedAt, locale) })}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
          {items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      {backup.parts > 1 && chosen.partsFound < backup.parts ? <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[14px] text-accent-ink">{t("restoreParts", { total: backup.parts, found: chosen.partsFound })}</p> : null}
      {chosen.missingFiles > 0 ? <p className="text-[14px] text-muted">{t("restoreMissing", { count: chosen.missingFiles })}</p> : null}
      {noFiles ? <p className="text-[14px] text-muted">{t("restoreNoFiles")}</p> : null}
    </div>
  );
}

/** The four steps, the one running now with its count and a bar. */
function Steps({ progress }: { progress: RestoreProgress }) {
  const t = useTranslations("settings.data");
  const at = STEPS.indexOf(progress.step);
  const detail =
    progress.step === "files"
      ? t("restoreStepFiles", { done: progress.done, total: progress.total })
      : progress.step === "rows"
        ? t("restoreStepRows", { done: progress.done, total: progress.total })
        : progress.step === "index"
          ? t("restoreStepIndex", { done: progress.done })
          : t("restoreStepBegin");
  const share = progress.step === "files" || progress.step === "rows" ? (progress.total ? progress.done / progress.total : 1) : null;
  return (
    <div className="flex flex-col gap-4" data-testid="s-restore-running">
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((step, i) => (
          <li key={step} className={cn("flex items-center gap-3 text-[15px]", i > at && "text-faint")} aria-current={i === at ? "step" : undefined}>
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden>
              {i < at ? <Check size={16} strokeWidth={2.5} /> : i === at ? <Loader2 size={16} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            {t(`restoreSteps.${step}`)}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3">
        <p className="text-[14px] tabular-nums" role="status">
          {detail}
        </p>
        {share !== null ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label={detail}>
            <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <p className="text-[13px] text-muted">{t("restoreWarning")}</p>
    </div>
  );
}
