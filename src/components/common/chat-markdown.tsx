"use client";

import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Claude's chat Markdown: paragraphs, headings, bullet and numbered lists,
 * **bold**, `code` and links. Only links inside the app are clickable; any
 * other address shows as text, because answers can quote uploaded files.
 */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number; check: boolean | null }[] }
  | { kind: "code"; text: string };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  let code: string[] | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      if (last?.kind === "p") blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", text: heading[1]! });
      continue;
    }
    const bullet = /^(\s*)[-*•]\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const depth = Math.min(2, Math.floor((bullet ?? numbered)![1]!.length / 2));
      const item = bullet ? { text: bullet[3]!, depth, check: bullet[2] === undefined ? null : bullet[2] !== " " } : { text: numbered![2]!, depth, check: null };
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    if (last?.kind === "p") last.lines.push(line.trim());
    else blocks.push({ kind: "p", lines: [line.trim()] });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks.filter((b) => b.kind !== "p" || b.lines.length);
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

function Inline({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-panel-2 px-1 py-0.5 text-[13px]">
              {part.slice(1, -1)}
            </code>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (link) {
          const [, label, href] = link;
          if (href!.startsWith("/") && !href!.startsWith("//")) {
            return (
              <Link key={i} href={href!} onClick={onNavigate} className="font-medium underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                {label}
              </Link>
            );
          }
          return (
            <span key={i} title={href}>
              {label}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function ChatMarkdown({ text, onNavigate, className }: { text: string; onNavigate?: () => void; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={cn("flex flex-col gap-2.5 text-[15px] leading-relaxed", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <p key={i} className="pt-1 text-[15px] font-semibold">
              <Inline text={b.text} onNavigate={onNavigate} />
            </p>
          );
        }
        if (b.kind === "code") {
          return (
            <pre key={i} className="overflow-x-auto rounded-xl bg-panel px-3 py-2 text-[13px]">
              {b.text}
            </pre>
          );
        }
        if (b.kind === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List key={i} className="flex flex-col gap-1">
              {b.items.map((it, j) => (
                <li
                  key={j}
                  className={cn("relative", !b.ordered && it.check === null && "pl-4 before:absolute before:left-0.5 before:top-[0.7em] before:size-1.5 before:rounded-full before:bg-ink/40", b.ordered && "pl-6", it.check !== null && "pl-6")}
                  style={it.depth ? { marginLeft: it.depth * 16 } : undefined}
                >
                  {b.ordered ? <span className="absolute left-0 text-muted">{j + 1}.</span> : null}
                  {it.check !== null ? (
                    <span aria-hidden className={cn("absolute left-0 top-[0.3em] inline-flex size-4 items-center justify-center rounded border text-[11px]", it.check ? "border-ink bg-ink text-on-ink" : "border-line-strong")}>
                      {it.check ? "✓" : ""}
                    </span>
                  ) : null}
                  <Inline text={it.text} onNavigate={onNavigate} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j ? <br /> : null}
                <Inline text={l} onNavigate={onNavigate} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
