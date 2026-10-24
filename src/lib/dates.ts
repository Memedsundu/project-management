import { TZDate } from "@date-fns/tz";
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfWeek,
} from "date-fns";
import { enGB, tr } from "date-fns/locale";

/** The project runs in Türkiye; every "today" and "this week" is Istanbul time. */
export const APP_TZ = "Europe/Istanbul";

export type Locale = "tr" | "en";

export function dfLocale(locale: Locale | string) {
  return locale === "en" ? enGB : tr;
}

/** Now as a date in Istanbul time. */
export function nowTz(): TZDate {
  return new TZDate(Date.now(), APP_TZ);
}

/** "YYYY-MM-DD" for today in Istanbul. */
export function todayStr(now: Date = nowTz()): string {
  return format(new TZDate(now, APP_TZ), "yyyy-MM-dd");
}

export function toDateStr(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Parse "YYYY-MM-DD" as a calendar day (local, no time zone shift). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDaysStr(s: string, n: number): string {
  return toDateStr(addDays(parseDay(s), n));
}

export function daysBetween(fromStr: string, toStr: string): number {
  return differenceInCalendarDays(parseDay(toStr), parseDay(fromStr));
}

export function weekRange(dayStr: string): { start: string; end: string } {
  const d = parseDay(dayStr);
  return {
    start: toDateStr(startOfWeek(d, { weekStartsOn: 1 })),
    end: toDateStr(endOfWeek(d, { weekStartsOn: 1 })),
  };
}

export function isDateStr(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseISO(s));
}

/** "Cuma, 24 Ekim" / "Friday, 24 October". */
export function formatLongDay(dayStr: string, locale: Locale | string) {
  return format(parseDay(dayStr), "EEEE, d MMMM", { locale: dfLocale(locale) });
}

export function formatDay(dayStr: string, locale: Locale | string, withYear = false) {
  return format(parseDay(dayStr), withYear ? "d MMM yyyy" : "d MMM", { locale: dfLocale(locale) });
}

export function formatDateTime(value: Date | string, locale: Locale | string) {
  const d = new TZDate(typeof value === "string" ? new Date(value) : value, APP_TZ);
  return format(d, "d MMM yyyy, HH:mm", { locale: dfLocale(locale) });
}

export function formatTime(value: Date | string) {
  const d = new TZDate(typeof value === "string" ? new Date(value) : value, APP_TZ);
  return format(d, "HH:mm");
}

/** Istanbul calendar day of an instant. */
export function dayOf(value: Date | string): string {
  const d = new TZDate(typeof value === "string" ? new Date(value) : value, APP_TZ);
  return format(d, "yyyy-MM-dd");
}

/** Build an instant from an Istanbul calendar day and "HH:mm". */
export function istanbulInstant(dayStr: string, time = "09:00"): Date {
  const [y, m, d] = dayStr.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh || 0, mm || 0, 0, 0, APP_TZ).getTime());
}

/** Short relative label: "Bugün", "Yarın", "Dün", or a date. */
export function relativeDayLabel(dayStr: string, locale: Locale | string, today = todayStr()) {
  const diff = daysBetween(today, dayStr);
  const tr = locale !== "en";
  if (diff === 0) return tr ? "Bugün" : "Today";
  if (diff === 1) return tr ? "Yarın" : "Tomorrow";
  if (diff === -1) return tr ? "Dün" : "Yesterday";
  if (diff > 1 && diff < 7) return format(parseDay(dayStr), "EEEE", { locale: dfLocale(locale) });
  return formatDay(dayStr, locale, parseDay(dayStr).getFullYear() !== parseDay(today).getFullYear());
}
