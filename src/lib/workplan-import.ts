import { foldText } from "./fold";
import { PROVINCES } from "./provinces";

/**
 * Reading a workplan from Excel. Most workplans start as a spreadsheet: a
 * row per activity with code, title, partner and dates, or a Gantt grid of
 * month columns marked with an X or a fill colour. These pure functions run
 * on the server (for the import) and in the browser (for the live preview),
 * so the preview and the result always agree.
 */

export const IMPORT_FIELDS = ["ignore", "code", "title", "output", "partners", "provinces", "start", "end", "status", "progress", "depends", "description"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Record<number, ImportField>;

/** One cell as read from the file: its text and whether it has a fill colour. */
export type GridCell = { text: string; filled?: boolean };

export type ImportColumn = {
  index: number;
  header: string;
  samples: string[];
  /** A month or quarter column of a Gantt grid. */
  period: { from: string; to: string; relative: boolean } | null;
  /** The year written above the header, for month names without one. */
  year: number | null;
};

export type ImportSheet = {
  name: string;
  headerRow: number;
  /** Title lines above the header ("Project start: April 2026"). */
  preamble: string[];
  columns: ImportColumn[];
  rows: { cells: string[]; marked: number[] }[];
};

export type ImportedActivity = {
  row: number;
  code: string;
  title: string;
  description: string | null;
  start: string | null;
  end: string | null;
  status: "planned" | "ongoing" | "done" | "delayed" | "canceled" | null;
  progress: number | null;
  partners: string[];
  provinces: string[];
  depends: string[];
  output: string | null;
  /** The output heading row the activity sits under, if the sheet has one. */
  section: string | null;
};

export type ImportedOutput = { code: string; title: string; level: "outcome" | "output"; parent: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y: number, m: number) => ({ from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` });
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

const MONTHS: [RegExp, number][] = [
  [/^(ocak|oca|january|jan)$/, 1],
  [/^(subat|sub|february|feb)$/, 2],
  [/^(mart|mar|march)$/, 3],
  [/^(nisan|nis|april|apr)$/, 4],
  [/^(mayis|may)$/, 5],
  [/^(haziran|haz|june|jun)$/, 6],
  [/^(temmuz|tem|july|jul)$/, 7],
  [/^(agustos|agu|august|aug)$/, 8],
  [/^(eylul|eyl|september|sept|sep)$/, 9],
  [/^(ekim|eki|october|oct)$/, 10],
  [/^(kasim|kas|november|nov)$/, 11],
  [/^(aralik|ara|december|dec)$/, 12],
];

function monthOf(word: string) {
  for (const [re, m] of MONTHS) if (re.test(word)) return m;
  return null;
}

function addMonths(base: { year: number; month: number }, n: number) {
  const idx = base.year * 12 + (base.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/**
 * A header such as "Oca 2026", "Jan-26", "2026-03", "Q2 2026", "Ç3 2027",
 * "M5" or "Y2 Q1" as a date range. Relative headers (M5, Y2 Q1) count from
 * the base month, which is the project start unless she changes it.
 */
export function parsePeriodHeader(text: string, ctx: { year?: number | null; base: { year: number; month: number } }): ImportColumn["period"] {
  const f = foldText(text);
  if (!f) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4}) (\d{1,2}) (\d{1,2})$/.exec(f))) return monthOk(Number(m[1]), Number(m[2]));
  if ((m = /^(\d{1,2}) (\d{1,2}) (\d{4})$/.exec(f))) return monthOk(Number(m[3]), Number(m[2]));
  if ((m = /^(\d{4}) (\d{1,2})$/.exec(f))) return monthOk(Number(m[1]), Number(m[2]));
  if ((m = /^(\d{1,2}) (\d{4})$/.exec(f))) return monthOk(Number(m[2]), Number(m[1]));
  // Quarters: Q1 2026, 2026 Q1, Ç1 2026 (folded to c1), 1. çeyrek 2026.
  if ((m = /^(?:q|c)\s?([1-4]) (\d{2}|\d{4})$/.exec(f)) || (m = /^([1-4]) (?:ceyrek|quarter) (\d{2}|\d{4})$/.exec(f))) return quarter(fullYear(Number(m[2])), Number(m[1]), false);
  if ((m = /^(\d{4}) (?:q|c)\s?([1-4])$/.exec(f))) return quarter(Number(m[1]), Number(m[2]), false);
  // Relative: M1, Ay 1, Month 1; Y1 Q1, Yıl 1 Ç1.
  if ((m = /^(?:m|ay|month)\s?(\d{1,2})$/.exec(f))) {
    const n = Number(m[1]);
    if (n < 1 || n > 72) return null;
    const at = addMonths(ctx.base, n - 1);
    return { ...monthRange(at.year, at.month), relative: true };
  }
  if ((m = /^(?:y|yil|year)\s?(\d) ?(?:q|c|ceyrek|quarter)\s?([1-4])$/.exec(f))) {
    const start = addMonths(ctx.base, (Number(m[1]) - 1) * 12 + (Number(m[2]) - 1) * 3);
    const end = addMonths(start, 2);
    return { from: monthRange(start.year, start.month).from, to: monthRange(end.year, end.month).to, relative: true };
  }
  const words = f.split(" ");
  const month = monthOf(words[0]!);
  if (month) {
    if (words.length === 1 && ctx.year) return monthOk(ctx.year, month);
    if (words.length === 2 && /^\d{2}(\d{2})?$/.test(words[1]!)) return monthOk(fullYear(Number(words[1])), month);
    return null;
  }
  if (words.length === 2 && /^\d{2}(\d{2})?$/.test(words[0]!)) {
    const mm = monthOf(words[1]!);
    if (mm) return monthOk(fullYear(Number(words[0])), mm);
  }
  return null;

  function monthOk(y: number, mo: number) {
    if (mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
    return { ...monthRange(y, mo), relative: false };
  }
  function quarter(y: number, q: number, relative: boolean) {
    const s = (q - 1) * 3 + 1;
    return { from: monthRange(y, s).from, to: monthRange(y, s + 2).to, relative };
  }
}

const HEADER_WORDS = /\b(kod|code|no|faaliyet|activity|etkinlik|cikti|output|ortak|partner|sorumlu|responsible|il|iller|province|location|baslangic|start|bitis|end|durum|status|aciklama|description)\b/;

/** Find the header row, read the columns and keep the data rows below it. */
export function buildSheet(name: string, grid: GridCell[][], base: { year: number; month: number }): ImportSheet | null {
  const width = Math.min(150, Math.max(0, ...grid.slice(0, 60).map((r) => r.length)));
  let best = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(25, grid.length); r++) {
    const cells = (grid[r] ?? []).map((c) => c.text.trim());
    const filled = cells.filter(Boolean);
    if (filled.length < 2) continue;
    const textual = filled.filter((c) => !/^[\d.,%\s-]+$/.test(c)).length;
    const words = filled.filter((c) => HEADER_WORDS.test(foldText(c))).length;
    const periods = filled.filter((c) => parsePeriodHeader(c, { year: 2026, base })).length;
    const score = textual + words * 3 + Math.min(periods, 6);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (best < 0) return null;
  // A year written above the month names ("2026" merged across twelve columns).
  const years: (number | null)[] = [];
  for (let c = 0; c < width; c++) {
    let y: number | null = null;
    for (let r = best - 1; r >= Math.max(0, best - 2) && y === null; r--) {
      for (let k = c; k >= 0; k--) {
        const t = grid[r]?.[k]?.text.trim() ?? "";
        const ym = /(?:^|\D)(20\d{2})(?:\D|$)/.exec(t);
        if (ym) {
          y = Number(ym[1]);
          break;
        }
      }
    }
    years.push(y);
  }
  const header = grid[best] ?? [];
  const body = grid.slice(best + 1).filter((r) => r.some((c) => c.text.trim() || c.filled));
  const columns: ImportColumn[] = [];
  for (let c = 0; c < width; c++) {
    const h = header[c]?.text.trim() ?? "";
    const samples = body
      .map((r) => r[c]?.text.trim() ?? "")
      .filter(Boolean)
      .slice(0, 5);
    if (!h && !samples.length && !body.some((r) => r[c]?.filled)) continue;
    columns.push({ index: c, header: h, samples, period: h ? parsePeriodHeader(h, { year: years[c], base }) : null, year: years[c] ?? null });
  }
  const periodCols = columns.filter((c) => c.period).map((c) => c.index);
  return {
    name,
    headerRow: best + 1,
    preamble: grid
      .slice(0, best)
      .map((r) => r.map((c) => c.text.trim()).filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 5),
    columns,
    rows: body.slice(0, 1500).map((r) => {
      const written = periodCols.filter((c) => Boolean(r[c]?.text.trim()));
      const shaded = periodCols.filter((c) => Boolean(r[c]?.filled));
      // A heading row shaded from end to end is decoration, not a bar.
      const fills = shaded.length === periodCols.length && periodCols.length >= 6 ? [] : shaded;
      return {
        cells: Array.from({ length: width }, (_, c) => r[c]?.text.trim() ?? ""),
        marked: periodCols.filter((c) => written.includes(c) || fills.includes(c)),
      };
    }),
  };
}

/** Read the month columns again from another start month (for M1, M2 … headers). */
export function rebaseSheet(sheet: ImportSheet, base: { year: number; month: number }): ImportSheet {
  return {
    ...sheet,
    columns: sheet.columns.map((c) => (c.period?.relative ? { ...c, period: parsePeriodHeader(c.header, { year: c.year, base }) } : c)),
  };
}

const GUESS: [ImportField, RegExp][] = [
  ["code", /^(kod|code|no|#|ref|sira|sira no|id|faaliyet no|faaliyet kodu|activity no|activity code|activity id|act no)$/],
  ["depends", /(bagli oldugu|bagimlilik|onceki|oncul|predecessor|depends|dependency)/],
  ["start", /(baslangic|baslama|start|from|begin)/],
  ["end", /(bitis|end|until|finish|son tarih|deadline)/],
  ["output", /(cikti|output|sonuc|result|bilesen|component|outcome)/],
  ["partners", /(ortak|partner|sorumlu|responsible|uygulayici|implementing|kurum|organi[sz]ation|lead|yurutucu)/],
  ["provinces", /(^il$|^iller|province|lokasyon|location|^yer$|bolge|region|city|sehir)/],
  ["status", /(durum|status)/],
  ["progress", /(ilerleme|progress|tamamlanma|yuzde|percent|%)/],
  ["title", /(faaliyet|activity|etkinlik|title|baslik|is tanimi|task|activities)/],
  ["description", /(aciklama|description|detay|detail|^not$|notlar|notes|comment|yorum|remarks)/],
];

/** A first mapping from the header words; Claude or she can change any column. */
export function guessMapping(sheet: ImportSheet): ImportMapping {
  const out: ImportMapping = {};
  const used = new Set<ImportField>();
  for (const col of sheet.columns) {
    if (col.period) {
      out[col.index] = "ignore";
      continue;
    }
    const f = foldText(col.header);
    let field: ImportField = "ignore";
    for (const [k, re] of GUESS) {
      if (used.has(k) || !re.test(f)) continue;
      // "Faaliyet no" is a code, not a title.
      if (k === "title" && /(no|kod|code|tarih|date)\b/.test(f)) continue;
      field = k;
      break;
    }
    if (field !== "ignore") used.add(field);
    out[col.index] = field;
  }
  if (!used.has("title")) {
    // The text column with the longest values is most likely the activity.
    const candidates = sheet.columns.filter((c) => !c.period && out[c.index] === "ignore" && c.samples.length);
    const longest = candidates.sort((a, b) => avgLen(b) - avgLen(a))[0];
    if (longest && avgLen(longest) > 8) out[longest.index] = "title";
  }
  return out;
}

const avgLen = (c: ImportColumn) => c.samples.reduce((n, s) => n + s.length, 0) / Math.max(1, c.samples.length);

/** "15.03.2026", "2026-03-15", an Excel serial number, "Mart 2026" or "Q2 2026" as a day. */
export function parseCellDate(text: string, side: "start" | "end", base: { year: number; month: number }): string | null {
  const t = text.trim();
  if (!t) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t))) return valid(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }
  const p = parsePeriodHeader(t, { base });
  if (p) return side === "start" ? p.from : p.to;
  return null;

  function valid(y: number, mo: number, d: number) {
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay(y, mo)) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
}

export function parseStatus(text: string): ImportedActivity["status"] {
  const f = foldText(text);
  if (!f) return null;
  if (/(tamamland|bitti|tamam|done|complet|finished|closed)/.test(f)) return "done";
  if (/(iptal|cancel|vazgec)/.test(f)) return "canceled";
  if (/(gecik|delay|late|behind|ertelen|postpon)/.test(f)) return "delayed";
  if (/(devam|ongoing|in progress|surmekte|suruyor|basladi|started|active)/.test(f)) return "ongoing";
  if (/(plan|not started|baslamadi|bekliyor|pending|upcoming)/.test(f)) return "planned";
  return null;
}

export function parseProgress(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  const pct = !t.includes("%") && n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function splitList(text: string) {
  return text
    .split(/[,;/\n&+]|\s(?:ve|and|ile)\s/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const OUTPUT_HEADING = /^(output|cikti|bilesen|component|result)\b/;
const OUTCOME_HEADING = /^(outcome|sonuc|objective|amac|hedef)\b/;

/** Code of an output from "Output 1", "Çıktı 1.2: …" or "1.2". */
export function outputCode(text: string) {
  const m = /(\d+(?:\.\d+)*)/.exec(text);
  return m ? m[1]! : null;
}

/** Turn the rows into activities (and the output headings between them) with one mapping. */
export function rowsToActivities(sheet: ImportSheet, mapping: ImportMapping, base: { year: number; month: number }) {
  const col = (field: ImportField) => Number(Object.entries(mapping).find(([, f]) => f === field)?.[0] ?? -1);
  const idx = {
    code: col("code"),
    title: col("title"),
    output: col("output"),
    partners: col("partners"),
    provinces: col("provinces"),
    start: col("start"),
    end: col("end"),
    status: col("status"),
    progress: col("progress"),
    depends: col("depends"),
    description: col("description"),
  };
  const periods = new Map(sheet.columns.filter((c) => c.period).map((c) => [c.index, c.period!]));
  const get = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
  const outputs: ImportedOutput[] = [];
  const activities: ImportedActivity[] = [];
  // "1" is a heading when other rows are numbered "1.1", "1.2" under it.
  const prefixes = new Set<string>();
  for (const r of sheet.rows) {
    const c = get(r.cells, idx.code).replace(/\.$/, "");
    for (let i = c.lastIndexOf("."); i > 0; i = c.lastIndexOf(".", i - 1)) prefixes.add(c.slice(0, i));
  }
  let section: string | null = null;
  let outcome: string | null = null;
  sheet.rows.forEach((r, n) => {
    const code = get(r.cells, idx.code).replace(/\.$/, "");
    const title = get(r.cells, idx.title);
    if (!code && !title) return;
    const marks = r.marked.filter((c) => periods.has(c)).map((c) => periods.get(c)!);
    let start = parseCellDate(get(r.cells, idx.start), "start", base);
    let end = parseCellDate(get(r.cells, idx.end), "end", base);
    if (!start && marks.length) start = marks.map((p) => p.from).sort()[0]!;
    if (!end && marks.length) end = marks.map((p) => p.to).sort().at(-1)!;
    const dated = Boolean(start || end);
    const lead = foldText(title || code);
    const isOutcome = !dated && (OUTCOME_HEADING.test(lead) || OUTCOME_HEADING.test(foldText(code)));
    const isOutput = !dated && !isOutcome && (OUTPUT_HEADING.test(lead) || OUTPUT_HEADING.test(foldText(code)) || prefixes.has(code));
    if (isOutcome || isOutput) {
      const oc = outputCode(code) ?? outputCode(title) ?? String(outputs.length + 1);
      const label = title.replace(/^\s*(output|çıktı|cikti|sonuç|sonuc|outcome|objective|amaç|hedef|bileşen|component|result)\s*\d*(?:\.\d+)*\s*[:.\-–]?\s*/i, "").trim() || title || code;
      outputs.push({ code: oc, title: label.slice(0, 500), level: isOutcome ? "outcome" : "output", parent: isOutcome ? null : outcome });
      if (isOutcome) outcome = oc;
      section = oc;
      return;
    }
    if (end && start && end < start) [start, end] = [end, start];
    activities.push({
      row: sheet.headerRow + n + 1,
      code: (code || `A${activities.length + 1}`).slice(0, 30),
      title: (title || code).slice(0, 300),
      description: get(r.cells, idx.description) || null,
      start,
      end,
      status: parseStatus(get(r.cells, idx.status)),
      progress: parseProgress(get(r.cells, idx.progress)),
      partners: splitList(get(r.cells, idx.partners)),
      provinces: splitList(get(r.cells, idx.provinces)),
      depends: splitList(get(r.cells, idx.depends)).map((d) => d.replace(/\.$/, "")),
      output: get(r.cells, idx.output) || null,
      section,
    });
  });
  return { outputs, activities };
}

/** Partner names in a cell matched to organisations by short name or name. */
export function matchOrgs(names: string[], orgs: { id: string; name: string; shortName: string | null }[]) {
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const raw of names) {
    const f = foldText(raw);
    if (!f) continue;
    const hit =
      orgs.find((o) => foldText(o.shortName) === f || foldText(o.name) === f) ??
      orgs.find((o) => (o.shortName && f.split(" ").includes(foldText(o.shortName))) || foldText(o.name).includes(f) || f.includes(foldText(o.name)));
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else unmatched.push(raw);
  }
  return { ids, unmatched };
}

/** Province names spelled any way ("SANLIURFA", "Sanliurfa") as their proper names. */
export function matchProvinces(names: string[]) {
  const out: string[] = [];
  for (const raw of names) {
    const f = foldText(raw);
    if (!f) continue;
    const hit = PROVINCES.find((p) => foldText(p) === f);
    const value = hit ?? (raw.length <= 40 ? raw : null);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Headers of a sheet as one key, to remember her mapping for the next file of the same shape. */
export function headerSignature(sheet: ImportSheet) {
  return foldText(sheet.columns.filter((c) => !c.period).map((c) => c.header).join("|")).slice(0, 300);
}
