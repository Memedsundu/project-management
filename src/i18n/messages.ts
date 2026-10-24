export const LOCALES = ["tr", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "tr";
export const LOCALE_COOKIE = "locale";

/** One JSON file per area in messages/tr and messages/en. Keep both in step (a test checks). */
export const NAMESPACES = [
  "common",
  "nav",
  "auth",
  "settings",
  "today",
  "inbox",
  "tasks",
  "notes",
  "files",
  "meetings",
  "partners",
  "workplan",
  "indicators",
  "reports",
  "briefs",
  "collections",
  "search",
  "ai",
  "trash",
] as const;

export function normalizeLocale(value: string | undefined | null): AppLocale {
  return value === "en" ? "en" : "tr";
}

export async function loadMessages(locale: AppLocale) {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await import(`../../messages/${locale}/${ns}.json`);
      return [ns, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries);
}
