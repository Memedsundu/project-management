/**
 * Zod 4 fills defaults inside `.partial()`, so a patch that names one field
 * would reset every other field that has a default. Keep only what was sent.
 */
export function onlyGiven<T extends Record<string, unknown>>(raw: unknown, parsed: T): T {
  if (!raw || typeof raw !== "object") return parsed;
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.prototype.hasOwnProperty.call(raw, k))) as T;
}
