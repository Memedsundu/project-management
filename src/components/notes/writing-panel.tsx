"use client";

import { ArrowDownToLine, Copy, Loader2, Replace, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { writingToolAction } from "@/app/(app)/notes/actions";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";

export type WritingRequest = { text: string; afterBlockId: string; replace: boolean; context: string };

type Op = "shorten" | "clarify" | "formal" | "bullets" | "continue" | "translate" | "custom";

/** Notion AI's bar: pick what to do with the selection, read the answer, then decide where it goes. */
export function WritingPanel({
  owner,
  request,
  onClose,
  onApply,
}: {
  owner: { type: "note" | "meeting"; id: string };
  request: WritingRequest;
  onClose: () => void;
  onApply: (markdown: string, mode: "replace" | "below") => void;
}) {
  const t = useTranslations("notes.ai");
  const [busy, setBusy] = useState<Op | null>(null);
  const [result, setResult] = useState<{ op: Op; text: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [last, setLast] = useState<{ op: Op; target?: "tr" | "en" } | null>(null);
  const hasSelection = request.text.trim().length > 0;

  const run = async (op: Op, target?: "tr" | "en") => {
    if (busy) return;
    setBusy(op);
    setLast({ op, target });
    const res = await runAction(
      writingToolAction({
        owner,
        op,
        text: request.text || request.context,
        context: hasSelection ? request.context : undefined,
        target: target ?? null,
        prompt: op === "custom" ? prompt : null,
      }),
    );
    setBusy(null);
    if (res) setResult({ op, text: res.text });
  };

  const ops: { op: Op; label: string; target?: "tr" | "en"; needsSelection?: boolean }[] = [
    { op: "shorten", label: t("shorten"), needsSelection: true },
    { op: "clarify", label: t("clarify"), needsSelection: true },
    { op: "formal", label: t("formal"), needsSelection: true },
    { op: "bullets", label: t("bullets"), needsSelection: true },
    { op: "continue", label: t("continue") },
    { op: "translate", label: t("toEnglish"), target: "en", needsSelection: true },
    { op: "translate", label: t("toTurkish"), target: "tr", needsSelection: true },
  ];

  return (
    <div
      role="dialog"
      aria-label={t("title")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-h-[70vh] max-w-[680px] flex-col gap-3 rounded-2xl border border-line bg-bg p-4 shadow-[var(--shadow)] sm:bottom-6"
    >
      <header className="flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <h2 className="text-[15px] font-semibold">{t("title")}</h2>
        <span className="flex-1" />
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t("close")}>
          <X size={16} />
        </Button>
      </header>
      {hasSelection ? <p className="line-clamp-2 border-l-2 border-line-strong pl-3 text-[13px] text-muted">{request.text}</p> : <p className="text-[13px] text-muted">{t("noSelection")}</p>}

      {!result ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {ops
              .filter((o) => hasSelection || !o.needsSelection)
              .map((o) => (
                <button
                  key={`${o.op}-${o.target ?? ""}`}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => run(o.op, o.target)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[14px] hover:border-ink disabled:opacity-50",
                    busy === o.op && "border-ink",
                  )}
                >
                  {busy === o.op ? <Loader2 size={14} className="animate-spin" /> : null}
                  {o.label}
                </button>
              ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) void run("custom");
            }}
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("customPlaceholder")}
              aria-label={t("customPlaceholder")}
              className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-bg px-4 text-[14px] outline-none focus:border-ink"
            />
            <Button type="submit" size="icon" disabled={!prompt.trim() || Boolean(busy)} aria-label={t("send")}>
              {busy === "custom" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </Button>
          </form>
          <p className="text-[12px] text-faint">{t("privacy")}</p>
        </>
      ) : (
        <>
          <div className="prose-app scrollbar-thin min-h-0 overflow-y-auto rounded-xl bg-panel px-4 py-3 text-[15px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.text}</ReactMarkdown>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasSelection && request.replace && result.op !== "continue" ? (
              <Button size="sm" onClick={() => onApply(result.text, "replace")}>
                <Replace size={14} />
                {t("replace")}
              </Button>
            ) : null}
            <Button size="sm" variant={hasSelection && request.replace && result.op !== "continue" ? "outline" : "primary"} onClick={() => onApply(result.text, "below")}>
              <ArrowDownToLine size={14} />
              {t("insertBelow")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(result.text);
                toast(t("copied"));
              }}
            >
              <Copy size={14} />
              {t("copy")}
            </Button>
            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => last && run(last.op, last.target)}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              {t("retry")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
              {t("back")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
