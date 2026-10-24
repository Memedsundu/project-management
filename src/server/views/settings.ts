import "server-only";
import { and, count, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { todayStr } from "@/lib/dates";
import { aiStatus, monthStart } from "@/server/ai/client";
import { HELPERS, MODELS, type HelperKey } from "@/server/ai/models";
import { listPasskeys, listSessions } from "@/server/auth/account";
import { remainingRecoveryCodes } from "@/server/auth/webauthn";
import type { CurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { aiRuns, documents, folders } from "@/server/db/schema";
import { countSubscriptions } from "@/server/notifications/push";
import { listDocTypes } from "@/server/services/documents";
import { ensureProjectPeriods, ipttTable, listPeriods } from "@/server/services/indicators";
import { getSettings } from "@/server/services/settings";
import { listTags } from "@/server/services/tags";
import { listTemplates } from "@/server/services/templates";
import { listTrash } from "@/server/services/trash";
import { listHolidays, listSeasons } from "@/server/services/workplan";

async function aiSpendByHelper() {
  const db = await getDb();
  const rows = await db
    .select({ helper: aiRuns.helper, usd: sql<string>`coalesce(sum(${aiRuns.costUsd}), 0)`, runs: count() })
    .from(aiRuns)
    .where(gte(aiRuns.createdAt, monthStart()))
    .groupBy(aiRuns.helper)
    .orderBy(desc(sql`sum(${aiRuns.costUsd})`));
  return rows.map((r) => ({ helper: r.helper, usd: Number(r.usd), runs: Number(r.runs) }));
}

async function docTypeUsage() {
  const db = await getDb();
  const rows = await db
    .select({ key: documents.docType, n: count() })
    .from(documents)
    .where(and(isNull(documents.deletedAt), isNotNull(documents.docType)))
    .groupBy(documents.docType);
  return Object.fromEntries(rows.map((r) => [r.key!, Number(r.n)]));
}

async function aiOffPlaces() {
  const db = await getDb();
  const [folderRows, [docs]] = await Promise.all([
    db.select({ id: folders.id, name: folders.name }).from(folders).where(and(eq(folders.aiOff, true), isNull(folders.deletedAt))).orderBy(folders.name),
    db.select({ n: count() }).from(documents).where(and(eq(documents.aiOff, true), isNull(documents.deletedAt))),
  ]);
  return { folders: folderRows.map((f) => ({ id: f.id, name: f.name, href: `/files/f/${f.id}` })), documents: Number(docs?.n ?? 0) };
}

/** Ayarlar: everything the settings page shows, in one load. */
export async function loadSettings(user: CurrentUser) {
  await ensureProjectPeriods();
  const today = todayStr();
  const settings = await getSettings(["profile", "workingHours", "notifications", "ai", "files", "archive"]);
  const from = `${settings.profile.startYear}-01-01`;
  const to = `${settings.profile.endYear}-12-31`;
  const [ai, spend, docTypes, usage, tags, seasons, holidays, periods, table, templates, aiOff, passkeys, sessions, recoveryLeft, devices, trash] = await Promise.all([
    aiStatus(),
    aiSpendByHelper(),
    listDocTypes(),
    docTypeUsage(),
    listTags(),
    listSeasons(),
    listHolidays(from, to),
    listPeriods(),
    ipttTable({ today }),
    listTemplates(),
    aiOffPlaces(),
    listPasskeys(user),
    listSessions(user),
    remainingRecoveryCodes(),
    countSubscriptions(),
    listTrash().then((items) => items.length),
  ]);
  return {
    today,
    userName: user.name,
    readOnly: settings.archive.readOnly,
    profile: settings.profile,
    workingHours: settings.workingHours,
    notifications: settings.notifications,
    files: settings.files,
    devices,
    ai: {
      configured: ai.configured,
      enabled: settings.ai.enabled,
      capUsd: settings.ai.monthlyCapUsd,
      spentUsd: ai.spentUsd,
      byHelper: spend.map((s) => ({ ...s, labelTr: HELPERS[s.helper as HelperKey]?.labelTr ?? s.helper, labelEn: HELPERS[s.helper as HelperKey]?.labelEn ?? s.helper })),
      helpers: (Object.entries(HELPERS) as [HelperKey, (typeof HELPERS)[HelperKey]][]).map(([key, h]) => ({
        key,
        labelTr: h.labelTr,
        labelEn: h.labelEn,
        model: settings.ai.models[key] || h.model,
        defaultModel: h.model,
      })),
      models: Object.values(MODELS) as string[],
      aiOff,
    },
    docTypes: docTypes.map((d) => ({ ...d, used: usage[d.key] ?? 0 })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug, count: t.count ?? 0 })),
    seasons: seasons.map((s) => ({ id: s.id, name: s.name, crop: s.crop, provinces: s.provinces, startMonth: s.startMonth, startDay: s.startDay, endMonth: s.endMonth, endDay: s.endDay, active: s.active })),
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, nameTr: h.nameTr, nameEn: h.nameEn, kind: h.kind, halfDay: h.halfDay })),
    periods: periods.map((p) => ({ id: p.id, label: p.label, kind: p.kind, startDate: p.startDate, endDate: p.endDate })),
    periodsLocked: table.rows.some((r) => r.cells.some((c) => c.actual !== null || c.proposed > 0)),
    templates: templates.map((t) => ({ id: t.id, kind: t.kind, name: t.name, description: t.description ?? null, builtin: t.builtin })),
    account: { passkeys, sessions, recoveryLeft },
    trash,
  };
}

export type SettingsData = Awaited<ReturnType<typeof loadSettings>>;
