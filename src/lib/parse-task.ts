import { rrulestr } from "rrule";
import { addDaysStr, parseDay, toDateStr } from "./dates";

/**
 * Quick add, Todoist style, in Turkish and English:
 * "cuma 14:00 Ortak A ile bütçe #rapor p2" becomes a task on Friday at 14:00,
 * priority 2, tagged rapor and linked to Ortak A. Everything runs locally and
 * instantly; Claude is only asked about phrases these rules do not know.
 */

export type PartnerRef = { id: string; name: string; shortName?: string | null };

export type TokenKind = "date" | "start" | "time" | "priority" | "tag" | "partner" | "owner" | "recurrence" | "estimate";

export type ParsedTask = {
  title: string;
  startDate: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: number | null;
  tags: string[];
  orgId: string | null;
  ownerOrgId: string | null;
  ownerName: string | null;
  recurrence: string | null;
  recurrenceLabel: string | null;
  estimateMin: number | null;
  tokens: { kind: TokenKind; text: string; value: string }[];
};

/** Lower case and Turkish letters to ASCII, one character for one character. */
export function foldSameLength(s: string) {
  let out = "";
  for (const ch of s) {
    const lower = ch.toLocaleLowerCase("tr-TR");
    const c = lower.length === 1 ? lower : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
    out +=
      { ı: "i", ğ: "g", ü: "u", ş: "s", ö: "o", ç: "c", â: "a", î: "i", û: "u", "’": "'", "`": "'" }[c] ?? (c.length === ch.length ? c : ch);
  }
  return out;
}

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";

const WEEKDAYS: [string, number][] = [
  ["pazartesi", 1], ["cumartesi", 6], ["carsamba", 3], ["persembe", 4], ["pazar", 0], ["cuma", 5], ["sali", 2],
  ["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6], ["sunday", 0],
];
const WD = WEEKDAYS.map(([w]) => w).join("|");
const WD_SUFFIX = "(?:'?(?:ya|ye|a|e|ndan|nden|dan|den|si|i|u))?(?:\\s+gunu(?:ne|nde)?)?";
const RRULE_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const MONTHS: [string, number][] = [
  ["ocak", 1], ["subat", 2], ["mart", 3], ["nisan", 4], ["mayis", 5], ["haziran", 6], ["temmuz", 7], ["agustos", 8], ["eylul", 9], ["ekim", 10], ["kasim", 11], ["aralik", 12],
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6], ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["jun", 6], ["jul", 7], ["aug", 8], ["sept", 9], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
];
const MO = MONTHS.map(([m]) => m).join("|");
const MO_SUFFIX = "(?:'?(?:ta|da|a|e|i|in|nda|nde))?";

const ORDINALS: Record<string, number> = {
  ilk: 1, birinci: 1, first: 1, "1": 1,
  ikinci: 2, second: 2, "2": 2,
  ucuncu: 3, third: 3, "3": 3,
  dorduncu: 4, fourth: 4, "4": 4,
  son: -1, last: -1,
};

function weekdayNumber(word: string) {
  return WEEKDAYS.find(([w]) => word.startsWith(w))?.[1] ?? null;
}
function monthNumber(word: string) {
  // Longest name first so "mart" is not read as "mar".
  return [...MONTHS].sort((a, b) => b[0].length - a[0].length).find(([m]) => word.startsWith(m))?.[1] ?? null;
}

function dow(day: string) {
  return parseDay(day).getDay();
}

function nextWeekday(today: string, target: number, includeToday = true) {
  let diff = (target - dow(today) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDaysStr(today, diff);
}

function mondayOfNextWeek(today: string) {
  const d = dow(today);
  return addDaysStr(today, d === 0 ? 1 : 8 - d);
}

function lastDayOfMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function makeDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > lastDayOfMonth(y, m)) return null;
  return toDateStr(new Date(y, m - 1, d));
}

/** A day of month, this month if still ahead, otherwise next month. */
function upcomingMonthDay(today: string, day: number) {
  const t = parseDay(today);
  let y = t.getFullYear();
  let m = t.getMonth() + 1;
  if (day < t.getDate()) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return makeDate(y, m, Math.min(day, lastDayOfMonth(y, m)));
}

