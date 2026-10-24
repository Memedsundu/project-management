"use client";

import { ArrowUp, Copy, ExternalLink, Loader2, MoreHorizontal, Search, Sparkles, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { askAction, deleteAskAction, saveAskAction } from "@/app/(app)/search/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tip } from "@/components/ui/overlay";
import { formatDateTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { Citation } from "@/server/db/schema/outputs";
import type { AskPageData } from "@/server/views/search";

type Thread = NonNullable<AskPageData["thread"]>;

/** Bold, bullets and [n] markers from the answer; each marker opens its source. */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) {
        const c = byN.get(Number(cite[1]));
        if (!c) return null;
        return (
          <Tip key={i} content={<span className="flex flex-col gap-1"><span className="font-medium">{c.title}{c.page ? ` · s. ${c.page}` : ""}</span>{c.quote ? <span className="text-on-ink/80">“{c.quote.slice(0, 220)}{c.quote.length > 220 ? "…" : ""}”</span> : null}</span>}>
            <a
              href={`#src-${c.n}`}
              className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-panel-2 px-1 align-[2px] text-[11px] font-semibold leading-none text-ink-2 no-underline hover:bg-ink hover:text-on-ink"
              aria-label={`${c.n}: ${c.title}`}
            >
              {c.n}
            </a>
          </Tip>
        );
      }
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      return <Fragment key={i}>{part}</Fragment>;
    });
  const blocks: { kind: "p" | "ul"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const bullet = /^[-*•]\s+/.test(line);
    const last = blocks.at(-1);
    if (bullet) {
      if (last?.kind === "ul") last.lines.push(line.replace(/^[-*•]\s+/, ""));
      else blocks.push({ kind: "ul", lines: [line.replace(/^[-*•]\s+/, "")] });
    } else if (last?.kind === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line.replace(/^#+\s*/, "")] });
  }
  return (
    <div className="flex flex-col gap-3 text-[16px] leading-relaxed">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.kind === "ul" ? (
            <ul key={i} className="flex flex-col gap-1.5">
              {b.lines.map((l, j) => (
                <li key={j} className="relative pl-4 before:absolute before:left-0.5 before:top-[0.7em] before:size-1.5 before:rounded-full before:bg-ink/40">
                  {inline(l)}
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>{inline(b.lines.join(" "))}</p>
          ),
        )}
    </div>
  );
}

function plainCopy(thread: Thread) {
  const sources = thread.citations.map((c) => `[${c.n}] ${c.title}${c.page ? `, s. ${c.page}` : ""}`).join("\n");
  return `${thread.question}\n\n${thread.answer}${sources ? `\n\n${sources}` : ""}`;
}

/** The answer card: Claude's words with numbered sources underneath (NotebookLM). */
function AnswerCard({ thread, onDeleted }: { thread: Thread; onDeleted: () => void }) {
  const t = useTranslations("search.ask");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [saved, setSaved] = useState(thread.saved);
  return (
    <article className="flex flex-col gap-5" data-testid="ask-answer">
      <header className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 font-display text-[28px] leading-tight md:text-[32px]">{thread.question}</h2>
        <span className="flex shrink-0 items-center gap-1 pt-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={saved ? t("unsave") : t("save")}
            aria-pressed={saved}
            onClick={async () => {
              const res = await runAction(saveAskAction(thread.id, !saved), { success: saved ? t("unsaved") : t("savedToast") });
              if (res !== undefined) setSaved(!saved);
            }}
          >
            <Star size={17} className={saved ? "fill-ink" : ""} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tc("copy")}
            onClick={async () => {
              await navigator.clipboard.writeText(plainCopy(thread));
              toast(tc("copied"));
            }}
          >
            <Copy size={16} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("menu")}>
                <MoreHorizontal size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                danger
                onSelect={async () => {
                  const res = await runAction(deleteAskAction(thread.id), { success: t("deleted") });
                  if (res !== undefined) onDeleted();
                }}
              >
                <Trash2 size={15} />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </header>
      <p className="-mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <Badge variant="ai" size="sm">
          <Sparkles size={11} />
          {tc("aiBadge")}
        </Badge>
        {formatDateTime(thread.createdAt, locale)}
        {thread.scopeType === "meetings" ? <span>· {t("scopes.meetings")}</span> : null}
      </p>
      <AnswerText text={thread.answer} citations={thread.citations} />
      {thread.citations.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="ask-sources">
          <h3 id="ask-sources" className="label-caps">
            {t("sources")}
          </h3>
          <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {thread.citations.map((c) => (
              <li key={c.n} id={`src-${c.n}`} className="flex scroll-mt-24 flex-col gap-1.5 rounded-2xl border border-line px-4 py-3 target:border-ink">
                <span className="flex items-center gap-2 text-[14px]">
                  <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-panel-2 px-1 text-[11px] font-semibold">{c.n}</span>
                  <EntityIcon type={c.sourceType} size={14} className="shrink-0 text-muted" />
                  <Link href={c.href ?? "#"} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {c.title}
                  </Link>
                  {c.page ? <span className="shrink-0 text-[12px] text-muted">{t("page", { page: c.page })}</span> : null}
                </span>
                {c.quote ? <blockquote className="line-clamp-4 border-l-2 border-line-strong pl-3 text-[13px] text-ink-2">{c.quote}</blockquote> : null}
                <Link href={c.href ?? "#"} className="inline-flex items-center gap-1 self-start text-[13px] text-muted hover:text-ink hover:underline">
                  <ExternalLink size={12} />
                  {c.page ? t("openAtPage", { page: c.page }) : t("open")}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="text-[13px] text-muted">{t("noCitations")}</p>
      )}
    </article>
  );
}

/** "Sor" (NotebookLM, Notion AI): questions answered from her own records, with the exact passage behind each claim. */
export function AskScreen({ data }: { data: AskPageData }) {
  const t = useTranslations("search.ask");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const [question, setQuestion] = useState(data.q);
  const [scope, setScope] = useState<"all" | "meetings">(data.scope);
  const [busy, setBusy] = useState<string | null>(null);
  const [empty, setEmpty] = useState<string | null>(null);
  const asked = useRef(false);
  useScreenContext({ kind: "ask", title: t("title"), detail: data.thread?.question });

  const ask = async (text: string) => {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(q);
    setEmpty(null);
    const res = await runAction(askAction(q, scope));
    setBusy(null);
    if (!res) return;
    if (!res.thread) {
      setEmpty(q);
      return;
    }
    setQuestion("");
    router.replace(`/search/ask?id=${res.thread.id}`);
  };

  useEffect(() => {
    if (data.q && !data.thread && data.aiReady && !asked.current) {
      asked.current = true;
      void ask(data.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved = data.history.filter((h) => h.saved);
  const recent = data.history.filter((h) => !h.saved);
  const examples = [t("examples.0"), t("examples.1"), t("examples.2")];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          {!data.aiReady ? (
            <EmptyState
              title={t("notConnectedTitle")}
              body={t("notConnectedBody")}
              icon={<Sparkles size={22} />}
              action={
                data.q ? (
                  <Button variant="outline" asChild>
                    <Link href={`/search?q=${encodeURIComponent(data.q)}`}>
                      <Search size={16} />
                      {t("keywordInstead")}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <form
              className="flex flex-col gap-2 rounded-3xl border border-line-strong px-4 pb-3 pt-3 focus-within:border-ink"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(question);
              }}
            >
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
                rows={2}
                maxLength={1000}
                autoFocus={!data.thread && !data.q}
                placeholder={t("placeholder")}
                aria-label={t("placeholder")}
                className="w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-faint"
                data-testid="ask-input"
              />
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1" role="radiogroup" aria-label={t("scope")}>
                  {(["all", "meetings"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={scope === s}
                      onClick={() => setScope(s)}
                      className={cn("inline-flex h-8 items-center rounded-full px-3 text-[13px] transition-colors", scope === s ? "bg-ink text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
                    >
                      {t(`scopes.${s}`)}
                    </button>
                  ))}
                </div>
                <Button type="submit" size="icon" className="ml-auto size-10" disabled={question.trim().length < 3 || Boolean(busy)} aria-label={t("ask")}>
                  {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}
                </Button>
              </div>
            </form>
          )}

          {busy ? (
            <div className="flex flex-col gap-4" aria-live="polite">
              <h2 className="font-display text-[28px] leading-tight md:text-[32px]">{busy}</h2>
              <p className="flex items-center gap-2 text-[14px] text-muted">
                <Loader2 size={15} className="animate-spin" />
                {t("reading")}
              </p>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-[92%]" />
                <Skeleton className="h-4 w-[85%]" />
                <Skeleton className="h-4 w-[60%]" />
              </div>
            </div>
          ) : empty ? (
            <EmptyState
              title={t("nothingTitle")}
              body={t("nothingBody")}
              icon={<Search size={22} />}
              action={
                <Button variant="outline" asChild>
                  <Link href={`/search?q=${encodeURIComponent(empty)}`}>
                    <Search size={16} />
                    {t("keywordInstead")}
                  </Link>
                </Button>
              }
            />
          ) : data.thread ? (
            <AnswerCard thread={data.thread} onDeleted={() => router.replace("/search/ask")} />
          ) : data.aiReady ? (
            <div className="flex flex-col gap-2">
              <p className="label-caps">{t("tryTitle")}</p>
              <div className="flex flex-wrap gap-2">
                {examples.map((ex) => (
                  <button key={ex} type="button" onClick={() => setQuestion(ex)} className="rounded-2xl border border-line px-4 py-2.5 text-left text-[14px] hover:border-ink">
                    {ex}
                  </button>
                ))}
              </div>
              <p className="pt-2 text-[13px] text-muted">{t("privacy")}</p>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-6" aria-label={t("history")}>
          {saved.length ? (
            <section className="flex flex-col gap-1">
              <h2 className="label-caps px-3">{t("savedTitle")}</h2>
              <HistoryItems items={saved} activeId={data.thread?.id} locale={locale} />
            </section>
          ) : null}
          <section className="flex flex-col gap-1">
            <h2 className="label-caps px-3">{t("history")}</h2>
            {recent.length ? <HistoryItems items={recent} activeId={data.thread?.id} locale={locale} /> : <p className="px-3 text-[14px] text-muted">{t("noHistory")}</p>}
          </section>
          {data.thread && !shell.readOnly ? (
            <Button variant="outline" className="self-start" onClick={() => router.push("/search/ask")}>
              {t("newQuestion")}
            </Button>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function HistoryItems({ items, activeId, locale }: { items: AskPageData["history"]; activeId?: string; locale: string }) {
  return (
    <ul className="flex flex-col">
      {items.map((h) => (
        <li key={h.id}>
          <Link
            href={`/search/ask?id=${h.id}`}
            aria-current={h.id === activeId ? "page" : undefined}
            className={cn("flex flex-col gap-0.5 rounded-xl px-3 py-2 hover:bg-panel", h.id === activeId && "bg-panel")}
          >
            <span className="line-clamp-2 text-[14px]">{h.question}</span>
            <span className="text-[12px] text-muted">{formatDateTime(h.createdAt, locale)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
