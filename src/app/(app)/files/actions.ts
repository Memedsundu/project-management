"use server";

import { z } from "zod";
import { act, UserError } from "@/server/action";
import { setLinks } from "@/server/services/links";
import {
  createFolder,
  documentPatchSchema,
  moveDocuments,
  restoreDocumentVersion,
  updateDocument,
  updateFolder,
  type DocumentPatch,
} from "@/server/services/documents";

const uuid = z.string().uuid();

export async function createFolderAction(name: string, parentId: string | null) {
  return act(async () => {
    const row = await createFolder(name, parentId ? uuid.parse(parentId) : null);
    return { id: row.id, name: row.name };
  });
}

export async function updateFolderAction(id: string, patch: { name?: string; parentId?: string | null; aiOff?: boolean }) {
  return act(async () => {
    const parsed = z.object({ name: z.string().trim().min(1).max(200).optional(), parentId: uuid.nullish(), aiOff: z.boolean().optional() }).parse(patch);
    await updateFolder(uuid.parse(id), parsed);
    return null;
  });
}

/** Details panel edits. Partners are links, so they are set separately from the columns. */
export async function updateDocumentAction(id: string, patch: DocumentPatch & { partnerIds?: string[] }) {
  return act(async () => {
    const docId = uuid.parse(id);
    const { partnerIds, ...rest } = patch;
    if (Object.keys(rest).length) await updateDocument(docId, documentPatchSchema.parse(rest));
    if (partnerIds) {
      await setLinks({ type: "document", id: docId }, "partner", z.array(uuid).max(20).parse(partnerIds).map((o) => ({ type: "organisation" as const, id: o })));
      const { indexDocument } = await import("@/server/services/documents");
      await indexDocument(docId);
    }
    return null;
  });
}

export async function moveDocumentsAction(ids: string[], folderId: string | null) {
  return act(async () => {
    await moveDocuments(z.array(uuid).max(500).parse(ids), folderId ? uuid.parse(folderId) : null);
    return null;
  });
}

export async function starDocumentsAction(ids: string[], starred: boolean) {
  return act(async () => {
    for (const id of z.array(uuid).max(500).parse(ids)) await updateDocument(id, { starred });
    return null;
  });
}

export async function restoreDocumentVersionAction(documentId: string, versionId: string) {
  return act(async () => {
    await restoreDocumentVersion(uuid.parse(documentId), uuid.parse(versionId));
    return null;
  });
}

/** "Sorun yok": she checked the file and it holds no child data. Filing starts again. */
export async function clearChildFlagAction(documentId: string) {
  return act(async () => {
    const id = uuid.parse(documentId);
    const { getDb } = await import("@/server/db/client");
    const { documents } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!doc) throw new UserError("Belge bulunamadı.");
    await db
      .update(documents)
      .set({ childDataFlag: false, childDataReason: null, classificationStatus: "pending", meta: { ...(doc.meta as object), childDataCleared: true }, updatedAt: new Date() })
      .where(eq(documents.id, id));
    const { logActivity } = await import("@/server/services/activity");
    await logActivity({ action: "unflag", entityType: "document", entityId: id, title: doc.title });
    const { enqueue, kickJobs } = await import("@/server/jobs/queue");
    await enqueue("classify_document", { documentId: id }, { dedupeKey: `classify:${id}` });
    await kickJobs(["classify_document"]);
    const { indexDocument } = await import("@/server/services/documents");
    await indexDocument(id);
    return null;
  });
}

/** "Yeniden sınıflandır": Claude reads the file again and proposes its filing. */
export async function reclassifyAction(documentId: string) {
  return act(async () => {
    const id = uuid.parse(documentId);
    const { aiStatus } = await import("@/server/ai/client");
    const status = await aiStatus();
    if (!status.configured) throw new UserError("Yapay zekâ henüz bağlı değil.");
    const { classifyDocument } = await import("@/server/ai/classify");
    await classifyDocument(id);
    return null;
  });
}

/** Drive's "Organize my files" for one folder: a proposal she reviews, nothing moves yet. */
export async function organizeFolderAction(folderId: string | null) {
  return act(
    async () => {
      const { organizeFolderJob } = await import("@/server/ai/organize");
      const { PermanentJobError } = await import("@/server/jobs/queue");
      try {
        const row = await organizeFolderJob({ folderId: folderId ? uuid.parse(folderId) : null });
        return { suggestionId: row?.id ?? null };
      } catch (err) {
        if (err instanceof PermanentJobError) {
          if (err.message.includes("away from AI")) throw new UserError("Bu klasör yapay zekâya kapalı.");
          if (err.message.includes("nothing")) throw new UserError("Düzenlenecek en az iki dosya gerekli.");
        }
        throw err;
      }
    },
    { refresh: false },
  );
}

/** "Gösterge değerlerini oku": Claude lists the indicator totals in a partner report, with pages. */
export async function readIndicatorsAction(documentId: string, opts: { periodId?: string | null; organisationId?: string | null } = {}) {
  return act(
    async () => {
      const { readIndicatorsJob } = await import("@/server/ai/indicator-reader");
      const { PermanentJobError } = await import("@/server/jobs/queue");
      try {
        const row = await readIndicatorsJob({ documentId: uuid.parse(documentId), periodId: opts.periodId ?? null, organisationId: opts.organisationId ?? null });
        return { suggestionId: row.id };
      } catch (err) {
        if (err instanceof PermanentJobError) {
          if (err.message.includes("indicators")) throw new UserError("Önce Göstergeler'de en az bir sayısal gösterge tanımla.");
          if (err.message.includes("periods")) throw new UserError("Önce Göstergeler'de raporlama dönemlerini tanımla.");
        }
        throw err;
      }
    },
    { refresh: false },
  );
}

/** Kontrol's "Hepsini dosyala": accept every filing proposal as Claude made it. */
export async function acceptClassificationsAction(ids: string[]) {
  return act(async () => {
    const { acceptSuggestion, getSuggestion } = await import("@/server/services/suggestions");
    const { todayStr } = await import("@/lib/dates");
    const today = todayStr();
    let done = 0;
    for (const id of z.array(uuid).max(300).parse(ids)) {
      const s = await getSuggestion(id);
      if (!s || s.kind !== "classification" || s.status !== "pending") continue;
      // Deadlines still ahead become tasks, the same default the single card uses.
      const dates = ((s.payload as { keyDates?: { date: string }[] }).keyDates ?? []).filter((k) => k.date >= today);
      await acceptSuggestion(id, { keyDateTasks: dates.length > 0 });
      done++;
    }
    return { count: done };
  });
}