/** A calendar date without a year: this year, or next year if it already passed. */
function upcomingDate(today: string, month: number, day: number, year?: number) {
  const t = parseDay(today);
  if (year) return makeDate(year < 100 ? 2000 + year : year, month, day);
  const thisYear = makeDate(t.getFullYear(), month, day);
  if (thisYear && thisYear >= today) return thisYear;
  return makeDate(t.getFullYear() + 1, month, day);
}

type Span = { start: number; end: number };

type DateMatch = { date: string; start: number; end: number };

/** Find the first date phrase in folded text, skipping consumed spans. */
function findDate(f: string, today: string, taken: Span[], from = 0): DateMatch | null {
  const free = (s: number, e: number) => !taken.some((t) => s < t.end && e > t.start);
  const candidates: DateMatch[] = [];
  const push = (m: RegExpExecArray, date: string | null) => {
    if (!date) return;
    const start = m.index;
    const end = m.index + m[0].length;
    if (start >= from && free(start, end)) candidates.push({ date, start, end });
  };
  const run = (pattern: string, fn: (m: RegExpExecArray) => string | null) => {
    const re = new RegExp(pattern, "gu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(f))) push(m, fn(m));
  };
  const t = parseDay(today);

  run(`${L}(bugun|today)${R}`, () => today);
  run(`${L}(yarindan sonra|obur gun|oburgun|day after tomorrow)${R}`, () => addDaysStr(today, 2));
  run(`${L}(yarin|tomorrow)${R}`, () => addDaysStr(today, 1));
  run(`${L}(haftaya|gelecek hafta|onumuzdeki hafta|next week)(?:\\s+(${WD})${WD_SUFFIX})?${R}`, (m) => {
    const monday = mondayOfNextWeek(today);
    if (m[2]) {
      const wd = weekdayNumber(m[2])!;
      return addDaysStr(monday, (wd + 6) % 7);
    }
    return m[1] === "haftaya" ? addDaysStr(today, 7) : monday;
  });
  run(`${L}(?:next|gelecek|onumuzdeki)\\s+(${WD})${WD_SUFFIX}${R}`, (m) => nextWeekday(today, weekdayNumber(m[1]!)!, false));
  run(`${L}(bu hafta|this week)${R}(?!\\s+(?:${WD}))`, () => nextWeekday(today, 5));
  run(`${L}(hafta ?sonu(?:na|nda)?|this weekend|weekend)${R}`, () => nextWeekday(today, 6));
  run(`${L}(ay ?sonu(?:na|nda)?|ayin sonu(?:na|nda)?|end of (?:the )?month)${R}`, () =>
    toDateStr(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
  );
  run(`${L}ayin\\s+(\\d{1,2})(?:'?\\p{L}*)?${R}`, (m) => upcomingMonthDay(today, Number(m[1])));
  run(`${L}(\\d{1,3})\\s*(gun|hafta|ay|days?|weeks?|months?)\\s*(sonra|icinde|later)${R}`, (m) => fromOffset(today, Number(m[1]), m[2]!));
  run(`${L}in\\s+(\\d{1,3})\\s+(days?|weeks?|months?)${R}`, (m) => fromOffset(today, Number(m[1]), m[2]!));
  run(`${L}(\\d{4})-(\\d{2})-(\\d{2})${R}`, (m) => makeDate(Number(m[1]), Number(m[2]), Number(m[3])));
  run(`${L}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${R}`, (m) => {
    const a = Number(m[1]);
    const b = Number(m[2]);
    // "14.30" and "9.00" are times, "15.11" is a date.
    if (!m[3] && f[m.index + m[1]!.length] === "." && a <= 23 && (b >= 13 || ["00", "15", "30", "45"].includes(m[2]!))) return null;
    return upcomingDate(today, b, a, m[3] ? Number(m[3]) : undefined);
  });
  run(`${L}(\\d{1,2})\\s+(${MO})${MO_SUFFIX}(?:\\s+(\\d{4}))?${R}`, (m) => upcomingDate(today, monthNumber(m[2]!)!, Number(m[1]), m[3] ? Number(m[3]) : undefined));
  run(`${L}(${MO})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}`, (m) => upcomingDate(today, monthNumber(m[1]!)!, Number(m[2]), m[3] ? Number(m[3]) : undefined));
  run(`${L}(${WD})${WD_SUFFIX}${R}`, (m) => nextWeekday(today, weekdayNumber(m[1]!)!));

  if (!candidates.length) return null;
  // The earliest phrase wins; at the same place, the longest.
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  return candidates[0]!;
}

function fromOffset(today: string, n: number, unit: string) {
  if (unit.startsWith("gun") || unit.startsWith("day")) return addDaysStr(today, n);
  if (unit.startsWith("hafta") || unit.startsWith("week")) return addDaysStr(today, n * 7);
  const t = parseDay(today);
  const target = new Date(t.getFullYear(), t.getMonth() + n, 1);
  const day = Math.min(t.getDate(), lastDayOfMonth(target.getFullYear(), target.getMonth() + 1));
  return toDateStr(new Date(target.getFullYear(), target.getMonth(), day));
}

type Recurrence = { rule: string; start: number; end: number };

function findRecurrence(f: string, today: string): Recurrence | null {
  const t = parseDay(today);
  const todayDay = RRULE_DAY[t.getDay()];
  const tries: [string, (m: RegExpExecArray) => string | null][] = [
    [`${L}(?:her|every)\\s+(?:is gunu|weekday)${R}|${L}hafta ?ici her gun${R}`, () => "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    [`${L}(?:her ?gun|every ?day|daily)${R}`, () => "FREQ=DAILY"],
    [`${L}(?:her|every)\\s+(\\d+)\\s+(?:haftada bir|hafta|weeks)${R}`, (m) => `FREQ=WEEKLY;INTERVAL=${m[1]};BYDAY=${todayDay}`],
    [`${L}(?:her|every)\\s+(\\d+)\\s+(?:ayda bir|ay|months)${R}`, (m) => `FREQ=MONTHLY;INTERVAL=${m[1]};BYMONTHDAY=${t.getDate()}`],
    [
      `${L}(?:her\\s+ceyregin|every quarter on the|(?=\\w+\\s+\\w+\\s+of every quarter))\\s*(ilk|son|first|last)\\s+(${WD})\\p{L}*(?:\\s+gunu)?(?:\\s+of every quarter)?${R}`,
      (m) => {
        const ord = ORDINALS[m[1]!]!;
        const day = RRULE_DAY[weekdayNumber(m[2]!)!];
        return ord === -1 ? `FREQ=YEARLY;BYMONTH=3,6,9,12;BYDAY=-1${day}` : `FREQ=YEARLY;BYMONTH=1,4,7,10;BYDAY=+1${day}`;
      },
    ],
    [`${L}(?:her\\s+ceyregin\\s+son\\s+gunu|last day of every quarter)${R}`, () => "FREQ=YEARLY;BYMONTH=3,6,9,12;BYMONTHDAY=-1"],
    [`${L}(?:her\\s+ceyrek|every quarter|quarterly)${R}`, () => `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${t.getDate()}`],
    [`${L}(?:her\\s+ayin\\s+son\\s+gunu|last day of every month|every month on the last day)${R}`, () => "FREQ=MONTHLY;BYMONTHDAY=-1"],
    [
      `${L}(?:her\\s+ayin|every)\\s+(ilk|birinci|ikinci|ucuncu|dorduncu|son|first|second|third|fourth|last)\\s+(${WD})\\p{L}*(?:\\s+gunu)?(?:\\s+of (?:the|every) month)?${R}`,
      (m) => `FREQ=MONTHLY;BYDAY=${ORDINALS[m[1]!]! > 0 ? "+" : ""}${ORDINALS[m[1]!]}${RRULE_DAY[weekdayNumber(m[2]!)!]}`,
    ],
    [`${L}(?:her\\s+ayin)\\s+(\\d{1,2})(?:'?\\p{L}*)?${R}`, (m) => `FREQ=MONTHLY;BYMONTHDAY=${Number(m[1])}`],
    [`${L}every month on the\\s+(\\d{1,2})(?:st|nd|rd|th)?${R}`, (m) => `FREQ=MONTHLY;BYMONTHDAY=${Number(m[1])}`],
    [`${L}(\\d{1,2})(?:st|nd|rd|th)? of every month${R}`, (m) => `FREQ=MONTHLY;BYMONTHDAY=${Number(m[1])}`],
    [`${L}(?:her\\s+ay|every month|monthly)${R}`, () => `FREQ=MONTHLY;BYMONTHDAY=${t.getDate()}`],
    [`${L}(?:her|every)\\s+(${WD})\\p{L}*${R}`, (m) => `FREQ=WEEKLY;BYDAY=${RRULE_DAY[weekdayNumber(m[1]!)!]}`],
    [`${L}(?:her\\s+hafta|every week|weekly)${R}`, () => `FREQ=WEEKLY;BYDAY=${todayDay}`],
    [`${L}(?:her\\s+yil|every year|yearly|annually)${R}`, () => `FREQ=YEARLY;BYMONTH=${t.getMonth() + 1};BYMONTHDAY=${t.getDate()}`],
  ];
  for (const [pattern, fn] of tries) {
    const m = new RegExp(pattern, "u").exec(f);
    if (m) {
      const rule = fn(m);
      if (rule) return { rule, start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

/** The first occurrence of a rule on or after a day (days are compared as UTC midnights). */
export function nextOccurrence(rule: string, fromDay: string, inclusive = true): string | null {
  try {
    const start = fromDay.replace(/-/g, "");
    const r = rrulestr(`DTSTART:${start}T000000Z\nRRULE:${rule}`);
    const [y, m, d] = fromDay.split("-").map(Number);
    const next = r.after(new Date(Date.UTC(y!, m! - 1, d!)), inclusive);
    if (!next) return null;
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  } catch {
    return null;
  }
}

function matchPartner(foldedWords: string, partners: PartnerRef[]) {
  const norm = (s: string) => foldSameLength(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const p of partners) {
    for (const name of [p.name, p.shortName].filter(Boolean) as string[]) {
      const n = norm(name);
      if (n && (foldedWords === n || foldedWords.replace(/\s+/g, "") === n.replace(/\s+/g, ""))) return p;
    }
  }
  return null;
}

export function parseTaskInput(text: string, opts: { today: string; partners?: PartnerRef[] }): ParsedTask {
  const today = opts.today;
  const partners = opts.partners ?? [];
  const f = foldSameLength(text);
  const taken: Span[] = [];
  const tokens: ParsedTask["tokens"] = [];
  const out: ParsedTask = {
    title: text,
    startDate: null,
    dueDate: null,
    dueTime: null,
    priority: null,
    tags: [],
    orgId: null,
    ownerOrgId: null,
    ownerName: null,
    recurrence: null,
    recurrenceLabel: null,
    estimateMin: null,
    tokens,
  };
  const take = (start: number, end: number, kind: TokenKind, value: string) => {
    taken.push({ start, end });
    tokens.push({ kind, text: text.slice(start, end).trim(), value });
  };
  const free = (s: number, e: number) => !taken.some((t) => s < t.end && e > t.start);

  // #tags
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const start = m.index! + m[1]!.length;
    take(start, start + m[2]!.length + 1, "tag", m[2]!);
    out.tags.push(m[2]!);
  }

  // Priority: p1–p4, !1–!3
  {
    const m = new RegExp(`${L}(p([1-4])|!([1-3]))${R}`, "u").exec(f);
    if (m && free(m.index, m.index + m[0].length)) {
      out.priority = Number(m[2] ?? m[3]);
      take(m.index, m.index + m[0].length, "priority", `p${out.priority}`);
    }
  }

  // +Owner: a partner or a person she waits on
  for (const m of text.matchAll(/(^|\s)\+([\p{L}\p{N}.'’-]+(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}.'’-]*)?)/gu)) {
    const start = m.index! + m[1]!.length;
    const raw = m[2]!;
    const words = foldSameLength(raw).replace(/'.*$/u, "");
    const two = matchPartner(words, partners);
    const one = two ?? matchPartner(words.split(/\s+/)[0]!, partners);
    if (one) {
      const used = two ? raw : raw.split(/\s+/)[0]!;
      out.ownerOrgId = one.id;
      take(start, start + used.length + 1, "owner", one.shortName || one.name);
    } else {
      const first = raw.split(/\s+/)[0]!.replace(/'.*$/u, "");
      out.ownerName = first;
      take(start, start + raw.split(/\s+/)[0]!.length + 1, "owner", first);
    }
    break;
  }

  // @Partner mention: link it, keep the name in the title
  for (const m of text.matchAll(/(^|\s)@([\p{L}\p{N}.'’-]+(?:\s+[\p{Lu}\p{N}][\p{L}\p{N}-]*)?)/gu)) {
    const raw = m[2]!;
    const words = foldSameLength(raw).replace(/'.*$/u, "");
    const p = matchPartner(words, partners) ?? matchPartner(words.split(/\s+/)[0]!, partners);
    if (p) {
      out.orgId = p.id;
      tokens.push({ kind: "partner", text: raw, value: p.shortName || p.name });
    }
  }

  // Plain partner names in the sentence ("Ortak A ile bütçe")
  if (!out.orgId) {
    for (const p of partners) {
      for (const name of [p.name, p.shortName].filter(Boolean) as string[]) {
        const n = foldSameLength(name).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        if (!n) continue;
        const re = new RegExp(`${L}${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}${R}`, "u");
        if (re.test(f)) {
          out.orgId = p.id;
          tokens.push({ kind: "partner", text: name, value: p.shortName || p.name });
          break;
        }
      }
      if (out.orgId) break;
    }
  }

  // Repeat: "her ayın 5'i", "every monday"
  const rec = findRecurrence(f, today);
  if (rec && free(rec.start, rec.end)) {
    out.recurrence = rec.rule;
    out.recurrenceLabel = text.slice(rec.start, rec.end).trim();
    take(rec.start, rec.end, "recurrence", out.recurrenceLabel);
  }

  // Estimate: "30dk", "1,5 saat", "45 min"
  {
    const m = new RegExp(`${L}~?(\\d+(?:[.,]\\d+)?)\\s?(dk|dakika|min|mins|minutes|saat|sa|hours?|h)${R}`, "u").exec(f);
    if (m && free(m.index, m.index + m[0].length)) {
      const n = Number(m[1]!.replace(",", "."));
      const minutes = /^(saat|sa|hour|hours|h)$/.test(m[2]!) ? Math.round(n * 60) : Math.round(n);
      // "saat 14" is a time, not a duration: only accept the number-first form here.
      if (minutes > 0 && minutes <= 24 * 60) {
        out.estimateMin = minutes;
        take(m.index, m.index + m[0].length, "estimate", `${minutes} dk`);
      }
    }
  }

  // Start date: "başla cuma", "start monday"
  {
    const re = new RegExp(`${L}(basla|baslangic|baslama|start|starts|from)\\s*:?\\s+`, "u");
    const m = re.exec(f);
    if (m) {
      const d = findDate(f, today, taken, m.index + m[0].length);
      if (d && d.start === m.index + m[0].length) {
        out.startDate = d.date;
        take(m.index, d.end, "start", d.date);
      }
    }
  }

  // Deadline: "son tarih cuma", "due friday", or any plain date phrase
  {
    const re = new RegExp(`${L}(son tarih|son gun|deadline|due|by|en gec)\\s*:?\\s+`, "u");
    const m = re.exec(f);
    let done = false;
    if (m) {
      const d = findDate(f, today, taken, m.index + m[0].length);
      if (d && d.start === m.index + m[0].length) {
        out.dueDate = d.date;
        take(m.index, d.end, "date", d.date);
        done = true;
      }
    }
    if (!done) {
      const d = findDate(f, today, taken);
      if (d) {
        out.dueDate = d.date;
        take(d.start, d.end, "date", d.date);
      }
    }
  }

  // Time: "14:00", "saat 3'te", "14'te", "3pm"
  {
    const patterns: [string, (m: RegExpExecArray) => string | null][] = [
      [`${L}(?:saat\\s*)?(\\d{1,2}):(\\d{2})(?:'?(?:da|de|ta|te))?${R}`, (m) => hhmm(Number(m[1]), Number(m[2]))],
      [`${L}(?:saat\\s*)?(\\d{1,2})\\.(\\d{2})(?:'?(?:da|de|ta|te))?${R}`, (m) => hhmm(Number(m[1]), Number(m[2]))],
      [`${L}(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)${R}`, (m) => {
        let h = Number(m[1]) % 12;
        if (m[3] === "pm") h += 12;
        return hhmm(h, Number(m[2] ?? 0));
      }],
      [`${L}saat\\s*(\\d{1,2})(?:'?(?:da|de|ta|te))?${R}`, (m) => hhmm(afternoon(Number(m[1])), 0)],
      [`${L}(\\d{1,2})'?(?:da|de|ta|te)${R}`, (m) => (Number(m[1]) >= 7 ? hhmm(afternoon(Number(m[1])), 0) : null)],
    ];
    for (const [p, fn] of patterns) {
      const re = new RegExp(p, "gu");
      let m: RegExpExecArray | null;
      let found = false;
      while ((m = re.exec(f))) {
        if (!free(m.index, m.index + m[0].length)) continue;
        const value = fn(m);
        if (value) {
          out.dueTime = value;
          take(m.index, m.index + m[0].length, "time", value);
          found = true;
          break;
        }
      }
      if (found) break;
    }
    // A time without a date means today.
    if (out.dueTime && !out.dueDate && !out.recurrence) {
      out.dueDate = today;
    }
  }

  if (out.recurrence && !out.dueDate) {
    out.dueDate = nextOccurrence(out.recurrence, today) ?? today;
  }

  // Build the title from what is left.
  const keep: string[] = [];
  let last = 0;
  for (const span of [...taken].sort((a, b) => a.start - b.start)) {
    if (span.start > last) keep.push(text.slice(last, span.start));
    last = Math.max(last, span.end);
  }
  keep.push(text.slice(last));
  let title = keep
    .join(" ")
    .replace(/(^|\s)@(?=\p{L})/gu, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "")
    .trim();
  if (!title) title = text.trim();
  out.title = title;
  return out;
}

function hhmm(h: number, m: number) {
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "saat 3" during the working day means 15:00. */
function afternoon(h: number) {
  return h >= 1 && h <= 7 ? h + 12 : h;
}

/** Split pasted text into one task per line, dropping bullets and checkboxes. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)]|\[\s?[xX ]?\s?\])\s*/, "").trim())
    .filter((l) => l.length > 0);
}

/** Plain-language label for a rule, for task rows ("her ayın 5'i"). */
export function describeRule(rule: string, locale: "tr" | "en" = "tr"): string {
  const parts = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
  const dayNames = {
    tr: { MO: "pazartesi", TU: "salı", WE: "çarşamba", TH: "perşembe", FR: "cuma", SA: "cumartesi", SU: "pazar" },
    en: { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" },
  }[locale] as Record<string, string>;
  const tr = locale === "tr";
  const interval = Number(parts.INTERVAL ?? 1);
  if (parts.FREQ === "DAILY") return tr ? "her gün" : "every day";
  if (parts.FREQ === "WEEKLY") {
    if (parts.BYDAY === "MO,TU,WE,TH,FR") return tr ? "her iş günü" : "every weekday";
    const day = dayNames[parts.BYDAY ?? ""] ?? "";
    if (interval > 1) return tr ? `${interval} haftada bir ${day}` : `every ${interval} weeks on ${day}`;
    return tr ? `her ${day}` : `every ${day}`;
  }
  if (parts.FREQ === "MONTHLY") {
    if (parts.BYMONTHDAY === "-1") return tr ? "her ayın son günü" : "last day of every month";
    if (parts.BYDAY) {
      const m = /^([+-]?\d)([A-Z]{2})$/.exec(parts.BYDAY);
      if (m) {
        const n = Number(m[1]);
        const ordTr = n === -1 ? "son" : ["", "ilk", "ikinci", "üçüncü", "dördüncü"][n];
        const ordEn = n === -1 ? "last" : ["", "first", "second", "third", "fourth"][n];
        return tr ? `her ayın ${ordTr} ${dayNames[m[2]!]}` : `every ${ordEn} ${dayNames[m[2]!]} of the month`;
      }
    }
    if (interval === 3) return tr ? `her çeyrek, ayın ${parts.BYMONTHDAY}'i` : `every quarter on the ${parts.BYMONTHDAY}th`;
    if (interval > 1) return tr ? `${interval} ayda bir` : `every ${interval} months`;
    return tr ? `her ayın ${parts.BYMONTHDAY}'i` : `every month on day ${parts.BYMONTHDAY}`;
  }
  if (parts.FREQ === "YEARLY") {
    if (parts.BYMONTH === "3,6,9,12" && parts.BYDAY) {
      const m = /^-1([A-Z]{2})$/.exec(parts.BYDAY);
      if (m) return tr ? `her çeyreğin son ${dayNames[m[1]!]} günü` : `last ${dayNames[m[1]!]} of every quarter`;
    }
    if (parts.BYMONTH === "3,6,9,12" && parts.BYMONTHDAY === "-1") return tr ? "her çeyreğin son günü" : "last day of every quarter";
    if (parts.BYMONTH === "1,4,7,10" && parts.BYDAY) {
      const m = /^\+?1([A-Z]{2})$/.exec(parts.BYDAY);
      if (m) return tr ? `her çeyreğin ilk ${dayNames[m[1]!]} günü` : `first ${dayNames[m[1]!]} of every quarter`;
    }
    return tr ? "her yıl" : "every year";
  }
  return rule;
}
