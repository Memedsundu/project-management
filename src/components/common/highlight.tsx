import { foldText, queryTerms, stemTerm } from "@/lib/fold";

/** Bold the words that match the search, Turkish-aware ("rapor" marks "Raporları"). */
export function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query || !text) return <>{text}</>;
  const stems = queryTerms(query).map(stemTerm).filter((s) => s.length >= 2);
  if (!stems.length) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) => {
        const folded = foldText(part);
        const hit = folded && stems.some((s) => folded.startsWith(s));
        return hit ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </>
  );
}
