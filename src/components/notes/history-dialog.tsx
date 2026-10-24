"use client";

import { History, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  noteVersionAction,
  noteVersionsAction,
  restoreNoteVersionAction,
} from "@/app/(app)/notes/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { blocksToMarkdown, type Block } from "@/lib/blocks";
import { formatDateTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";

type Version = {
  id: string;
  title: string;
  createdAt: string;
  createdBy: string;
};

/** Notion page history: every saved version, a preview, and "Bu sürüme dön". */
export function HistoryDialog({
  noteId,
  open,
  onOpenChange,
  onRestored,
}: {
  noteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRestored: (v: { title: string; content: Block[] }) => void;
}) {
  const t = useTranslations("notes.history");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} wide>
        <HistoryBody
          noteId={noteId}
          onRestored={(v) => {
            onRestored(v);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function HistoryBody({
  noteId,
  onRestored,
}: {
  noteId: string;
  onRestored: (v: { title: string; content: Block[] }) => void;
}) {
  const t = useTranslations("notes.history");
  const locale = useLocale();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    title: string;
    markdown: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void runAction(noteVersionsAction(noteId)).then((rows) => {
      if (!alive) return;
      setVersions(rows ?? []);
      if (rows?.[0]) setActive(rows[0].id);
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void runAction(noteVersionAction(active), { silent: true }).then((v) => {
      if (alive && v)
        setPreview({
          id: v.id,
          title: v.title,
          markdown: blocksToMarkdown(v.content),
        });
    });
    return () => {
      alive = false;
    };
  }, [active]);

  if (!versions) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Loader2 size={16} className="animate-spin" /> {t("loading")}
      </div>
    );
  }
  if (!versions.length)
    return <p className="py-6 text-[15px] text-muted">{t("empty")}</p>;

  return (
    <div className="grid min-h-[360px] gap-4 md:grid-cols-[220px_1fr]">
      <ul className="scrollbar-thin flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
        {versions.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setActive(v.id)}
              className={cn(
                "flex min-h-11 w-full flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left hover:bg-panel",
                active === v.id && "bg-panel",
              )}
            >
              <span className="flex items-center gap-1.5 text-[14px] font-medium">
                {v.createdBy === "ai" ? (
                  <Sparkles size={13} className="text-accent" />
                ) : (
                  <History size={13} className="text-muted" />
                )}
                {formatDateTime(v.createdAt, locale)}
              </span>
              <span className="truncate text-[12px] text-muted">
                {v.title || t("untitled")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="prose-app scrollbar-thin max-h-[50vh] min-h-[200px] overflow-y-auto rounded-xl border border-line px-5 py-4">
          {preview && preview.id === active ? (
            <>
              <h2 className="font-display text-[26px]">
                {preview.title || t("untitled")}
              </h2>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {preview.markdown.replace(
                  /\(app:\/\/[a-z]+\/[0-9a-f-]+\)/g,
                  "(#)",
                )}
              </ReactMarkdown>
            </>
          ) : (
            <Loader2 size={16} className="animate-spin text-muted" />
          )}
        </div>
        <div className="flex justify-end">
          <Button
            disabled={!active || busy}
            onClick={async () => {
              if (!active) return;
              setBusy(true);
              const res = await runAction(
                restoreNoteVersionAction(noteId, active),
                { success: t("restored") },
              );
              setBusy(false);
              if (res) onRestored(res);
            }}
          >
            <RotateCcw size={15} />
            {t("restore")}
          </Button>
        </div>
      </div>
    </div>
  );
}
