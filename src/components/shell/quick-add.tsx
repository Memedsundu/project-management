"use client";

import { CheckSquare, FileUp, Link2, NotebookPen, Sparkles, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createInboxNoteAction } from "@/app/(app)/notes/actions";
import { aiParseTaskAction, createTaskAction, createTasksAction, quickAddContextAction } from "@/app/(app)/tasks/actions";
import { useUploader } from "@/components/files/use-uploader";
import { ParseChips, parsedToInput } from "@/components/tasks/parse-chips";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { todayStr } from "@/lib/dates";
import { describeRule, parseTaskInput, splitLines, type ParsedTask, type PartnerRef } from "@/lib/parse-task";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { QuickAddPrefill } from "./shell-context";
import { useShell } from "./shell-context";

type Mode = "task" | "note" | "file";

/**
 * Hızlı ekle (N): one box for a task, a note or a file, from anywhere.
 * Tasks are parsed as she types; several lines become several tasks.
 * Things without a date or a home wait in Gelen kutusu.
 */
export function QuickAdd({ prefill, onClose }: { prefill: QuickAddPrefill; onClose: () => void }) {
  const t = useTranslations("tasks.quick");
  const tt = useTranslations("tasks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const [mode, setMode] = useState<Mode>(prefill.mode ?? "task");
  const [text, setText] = useState(prefill.text ?? "");
  const [ctx, setCtx] = useState<{ today: string; partners: PartnerRef[]; ai: boolean }>({ today: todayStr(), partners: [], ai: shell.aiConfigured });
  const [aiParsed, setAiParsed] = useState<{ text: string; parsed: ParsedTask } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const ref = useRef<HTMLTextAreaElement>(null);
  const uploader = useUploader();

  useEffect(() => {
    runAction(quickAddContextAction(), { silent: true }).then((r) => r && setCtx(r));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [mode]);

  const lines = useMemo(() => (mode === "task" ? splitLines(text) : []), [mode, text]);
  const many = lines.length > 1;
  const parsedLocal = useMemo(
    () => (mode === "task" && text.trim() && !many ? parseTaskInput(text.trim(), { today: ctx.today, partners: ctx.partners }) : null),
    [mode, text, many, ctx],
  );
  const parsed = aiParsed && aiParsed.text === text ? aiParsed.parsed : parsedLocal;
  const parsedMany = useMemo(
    () => (many ? lines.map((l) => parseTaskInput(l, { today: ctx.today, partners: ctx.partners })) : []),
    [many, lines, ctx],
  );

  const link = prefill.link ? { type: prefill.link.type, id: prefill.link.id } : null;
  const goesToInbox = (p: ParsedTask) => !link && !p.dueDate && !p.startDate && !p.ownerOrgId && !p.ownerName && !p.orgId;

  const saveTask = async () => {
    if (!parsed) return;
    setBusy(true);
    const res = await runAction(
      createTaskAction({ ...parsedToInput(parsed, { locale, inbox: goesToInbox(parsed) }), links: link ? [link] : undefined }),
    );
    setBusy(false);
    if (res) {
      toast(goesToInbox(parsed) ? t("taskSavedInbox") : t("taskSaved"));
      onClose();
    }
  };

  const saveMany = async () => {
    const keep = parsedMany.filter((_, i) => !skip.has(i));
    if (!keep.length) return;
    setBusy(true);
    const res = await runAction(
      createTasksAction(keep.map((p) => ({ ...parsedToInput(p, { locale, inbox: goesToInbox(p) }), links: link ? [link] : undefined }))),
    );
    setBusy(false);
    if (res) {
      toast(t("tasksSaved", { count: res.ids.length }));
      onClose();
    }
  };

  const saveNote = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const res = await runAction(createInboxNoteAction(text, link));
    setBusy(false);
    if (res) {
      toast(link ? t("noteSavedLinked") : t("noteSaved"));
      onClose();
    }
  };

  const askAi = async () => {
    if (!text.trim()) return;
    setAiBusy(true);
    const r = await runAction(aiParseTaskAction(text.trim()));
    setAiBusy(false);
    if (!r) return;
    const partnerName = (id: string | null) => {
      const p = ctx.partners.find((x) => x.id === id);
      return p ? p.shortName || p.name : "";
    };
    const tokens: ParsedTask["tokens"] = [];
    if (r.dueDate) tokens.push({ kind: "date", text: "", value: r.dueDate });
    if (r.startDate) tokens.push({ kind: "start", text: "", value: r.startDate });
    if (r.dueTime) tokens.push({ kind: "time", text: "", value: r.dueTime });
    if (r.priority) tokens.push({ kind: "priority", text: "", value: `p${r.priority}` });
    for (const tag of r.tags) tokens.push({ kind: "tag", text: "", value: tag });
    if (r.partnerId) tokens.push({ kind: "partner", text: "", value: partnerName(r.partnerId) });
    if (r.ownerPartnerId || r.ownerName) tokens.push({ kind: "owner", text: "", value: r.ownerPartnerId ? partnerName(r.ownerPartnerId) : r.ownerName! });
    if (r.recurrence) tokens.push({ kind: "recurrence", text: "", value: describeRule(r.recurrence, locale === "en" ? "en" : "tr") });
    if (r.estimateMin) tokens.push({ kind: "estimate", text: "", value: `${r.estimateMin} dk` });
    setAiParsed({
      text,
      parsed: {
        title: r.title || text.trim(),
        dueDate: r.dueDate,
        startDate: r.startDate,
        dueTime: r.dueTime,
        priority: r.priority,
        tags: r.tags,
        orgId: r.partnerId,
        ownerOrgId: r.ownerPartnerId,
        ownerName: r.ownerPartnerId ? null : r.ownerName,
        recurrence: r.recurrence,
        recurrenceLabel: null,
        estimateMin: r.estimateMin,
        tokens,
      },
    });
  };

  const submit = () => {
    if (busy) return;
    if (mode === "task") (many ? saveMany : saveTask)();
    if (mode === "note") saveNote();
  };

  const modes: { key: Mode; label: string; icon: typeof CheckSquare }[] = [
    { key: "task", label: t("task"), icon: CheckSquare },
    { key: "note", label: t("note"), icon: NotebookPen },
    { key: "file", label: t("file"), icon: FileUp },
  ];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={t("title")} hideTitle className="top-[12vh]" aria-describedby={undefined}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1" role="tablist" aria-label={t("title")}>
              {modes.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.key}
                  onClick={() => setMode(m.key)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px]",
                    mode === m.key ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink",
                  )}
                >
                  <m.icon size={15} />
                  {m.label}
                </button>
              ))}
            </div>
            {prefill.link ? (
              <span className="inline-flex max-w-[50%] items-center gap-1.5 truncate rounded-full bg-panel px-3 py-1 text-[12.5px] text-ink-2">
                <Link2 size={12} />
                <span className="truncate">{prefill.link.title}</span>
              </span>
            ) : null}
          </div>

          {mode === "file" ? (
            <FileDrop uploader={uploader} onDone={onClose} hint={t("fileHint")} choose={t("chooseFiles")} />
          ) : (
            <>
              <textarea
                ref={ref}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    const single = mode === "task" && !many && !e.shiftKey;
                    if (single || e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      submit();
                    }
                  }
                }}
                rows={Math.min(10, Math.max(mode === "note" ? 5 : 2, text.split("\n").length + 1))}
                placeholder={mode === "task" ? tt("addTaskPlaceholder") : t("notePlaceholder")}
                className="w-full resize-none rounded-xl border border-line-strong bg-bg px-4 py-3 text-[16px] leading-relaxed outline-none placeholder:text-faint focus:border-ink"
                aria-label={mode === "task" ? tt("addTask") : t("note")}
                data-testid="quick-add-input"
              />

              {mode === "task" && !many && parsed ? (
                <div className="flex flex-col gap-2">
                  <ParseChips parsed={parsed} />
                  {parsed.title !== text.trim() ? (
                    <p className="text-[13px] text-muted">
                      {tc("title")}: <span className="text-ink">{parsed.title}</span>
                    </p>
                  ) : null}
                  {goesToInbox(parsed) ? <p className="text-[13px] text-muted">{t("inboxHint")}</p> : null}
                </div>
              ) : null}

              {mode === "task" && many ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[14px] font-medium">{t("manyTitle", { count: parsedMany.length - skip.size })}</p>
                  <ul className="scrollbar-thin flex max-h-[38vh] flex-col overflow-y-auto">
                    {parsedMany.map((p, i) => (
                      <li key={i} className="flex items-start gap-3 border-b border-line-soft py-2 last:border-0">
                        <span className="pt-0.5">
                          <Checkbox
                            checked={!skip.has(i)}
                            onCheckedChange={(v) =>
                              setSkip((s) => {
                                const n = new Set(s);
                                if (v === true) n.delete(i);
                                else n.add(i);
                                return n;
                              })
                            }
                            aria-label={p.title}
                          />
                        </span>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-[14.5px]">{p.title}</span>
                          <ParseChips parsed={p} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12.5px] text-faint">
                  {mode === "task" && !many ? (
                    <>
                      <Kbd>Enter</Kbd> {t("save")}
                      <Kbd>⇧ Enter</Kbd> {t("newLine")}
                    </>
                  ) : (
                    <>
                      <Kbd>⌘ Enter</Kbd> {t("save")}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {mode === "task" && !many && ctx.ai && text.trim() ? (
                    <Button variant="ghost" size="sm" onClick={askAi} disabled={aiBusy}>
                      <Sparkles size={15} className="text-accent" />
                      {aiBusy ? tc("working") : t("aiParse")}
                    </Button>
                  ) : null}
                  <Button onClick={submit} disabled={busy || !text.trim()} data-testid="quick-add-save">
                    {many ? t("saveMany", { count: parsedMany.length - skip.size }) : t("save")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileDrop({ uploader, onDone, hint, choose }: { uploader: ReturnType<typeof useUploader>; onDone: () => void; hint: string; choose: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const start = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const ok = await uploader.upload(Array.from(files), { folderId: null });
    if (ok) onDone();
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        start(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center",
        over ? "border-ink bg-panel" : "border-line-strong",
      )}
    >
      <Upload size={26} className="text-muted" />
      <p className="max-w-[40ch] text-[14px] text-muted">{hint}</p>
      <input ref={input} type="file" multiple className="sr-only" onChange={(e) => start(e.target.files)} />
      <Button variant="secondary" onClick={() => input.current?.click()} disabled={uploader.busy}>
        {uploader.busy ? uploader.label : choose}
      </Button>
    </div>
  );
}
