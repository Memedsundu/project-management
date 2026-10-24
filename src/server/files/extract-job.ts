import "server-only";
import { and, eq } from "drizzle-orm";
import { foldText } from "@/lib/fold";
import { aiConfigured, aiStatus } from "@/server/ai/client";
import { documentAiOff } from "@/server/ai/context";
import { getDb } from "@/server/db/client";
import { docPassages, documents, documentVersions } from "@/server/db/schema";
import { enqueue, PermanentJobError } from "@/server/jobs/queue";
import { logActivity } from "@/server/services/activity";
import { indexDocument } from "@/server/services/documents";
import { getObjectBuffer } from "@/server/storage";
import { checkForChildData, reasonText } from "./child-guard";
import { chunkPage, extractFile, type ExtractedPage } from "./extract";

/**
 * Background step after an upload: read the words out of the file, store
 * them as passages for search and Ask, run the child-data guard, then hand
 * the file to the classifier.
 */
export async function extractTextJob(payload: Record<string, unknown>) {
  const documentId = String(payload.documentId ?? "");
  const versionId = String(payload.versionId ?? "");
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  const [ver] = await db.select().from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId))).limit(1);
  if (!doc || !ver) throw new PermanentJobError("document or version missing");
  if (doc.deletedAt) return;

  const buf = await getObjectBuffer(ver.storageKey);
  if (!buf) throw new Error("stored file not found yet");

  let pages: ExtractedPage[] = [];
  let pageCount: number | null = null;
  let status: "done" | "partial" | "none" | "failed" = "done";
  let headers: string[][] = [];
  let ocrUsed = false;
  try {
    const ex = await extractFile(buf, ver.mime, ver.filename);
    pages = ex.pages;
    pageCount = ex.pageCount;
    headers = ex.headers;
    if (ex.needsOcr) {
      status = pages.some((p) => p.text) ? "partial" : "none";
      const off = await documentAiOff(doc);
      const ai = aiConfigured() ? await aiStatus() : null;
      const small = (pageCount ?? 1) <= 30;
      if (!off && ai?.enabled && !ai.capReached && small) {
        const { ocrWithClaude } = await import("@/server/ai/ocr");
        const ocr = await ocrWithClaude(buf, ver.mime, doc.id).catch((e) => {
          console.error("[ocr]", e);
          return null;
        });
        if (ocr?.length) {
          pages = ocr;
          status = "done";
          ocrUsed = true;
        }
      }
    } else if (!pages.length) status = ex.kind === "other" ? "none" : "done";
  } catch (err) {
    console.error("[extract]", ver.filename, err);
    status = "failed";
  }

  // Replace this version's passages.
  await db.delete(docPassages).where(eq(docPassages.versionId, ver.id));
  const rows: (typeof docPassages.$inferInsert)[] = [];
  for (const p of pages) {
    chunkPage(p.text).forEach((text, chunk) => {
      rows.push({ documentId: doc.id, versionId: ver.id, page: p.page, chunk, text, foldedText: foldText(text) });
    });
  }
  for (let i = 0; i < rows.length; i += 200) await db.insert(docPassages).values(rows.slice(i, i + 200));

  const fullText = pages.map((p) => p.text).join("\n\n");
  await db.update(documentVersions).set({ textContent: fullText.slice(0, 500_000) }).where(eq(documentVersions.id, ver.id));

  const guard = checkForChildData({ text: fullText, headers });
  const isCurrent = doc.currentVersionId === ver.id;
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (isCurrent) {
    set.textStatus = status;
    set.pageCount = pageCount;
    set.meta = { ...(doc.meta as object), ocr: ocrUsed || undefined };
  }
  if (guard.flag && !doc.childDataFlag && !(doc.meta as { childDataCleared?: boolean })?.childDataCleared) {
    set.childDataFlag = true;
    set.childDataReason = reasonText(guard.reasons);
    set.classificationStatus = "flagged";
  }
  await db.update(documents).set(set).where(eq(documents.id, doc.id));
  if (set.childDataFlag) {
    await logActivity({ action: "flag", entityType: "document", entityId: doc.id, title: doc.title, summary: set.childDataReason, actor: "system" });
  }
  await indexDocument(doc.id);

  if (isCurrent && !set.childDataFlag && payload.reclassify !== false && (doc.classificationStatus === "pending" || doc.classificationStatus === "failed")) {
    await enqueue("classify_document", { documentId: doc.id }, { dedupeKey: `classify:${doc.id}` });
  }
  if (rows.length) await enqueue("embed_pending", {}, { dedupeKey: "embed_pending", runAt: new Date(Date.now() + 5_000) });
}
