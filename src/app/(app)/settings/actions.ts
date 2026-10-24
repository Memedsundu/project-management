"use server";

import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { slugify } from "@/lib/utils";
import { act, UserError } from "@/server/action";
import { MODELS, HELPERS, type HelperKey } from "@/server/ai/models";
import { deletePasskey, renamePasskey, revokeOtherSessions, revokeSession } from "@/server/auth/account";
import { AuthError, beginAddPasskey, createPairingCode, finishAddPasskey, regenerateRecoveryCodes } from "@/server/auth/webauthn";
import { getDb } from "@/server/db/client";
import { documents, taggings, tags, templates } from "@/server/db/schema";
import { isEntityType } from "@/server/entities";
import { listDocTypes, saveDocTypes } from "@/server/services/documents";
import { reindexEntity } from "@/server/services/reindex";
import { getSetting, patchSetting } from "@/server/services/settings";
import { deleteTag, mergeTags, renameTag } from "@/server/services/tags";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const profileSchema = z
  .object({
    appName: z.string().trim().min(1).max(40),
    projectName: z.string().trim().min(1).max(200),
    projectCode: z.string().trim().max(60),
    donor: z.string().trim().max(120),
    startYear: z.number().int().min(2000).max(2100),
    endYear: z.number().int().min(2000).max(2100),
    reportSpelling: z.enum(["en-GB", "en-US"]),
  })
  .refine((p) => p.endYear >= p.startYear && p.endYear - p.startYear <= 15, { message: "years" });

export async function saveProfileAction(raw: z.input<typeof profileSchema>) {
  return act(async () => {
    const parsed = profileSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.message === "years")) throw new UserError("Bitiş yılı başlangıçtan önce olamaz.");
      throw parsed.error;
    }
    await patchSetting("profile", parsed.data);
    return null;
  });
}

const hoursSchema = z
  .object({ start: time, end: time, days: z.array(z.number().int().min(1).max(7)).min(1).max(7) })
  .refine((h) => h.start < h.end, { message: "order" });

export async function saveWorkingHoursAction(raw: z.input<typeof hoursSchema>) {
  return act(async () => {
    const parsed = hoursSchema.safeParse(raw);
    if (!parsed.success) throw new UserError("Bitiş saati başlangıçtan sonra olmalı ve en az bir gün seçili olmalı.");
    await patchSetting("workingHours", { ...parsed.data, days: [...new Set(parsed.data.days)].sort() });
    return null;
  });
}

const notificationsSchema = z
  .object({ quietStart: time, quietEnd: time, taskReminders: z.boolean(), meetingReminders: z.boolean(), briefReady: z.boolean(), lateReports: z.boolean() })
  .partial();

/** Notification settings change in archive mode too: they are not project data. */
export async function saveNotificationsAction(raw: z.input<typeof notificationsSchema>) {
  return act(
    async () => {
      await patchSetting("notifications", notificationsSchema.parse(raw));
      return null;
    },
    { write: false },
  );
}

const aiSchema = z
  .object({
    enabled: z.boolean(),
    monthlyCapUsd: z.number().min(0).max(1000),
    models: z.record(z.string(), z.enum(Object.values(MODELS) as [string, ...string[]])),
  })
  .partial();

export async function saveAiAction(raw: z.input<typeof aiSchema>) {
  return act(async () => {
    const input = aiSchema.parse(raw);
    const patch: Parameters<typeof patchSetting<"ai">>[1] = {};
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.monthlyCapUsd !== undefined) patch.monthlyCapUsd = Math.round(input.monthlyCapUsd * 100) / 100;
    if (input.models) {
      // Keep only the helpers she moved away from their default model.
      const current = (await getSetting("ai")).models;
      const next: Record<string, string> = { ...current };
      for (const [key, model] of Object.entries(input.models)) {
        if (!(key in HELPERS)) continue;
        if (HELPERS[key as HelperKey].model === model) delete next[key];
        else next[key] = model;
      }
      patch.models = next;
    }
    await patchSetting("ai", patch);
    return null;
  });
}

const filesSchema = z.object({ namingRule: z.string().trim().max(200), applyNamingRule: z.boolean() }).partial();

export async function saveFilesAction(raw: z.input<typeof filesSchema>) {
  return act(async () => {
    await patchSetting("files", filesSchema.parse(raw));
    return null;
  });
}

/* --------------------------------- Lists --------------------------------- */

const docTypeSchema = z.object({
  key: z.string().max(60).nullish(),
  tr: z.string().trim().min(1).max(80),
  en: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
});

/**
 * Save the file types. Files of a type she removed move to the type she
 * picked for them (`moveTo`), or have no type.
 */
