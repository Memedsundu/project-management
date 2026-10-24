"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { Tip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import type { Citation } from "@/server/db/schema/outputs";
import { EntityIcon } from "./entity-icon";

/**
 * Claude's cited writing (Sor, collection chat, Studio outputs): headings,
 * bullets, numbered lists, bold and [n] markers. Each marker shows the quoted
 * passage on hover and jumps to its source card underneath.
 */
export function CitedText({ text, citations, idPrefix = "", className }: { text: string; citations: Citation[]; idPrefix?: string; className?: string }) {
  const t = useTranslations("search.ask");
  const byN = new Map(citations.map((c) => [c.n, c]));
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i) => {
      const cite = /^\[(\d+)\]$/.exec(part);
      if (cite) {
        const c = byN.get(Number(cite[1]));
        if (!c) return null;
        return (
          <Tip
            key={i}
            content={
              <span className="flex flex-col gap-1">
                <span className="font-medium">
                  {c.title}
                  {c.page ? ` · ${t("page", { page: c.page })}` : ""}
                </span>
                {c.quote ? (
                  <span className="text-on-ink/80">
                    “{c.quote.slice(0, 220)}
                    {c.quote.length > 220 ? "…" : ""}”
                  </span>
                ) : null}
              </span>
            }
          >
            <a
              href={`#${idPrefix}src-${c.n}`}
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
  const blocks: { kind: "p" | "ul" | "ol" | "h"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const last = blocks.at(-1);
    if (!line) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (heading) blocks.push({ kind: "h", lines: [heading[1]!] });
    else if (bullet) {
      if (last?.kind === "ul") last.lines.push(bullet[1]!);
      else blocks.push({ kind: "ul", lines: [bullet[1]!] });
    } else if (numbered) {
      if (last?.kind === "ol") last.lines.push(numbered[1]!);
      else blocks.push({ kind: "ol", lines: [numbered[1]!] });
    } else if (last?.kind === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }
  return (
    <div className={cn("flex flex-col gap-3 text-[16px] leading-relaxed", className)}>
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.kind === "h" ? (
            <h3 key={i} className="pt-1 text-[17px] font-semibold leading-snug">
              {inline(b.lines[0]!)}
            </h3>
          ) : b.kind === "ul" ? (
            <ul key={i} className="flex flex-col gap-1.5">
              {b.lines.map((l, j) => (
                <li key={j} className="relative pl-4 before:absolute before:left-0.5 before:top-[0.7em] before:size-1.5 before:rounded-full before:bg-ink/40">
                  {inline(l)}
                </li>
              ))}
            </ul>
          ) : b.kind === "ol" ? (
            <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted">
              {b.lines.map((l, j) => (
                <li key={j} className="pl-1">
                  {inline(l)}
                </li>
              ))}
            </ol>
          ) : (
            <p key={i}>{inline(b.lines.join(" "))}</p>
          ),
        )}
    </div>
  );
}

/** The numbered sources under a cited answer, each with its quoted passage and a link to the page. */
export function SourceList({ citations, idPrefix = "", columns = 2, headingId, compact }: { citations: Citation[]; idPrefix?: string; columns?: 1 | 2; headingId?: string; compact?: boolean }) {
  const t = useTranslations("search.ask");
  // One line per source under a chat answer; the quote shows on the marker.
  if (compact)
    return (
      <ol className="flex flex-col" aria-labelledby={headingId}>
        {citations.map((c) => (
          <li key={c.n} id={`${idPrefix}src-${c.n}`} className="scroll-mt-24 rounded-xl target:bg-panel">
            <Link href={c.href ?? "#"} className="flex min-h-8 items-center gap-2 px-1.5 text-[13px] text-ink-2 hover:text-ink hover:underline">
              <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-panel-2 px-1 text-[11px] font-semibold">{c.n}</span>
              <EntityIcon type={c.sourceType} size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.page ? <span className="shrink-0 text-[12px] text-muted">{t("page", { page: c.page })}</span> : null}
            </Link>
          </li>
        ))}
      </ol>
    );
  return (
    <ol className={cn("grid grid-cols-1 gap-2", columns === 2 && "md:grid-cols-2")} aria-labelledby={headingId}>
      {citations.map((c) => (
        <li key={c.n} id={`${idPrefix}src-${c.n}`} className="flex scroll-mt-24 flex-col gap-1.5 rounded-2xl border border-line px-4 py-3 target:border-ink">
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
  );
}

/** Plain text with the sources listed underneath, for the clipboard. */
export function plainCited(text: string, citations: Citation[], opts: { heading?: string; page: (n: number) => string }) {
  const { heading, page } = opts;
  const sources = citations.map((c) => `[${c.n}] ${c.title}${c.page ? `, ${page(c.page)}` : ""}`).join("\n");
  return `${heading ? `${heading}\n\n` : ""}${text.replace(/\*\*([^*]+)\*\*/g, "$1")}${sources ? `\n\n${sources}` : ""}`;
}
