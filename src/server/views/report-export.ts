import "server-only";
import type { Citation } from "@/server/db/schema";
import { getReport } from "@/server/services/reports";

/** Citations in exported text: a token Markdown leaves alone ("⟦1,3⟧"), turned into a superscript by Word and the print view. */
export const citeToken = (ns: number[]) => `⟦${ns.join(",")}⟧`;
export const CITE_TOKEN = /⟦(\d+(?:,\d+)*)⟧/g;

export type ExportSource = { n: number; title: string; page: number | null };

/**
 * The report as it leaves the app. Each section numbers its own citations,
 * so here they are numbered again across the whole report: the same file and
 * page keeps one number, in the order they first appear. With `clean` the
 * numbers and the source list are left out, for a donor who wants plain text.
 */
export async function reportForExport(id: string, opts: { clean?: boolean } = {}) {
  const r = await getReport(id);
  if (!r || r.deletedAt) return null;
  const numbers = new Map<string, number>();
  const sources: ExportSource[] = [];
  const keyOf = (c: Citation) => `${c.sourceType}:${c.sourceId}:${c.page ?? ""}`;

  const sections = r.sections.map((s) => {
    const byN = new Map(s.citations.map((c) => [c.n, c]));
    // "[1][3]" after a sentence: one run of markers, renumbered and kept in order.
    const content = s.content
      .replace(/[ \t]*(?:\[\d+\])+/g, (run) => {
        const literal: string[] = [];
        const ns: number[] = [];
        for (const m of run.matchAll(/\[(\d+)\]/g)) {
          const c = byN.get(Number(m[1]));
          // Her own brackets ("annex [2]") are text, not a citation.
          if (!c) {
            literal.push(m[0]);
            continue;
          }
          if (opts.clean) continue;
          const key = keyOf(c);
          let n = numbers.get(key);
          if (!n) {
            n = sources.length + 1;
            numbers.set(key, n);
            sources.push({ n, title: c.title, page: c.page ?? null });
          }
          if (!ns.includes(n)) ns.push(n);
        }
        // Superscripts sit right after the word, in rising order ("1,2"); her own brackets keep their space.
        return (literal.length ? /^[ \t]*/.exec(run)![0] + literal.join("") : "") + (ns.length ? citeToken(ns.sort((a, b) => a - b)) : "");
      })
      .trim();
    return { heading: s.heading, content };
  });

  return {
    title: r.title,
    status: r.status as "draft" | "final",
    periodLabel: r.periodLabel,
    audience: r.audience,
    language: r.language,
    dueDate: r.dueDate,
    sections,
    sources: opts.clean ? [] : sources,
  };
}
export type ReportExport = NonNullable<Awaited<ReturnType<typeof reportForExport>>>;

/** Words for the exported file, in the report's own language (not the screen's). */
export function exportWords(language: string) {
  const tr = language === "tr";
  return {
    sources: tr ? "Kaynaklar" : "Sources",
    page: (n: number) => (tr ? `s. ${n}` : `p. ${n}`),
    draft: tr ? "Taslak" : "Draft",
    due: tr ? "Teslim" : "Due",
    empty: tr ? "[Bu bölüm henüz yazılmadı]" : "[This section has not been written yet]",
  };
}