export async function saveDocTypesAction(list: z.input<typeof docTypeSchema>[], moveTo: Record<string, string | null> = {}) {
  return act(async () => {
    const items = z.array(docTypeSchema).min(1).max(60).parse(list);
    const used = new Set<string>();
    const clean = items.map((d) => {
      let key = d.key || slugify(d.en || d.tr).replace(/-/g, "_") || "type";
      while (used.has(key)) key = `${key}_2`;
      used.add(key);
      return { key, tr: d.tr, en: d.en, description: d.description };
    });
    const before = await listDocTypes();
    const removed = before.map((d) => d.key).filter((k) => !used.has(k));
    const db = await getDb();
    for (const key of removed) {
      const target = moveTo[key] && used.has(moveTo[key]!) ? moveTo[key]! : null;
      await db.update(documents).set({ docType: target }).where(eq(documents.docType, key));
    }
    await saveDocTypes(clean);
    return { removed: removed.length };
  });
}

async function reindexTagged(tagId: string) {
  const db = await getDb();
  const rows = await db.select({ type: taggings.entityType, id: taggings.entityId }).from(taggings).where(eq(taggings.tagId, tagId));
  for (const r of rows) if (isEntityType(r.type)) await reindexEntity(r.type, r.id);
}

/** Renaming a tag to the name of another tag merges the two. */
export async function renameTagAction(id: string, name: string) {
  return act(async () => {
    const tagId = z.string().uuid().parse(id);
    const clean = z.string().trim().min(1).max(61).parse(name).replace(/^#/, "").slice(0, 60);
    if (!clean) throw new UserError("Etiketin bir adı olmalı.");
    const db = await getDb();
    const [other] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slugify(clean)));
    if (other && other.id !== tagId) {
      await mergeTags(tagId, other.id);
      await reindexTagged(other.id);
      return { mergedInto: other.name };
    }
    await renameTag(tagId, clean);
    await reindexTagged(tagId);
    return { mergedInto: null };
  });
}

export async function mergeTagsAction(fromId: string, intoId: string) {
  return act(async () => {
    const [from, into] = [z.string().uuid().parse(fromId), z.string().uuid().parse(intoId)];
    if (from === into) return null;
    await mergeTags(from, into);
    await reindexTagged(into);
    return null;
  });
}

export async function deleteTagAction(id: string) {
  return act(async () => {
    const tagId = z.string().uuid().parse(id);
    const db = await getDb();
    const rows = await db.select({ type: taggings.entityType, id: taggings.entityId }).from(taggings).where(eq(taggings.tagId, tagId));
    await deleteTag(tagId);
    for (const r of rows) if (isEntityType(r.type)) await reindexEntity(r.type, r.id);
    return null;
  });
}

export async function renameTemplateAction(id: string, input: { name: string; description?: string | null }) {
  return act(async () => {
    const templateId = z.string().uuid().parse(id);
    const name = z.string().trim().min(1).max(120).parse(input.name);
    const description = z.string().trim().max(400).nullish().parse(input.description) || null;
    const db = await getDb();
    await db.update(templates).set({ name, description, updatedAt: new Date() }).where(eq(templates.id, templateId));
    return null;
  });
}

/* -------------------------------- Account -------------------------------- */

/** Account actions work in an archived project too: they are not project data. */
const account = { write: false } as const;
const accountChange = { write: false, refresh: true } as const;

function authError(e: unknown): never {
  if (e instanceof AuthError) throw new UserError(e.code === "challenge" ? "Oturum süresi doldu. Tekrar dene." : "Passkey doğrulanamadı. Tekrar dener misin?");
  throw e;
}

export async function startAddPasskeyAction() {
  return act(() => beginAddPasskey().catch(authError), account);
}

export async function finishAddPasskeyAction(response: RegistrationResponseJSON, name?: string) {
  return act(async () => {
    await finishAddPasskey(response, z.string().trim().max(60).optional().parse(name)).catch(authError);
    return null;
  }, accountChange);
}

export async function renamePasskeyAction(id: string, name: string) {
  return act(async (user) => {
    await renamePasskey(user, z.string().min(1).max(1000).parse(id), name);
    return null;
  }, accountChange);
}

export async function deletePasskeyAction(id: string) {
  return act(async (user) => {
    await deletePasskey(user, z.string().min(1).max(1000).parse(id));
    return null;
  }, accountChange);
}

export async function newRecoveryCodesAction() {
  return act(async () => ({ codes: await regenerateRecoveryCodes() }), accountChange);
}

export async function pairingCodeAction() {
  return act(() => createPairingCode(), account);
}

export async function signOutSessionAction(id: string) {
  return act(async (user) => {
    await revokeSession(user, z.string().uuid().parse(id));
    return null;
  }, accountChange);
}

export async function signOutOtherSessionsAction() {
  return act(async (user) => ({ count: await revokeOtherSessions(user) }), accountChange);
}

