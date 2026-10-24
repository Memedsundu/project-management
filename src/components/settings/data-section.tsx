"use client";

import { Archive, ArrowUpRight, Check, Download, FolderOpen, Lock, RotateCcw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { closeProjectAction, reopenProjectAction } from "@/app/(app)/settings/data-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { dayOf, formatDateTime, formatDay } from "@/lib/dates";
import { cn, formatBytes } from "@/lib/utils";
import type { SettingsData } from "@/server/views/settings";
import { Row, SettingsSection } from "./parts";
import { RestoreDialog } from "./restore-dialog";

/**
 * Veri: the full export (Google Takeout, Notion's export), closing the
 * project at its end, restoring an export into a new installation, and the
 * trash.
 */
export function DataSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.data");
  const locale = useLocale();
  const params = useSearchParams();
  const [exporting, setExporting] = useState(params.get("export") === "1");
  const [closing, setClosing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const closed = data.archive.readOnly;
  const closedOn = data.archive.archivedAt ? formatDay(dayOf(data.archive.archivedAt), locale, true) : "";
  const unfinished = data.restore.inProgress;

  return (
    <SettingsSection id="data" title={t("title")} hint={t("hint")}>
      <Row label={t("export")} hint={t("exportHint")}>
        <Button variant="outline" size="sm" onClick={() => setExporting(true)} data-testid="s-export">
          <Download size={15} />
          {t("exportOpen")}
        </Button>
      </Row>

      {closed ? (
        <Row
          label={
            <span className="inline-flex items-center gap-2">
              <Lock size={15} aria-hidden />
              {t("closedRow")}
            </span>
          }
          hint={t("closedHint", { date: closedOn })}
        >
          <Button variant="outline" size="sm" onClick={async () => void (await runAction(reopenProjectAction(), { success: t("reopened") }))} data-testid="s-reopen">
            <RotateCcw size={15} />
            {t("reopen")}
          </Button>
        </Row>
      ) : (
        <Row label={t("close")} hint={t("closeHint")}>
          <Button variant="outline" size="sm" onClick={() => setClosing(true)} data-testid="s-close">
            <Archive size={15} />
            {t("closeOpen")}
          </Button>
        </Row>
      )}

      <Row
        label={t("restore")}
        hint={
          unfinished ? (
            <span className="text-accent-ink">{t("restoreUnfinished", { date: formatDateTime(unfinished.exportedAt, locale) })}</span>
          ) : data.restore.allowed ? (
            t("restoreHint")
          ) : (
            <>
              {t("restoreHint")} {t("restoreNotEmpty")}
            </>
          )
        }
      >
        {data.restore.allowed ? (
          <Button variant="outline" size="sm" onClick={() => setRestoring(true)} data-testid="s-restore">
            <Upload size={15} />
            {t("restoreOpen")}
          </Button>
        ) : null}
      </Row>

      <Row label={t("trash")} hint={t("trashHint", { count: data.trash })}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/trash" data-testid="s-trash">
            <Trash2 size={15} />
            {t("openTrash")}
            <ArrowUpRight size={15} />
          </Link>
        </Button>
      </Row>

      <ExportDialog data={data} open={exporting} onOpenChange={setExporting} />
      {!closed ? <CloseDialog data={data} open={closing} onOpenChange={setClosing} /> : null}
      {/* Mounted on its own: the section changes under it when the restore finishes. */}
      <RestoreDialog open={restoring} onOpenChange={setRestoring} />
    </SettingsSection>
  );
}

/** The download buttons: one ZIP, or one per part when the files are big. */
function DownloadLinks({ data, files, primary }: { data: SettingsData; files: boolean; primary?: boolean }) {
  const t = useTranslations("settings.data");
  const locale = useLocale();
  const { parts, partBytes } = data.exportInfo;
  if (files && parts > 1) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px]">{t("exportParts", { count: parts })}</p>
        <ul className="flex flex-col gap-2" data-testid="s-export-parts">
          {partBytes.map((bytes, i) => (
            <li key={i}>
              <Button variant={i === 0 && primary ? "primary" : "outline"} size="sm" asChild>
                <a href={`/api/export?files=1&part=${i + 1}`}>
                  <Download size={15} />
                  {t("exportPart", { n: i + 1, size: formatBytes(bytes, locale) })}
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <Button variant={primary ? "primary" : "outline"} size={primary ? "md" : "sm"} asChild>
      <a href={`/api/export?files=${files ? 1 : 0}`} data-testid="s-export-download">
        <Download size={16} />
        {t("exportDownload")}
      </a>
    </Button>
  );
}

function ExportDialog({ data, open, onOpenChange }: { data: SettingsData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("settings.data");
  const locale = useLocale();
  const [files, setFiles] = useState(true);
  const { files: count, bytes } = data.exportInfo;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("exportTitle")} description={t("exportDescription")}>
        <div className="flex flex-col gap-5" data-testid="s-export-dialog">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-4 py-3.5">
            <Checkbox checked={files} onCheckedChange={(v) => setFiles(v === true)} className="mt-0.5" data-testid="s-export-files" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-medium">{t("exportFiles")}</span>
              <span className="text-[13px] text-muted">{files ? t("exportFilesHint", { count, size: formatBytes(bytes, locale) }) : t("exportWithoutFiles")}</span>
            </span>
          </label>
          {data.closure.heldFiles > 0 ? <p className="rounded-xl bg-accent-soft px-4 py-2.5 text-[14px] text-accent-ink">{t("exportHeld", { count: data.closure.heldFiles })}</p> : null}
          <DownloadLinks data={data} files={files} primary />
          <p className="text-[13px] text-muted">{t("exportDownloadHint")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Closing the project: what is still open, the archive to keep, then read-only. */
function CloseDialog({ data, open, onOpenChange }: { data: SettingsData; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("settings.data");
  const [busy, setBusy] = useState(false);
  const c = data.closure;
  const checks = [
    { n: c.openTasks, text: t("closeOpenTasks", { count: c.openTasks }), href: "/tasks" },
    { n: c.inbox, text: t("closeInbox", { count: c.inbox }), href: "/inbox" },
    { n: c.filesToReview, text: t("closeReview", { count: c.filesToReview }), href: "/files/check" },
    { n: c.heldFiles, text: t("closeHeld", { count: c.heldFiles }), href: "/files/check?tab=flagged" },
  ];

  async function close() {
    setBusy(true);
    const ok = (await runAction(closeProjectAction(), { success: t("closed") })) !== undefined;
    setBusy(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("closeTitle")} description={t("closeDescription")}>
        <div className="flex flex-col gap-6" data-testid="s-close-dialog">
          <ul className="flex flex-col rounded-2xl border border-line px-4">
            {checks.map((k) => (
              <li key={k.href} className="flex items-center gap-3 border-b border-line-soft py-2.5 last:border-0">
                <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full", k.n ? "bg-accent-soft text-accent-ink" : "bg-panel text-muted")} aria-hidden>
                  {k.n ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Check size={13} strokeWidth={2.5} />}
                </span>
                <span className="min-w-0 flex-1 text-[15px]">{k.text}</span>
                {k.n ? (
                  <Link href={k.href} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[14px] text-ink-2 hover:bg-panel hover:text-ink" onClick={() => onOpenChange(false)}>
                    <FolderOpen size={14} aria-hidden />
                    {t("closeLook")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>

          <ol className="flex flex-col gap-5">
            <li className="flex gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-[14px] font-medium tabular-nums">1</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-medium">{t("closeStep1")}</span>
                  <span className="text-[13px] text-muted">{t("closeStep1Hint")}</span>
                </div>
                <div>
                  <DownloadLinks data={data} files />
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-[14px] font-medium tabular-nums">2</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-medium">{t("closeStep2")}</span>
                  <span className="text-[13px] text-muted">{t("closeStep2Hint")}</span>
                </div>
                <div>
                  <Button onClick={close} disabled={busy} data-testid="s-close-confirm">
                    <Lock size={15} />
                    {t("closeConfirm")}
                  </Button>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
