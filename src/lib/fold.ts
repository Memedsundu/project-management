/**
 * Turkish-aware search folding.
 *
 * "İSTANBUL", "Istanbul", "ıstanbul" and "istanbul" all become "istanbul";
 * "Çocuk İşçiliği" becomes "cocuk isciligi". Both the index and the query go
 * through the same function, so Turkish and English text match regardless of
 * case, dotted/dotless i, or accents. Prefix search on the folded words then
 * covers Turkish word endings ("çocuk" finds "çocukların").
 */
export function foldText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words of a query, folded, without very short noise words. */
export function queryTerms(query: string): string[] {
  return foldText(query)
    .split(/\s+/)
    .filter((w) => w.length >= 2 || /\d/.test(w))
    .slice(0, 12);
}

/**
 * A Postgres tsquery string for prefix matching: "cocuk:* & isci:*".
 * Only letters and digits survive folding, so the output is safe to pass
 * to to_tsquery as a bound parameter.
 */
export function prefixTsQuery(query: string, mode: "and" | "or" = "and"): string | null {
  const terms = queryTerms(query);
  if (terms.length === 0) return null;
  return terms.map((t) => `${t}:*`).join(mode === "and" ? " & " : " | ");
}

/** Common Turkish endings, already folded (ı→i, ü→u ...), longest first. */
const SUFFIXES = [
  "lerinden", "larindan", "lerinde", "larinda", "lerine", "larina", "lerini", "larini",
  "lerin", "larin", "leri", "lari", "ler", "lar", "indan", "inden", "ndan", "nden",
  "daki", "deki", "taki", "teki", "nin", "nun", "dan", "den", "tan", "ten",
  "ini", "ina", "ine", "nda", "nde", "si", "su", "yi", "yu", "ya", "ye",
  "da", "de", "ta", "te", "in", "un", "i", "u", "a", "e",
];

/**
 * A light Turkish stemmer for search: "raporlarından" → "rapor",
 * "sözleşmesi" → "sozlesme". It never cuts a word below four letters, so
 * English words and short Turkish words are left alone.
 */
export function stemTerm(folded: string): string {
  if (/\d/.test(folded)) return folded;
  let word = folded;
  for (let pass = 0; pass < 2; pass++) {
    const suffix = SUFFIXES.find((s) => word.endsWith(s) && word.length - s.length >= 4);
    if (!suffix) break;
    word = word.slice(0, -suffix.length);
  }
  return word;
}

/** Prefix query on stems, so "raporları" also finds "rapor" and "raporlarımız". */
export function stemmedTsQuery(query: string, mode: "and" | "or" = "and"): string | null {
  const terms = queryTerms(query);
  if (terms.length === 0) return null;
  return uniqTerms(terms.map(stemTerm))
    .map((t) => `${t}:*`)
    .join(mode === "and" ? " & " : " | ");
}

function uniqTerms(terms: string[]) {
  return Array.from(new Set(terms));
}
