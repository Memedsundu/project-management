import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { appSettings } from "@/server/db/schema";

/** Every setting has a schema and a default, so missing or old values never break a screen. */
export const SETTINGS = {
  profile: z
    .object({
      appName: z.string().default("[uygulama]"),
      projectName: z.string().default("[Proje adı]"),
      projectCode: z.string().default(""),
      donor: z.string().default(""),
      startYear: z.number().int().default(2026),
      endYear: z.number().int().default(2029),
      reportSpelling: z.enum(["en-GB", "en-US"]).default("en-GB"),
    })
    .default({
      appName: "[uygulama]",
      projectName: "[Proje adı]",
      projectCode: "",
      donor: "",
      startYear: 2026,
      endYear: 2029,
      reportSpelling: "en-GB",
    }),
  workingHours: z
    .object({
      start: z.string().default("09:00"),
      end: z.string().default("18:00"),
      days: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
    })
    .default({ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }),
  ai: z
    .object({
      enabled: z.boolean().default(true),
      monthlyCapUsd: z.number().min(0).default(20),
      models: z.record(z.string(), z.string()).default({}),
    })
    .default({ enabled: true, monthlyCapUsd: 20, models: {} }),
  files: z
    .object({
      namingRule: z.string().default(""),
      applyNamingRule: z.boolean().default(false),
    })
    .default({ namingRule: "", applyNamingRule: false }),
  notifications: z
    .object({
      quietStart: z.string().default("21:00"),
      quietEnd: z.string().default("08:00"),
      taskReminders: z.boolean().default(true),
      meetingReminders: z.boolean().default(true),
      briefReady: z.boolean().default(true),
      lateReports: z.boolean().default(true),
    })
    .default({
      quietStart: "21:00",
      quietEnd: "08:00",
      taskReminders: true,
      meetingReminders: true,
      briefReady: true,
      lateReports: true,
    }),
  /** The scheduled helpers, each one switchable (Notion Custom Agents). */
  scheduledHelpers: z
    .object({ dailyBrief: z.boolean().default(true), weeklyReview: z.boolean().default(true), partnerCheck: z.boolean().default(true) })
    .default({ dailyBrief: true, weeklyReview: true, partnerCheck: true }),
  archive: z
    .object({ readOnly: z.boolean().default(false), archivedAt: z.string().nullable().default(null) })
    .default({ readOnly: false, archivedAt: null }),
  onboarding: z
    .object({ seeded: z.boolean().default(false), dismissedTips: z.array(z.string()).default([]) })
    .default({ seeded: false, dismissedTips: [] }),
  /** Column mappings she chose for workplan files, by the shape of their headers. */
  workplanImport: z
    .object({ mappings: z.record(z.string(), z.record(z.string(), z.string())).default({}) })
    .default({ mappings: {} }),
  vapid: z
    .object({ publicKey: z.string(), privateKey: z.string() })
    .nullable()
    .default(null),
  /** A restore from a backup that started and has not finished (it can be run again). */
  restore: z
    .object({ startedAt: z.string(), exportedAt: z.string(), projectName: z.string() })
    .nullable()
    .default(null),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const db = await getDb();
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const parsed = SETTINGS[key].safeParse(row?.value ?? undefined);
  if (parsed.success) return parsed.data as SettingValue<K>;
  return SETTINGS[key].parse(undefined) as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(keys: K[]): Promise<{ [P in K]: SettingValue<P> }> {
  const db = await getDb();
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const out = {} as { [P in K]: SettingValue<P> };
  for (const key of keys) {
    const row = rows.find((r) => r.key === key);
    const parsed = SETTINGS[key].safeParse(row?.value ?? undefined);
    out[key] = (parsed.success ? parsed.data : SETTINGS[key].parse(undefined)) as SettingValue<typeof key>;
  }
  return out;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>) {
  const parsed = SETTINGS[key].parse(value);
  const db = await getDb();
  // The column cannot hold null: a cleared setting is a missing row, which reads back as null.
  if (parsed === null) {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return parsed as SettingValue<K>;
  }
  await db
    .insert(appSettings)
    .values({ key, value: parsed as object })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed as object, updatedAt: new Date() } });
  return parsed as SettingValue<K>;
}

export async function patchSetting<K extends SettingKey>(key: K, patch: Partial<NonNullable<SettingValue<K>>>) {
  const current = (await getSetting(key)) ?? {};
  return setSetting(key, { ...(current as object), ...(patch as object) } as SettingValue<K>);
}
