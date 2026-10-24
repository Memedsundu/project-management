import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { docPassages, documents, jobs } from "@/server/db/schema";
import { enqueue, PermanentJobError } from "@/server/jobs/queue";
import { addLink } from "@/server/services/links";
import { createSuggestion } from "@/server/services/suggestions";
import { addTags, listTags } from "@/server/services/tags";
import type { EntityRef } from "@/server/entities";
import { aiJson, aiStatus, asMaterial, modelFor, recordRun, requestShape, systemBlocks, anthropic } from "./client";
import { documentAiOff } from "./context";

/**
 * Paperless-style filing: Claude reads a new file and proposes its type,
 * a clean title, the folder, the partners, the period, tags, a summary and
 * any deadlines in it. The type and folder come from closed lists, so the
 * answer is always one of the options she defined (type-safe).
 */

export type ClassificationPayload = {
  documentId: string;
  docType: string;
  confidence: number;
  title: string;
  language: "tr" | "en" | "other";
  status: "draft" | "final" | "signed";
  periodLabel: string | null;
  folderId: string | null;
  partnerIds: string[];
  tags: string[];
  summary: string;
  keyDates: { date: string; label: string }[];
  previous: { title: string; folderId: string | null };
};

async function context() {
  const { listDocTypes, listAllFolders } = await import("@/server/services/documents");
  const { listOrganisationsLite } = await import("@/server/services/partners-lite");
  const [types, folders, partners, tags] = await Promise.all([listDocTypes(), listAllFolders(), listOrganisationsLite(), listTags()]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string) => {
    const names: string[] = [];
    let cur = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 20) {
      names.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return names.join(" / ");
  };
  return {
    types,
    folders: folders.filter((f) => !f.aiOff).map((f) => ({ id: f.id, path: pathOf(f.id) })),
    partners,
    tags: tags.slice(0, 80).map((t) => t.name),
  };
}

type Ctx = Awaited<ReturnType<typeof context>>;

function schemaFor(ctx: Ctx) {
  const typeKeys = ctx.types.map((t) => t.key) as [string, ...string[]];
  const folderIds = ["none", ...ctx.folders.map((f) => f.id)] as [string, ...string[]];
  return z.object({
    docType: z.enum(typeKeys).describe("One key from the document type list."),
    confidence: z.number().describe("0 to 1: how sure you are about the type."),
    title: z.string().describe("A clear title in the file's own language. Keep codes, partner names and periods."),
    language: z.enum(["tr", "en", "other"]),
    status: z.enum(["draft", "final", "signed"]).describe("signed when signatures or stamps are mentioned, draft when marked draft or with tracked comments."),
    periodLabel: z.string().nullable().describe("Reporting period the file covers: 'YYYY Qn', 'YYYY-MM', 'YYYY H1/H2' or 'YYYY'. Null if none."),
    folderId: z.enum(folderIds).describe("Best existing folder id, or 'none' when no folder fits."),
    partnerIds: z.array(z.string()).describe("Ids of partners the file is from or about."),
    tags: z.array(z.string()).describe("Up to 4 short tags; reuse existing tags when they fit."),
    summary: z.string().describe("Two plain sentences in Turkish: what the file is and why it matters."),
    keyDates: z.array(z.object({ date: z.string().describe("YYYY-MM-DD"), label: z.string().describe("Short Turkish label, e.g. 'Ara rapor son tarihi'") })).describe("Future deadlines, reporting dates or meeting dates stated in the file."),
    personalDataConcern: z.boolean().describe("True if the file seems to contain personal data about individual children (names with ages, ID numbers, lists of children)."),
  });
}

function systemFor(ctx: Ctx) {
  return [
    `Today is ${todayStr()}. File the uploaded document for her project.`,
    "Document types:",
    ...ctx.types.map((t) => `- ${t.key}: ${t.en} — ${t.description}`),
    "Folders (id: path):",
    ...(ctx.folders.length ? ctx.folders.map((f) => `- ${f.id}: ${f.path}`) : ["(no folders yet)"]),
    "Partners and organisations (id: name):",
    ...(ctx.partners.length ? ctx.partners.map((p) => `- ${p.id}: ${p.name}${p.shortName ? ` (${p.shortName})` : ""}`) : ["(none yet)"]),
    `Existing tags: ${ctx.tags.join(", ") || "(none)"}`,
    "Only use ids from these lists. Do not guess deadlines that are not written in the file.",
  ].join("\n");
}

async function material(documentId: string) {
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return null;
  const passages = doc.currentVersionId
    ? await db
        .select({ page: docPassages.page, text: docPassages.text })
        .from(docPassages)
        .where(eq(docPassages.versionId, doc.currentVersionId))
        .orderBy(asc(docPassages.page), asc(docPassages.chunk))
        .limit(40)
    : [];
  let text = "";
  for (const p of passages) {
    text += (p.page ? `[page ${p.page}] ` : "") + p.text + "\n";
    if (text.length > 14_000) break;
  }
  return { doc, body: asMaterial("file", { name: doc.filename, folder: doc.folderId ?? "root", pages: doc.pageCount }, text || "(no text could be read; use the file name)") };
}

function clean(ctx: Ctx, documentId: string, out: z.infer<ReturnType<typeof schemaFor>>, doc: { title: string; folderId: string | null }): ClassificationPayload {
  const partnerIds = new Set(ctx.partners.map((p) => p.id));
  return {
    documentId,
    docType: out.docType,
    confidence: Math.max(0, Math.min(1, out.confidence)),
    title: out.title.trim().slice(0, 200) || doc.title,
    language: out.language,
    status: out.status,
    periodLabel: out.periodLabel?.trim() || null,
    folderId: out.folderId === "none" ? null : out.folderId,
    partnerIds: [...new Set(out.partnerIds.filter((id) => partnerIds.has(id)))],
    tags: [...new Set(out.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean))].slice(0, 4),
    summary: out.summary.trim(),
    keyDates: out.keyDates.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k.date) && k.date >= todayStr()).slice(0, 10),
    previous: { title: doc.title, folderId: doc.folderId },
  };
}

async function saveResult(payload: ClassificationPayload, concern: boolean) {
  const db = await getDb();
  await createSuggestion({
    kind: "classification",
    title: payload.title,
    summary: payload.summary,
    payload,
    source: { type: "document", id: payload.documentId },
  });
  await db
    .update(documents)
    .set({
      classificationStatus: concern ? "flagged" : "suggested",
      ...(concern ? { childDataFlag: true, childDataReason: "Claude: olası kişisel veri" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(documents.id, payload.documentId));
}

export async function classifyDocument(documentId: string) {
  const db = await getDb();
  const m = await material(documentId);
  if (!m || m.doc.deletedAt) throw new PermanentJobError("missing");
  if (await documentAiOff(m.doc)) {
    await db.update(documents).set({ classificationStatus: "skipped" }).where(eq(documents.id, documentId));
    return;
  }
  const ctx = await context();
  const schema = schemaFor(ctx);
  const out = await aiJson({
    helper: "classify",
    effort: "low",
    thinking: "light",
    maxTokens: 3000,
    schema,
    system: systemFor(ctx),
    entity: { type: "document", id: documentId },
    messages: [{ role: "user", content: m.body }],
  });
  await saveResult(clean(ctx, documentId, out, m.doc), out.personalDataConcern);
}

const BATCH_MIN = 6;

/** Job: classify one file now, or many at half price through the Batches API. */
export async function classifyDocumentJob(payload: Record<string, unknown>) {
  const documentId = String(payload.documentId ?? "");
  const status = await aiStatus();
  if (!status.configured || !status.enabled) {
    const db = await getDb();
    await db.update(documents).set({ classificationStatus: "pending" }).where(eq(documents.id, documentId));
    return;
  }
  if (status.capReached) throw new PermanentJobError("monthly cap reached");
  const db = await getDb();
  const queued = await db
    .select({ id: jobs.id, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, "classify_document"), eq(jobs.status, "queued")))
    .limit(99);
  if (queued.length + 1 >= BATCH_MIN) {
    await db.update(jobs).set({ status: "done", updatedAt: new Date() }).where(inArray(jobs.id, queued.map((q) => q.id)));
    const ids = [documentId, ...queued.map((q) => String((q.payload as { documentId?: string }).documentId ?? ""))].filter(Boolean);
    await submitClassifyBatch([...new Set(ids)]);
    return;
  }
  await classifyDocument(documentId);
}

async function submitClassifyBatch(documentIds: string[]) {
  const ctx = await context();
  const schema = schemaFor(ctx);
  const format = zodOutputFormat(schema);
  const model = await modelFor("classify");
  const requests: Anthropic.Messages.BatchCreateParams.Request[] = [];
  const db = await getDb();
  for (const id of documentIds) {
    const m = await material(id);
    if (!m || m.doc.deletedAt) continue;
    if (await documentAiOff(m.doc)) {
      await db.update(documents).set({ classificationStatus: "skipped" }).where(eq(documents.id, id));
      continue;
    }
    requests.push({
      custom_id: id,
      params: {
        model,
        max_tokens: 3000,
        system: systemBlocks(systemFor(ctx)),
        messages: [{ role: "user", content: m.body }],
        ...requestShape(model, "low", "light"),
        output_config: { effort: "low", format: { type: "json_schema", schema: format.schema } },
      } as Anthropic.Messages.MessageCreateParamsNonStreaming,
    });
  }
  if (!requests.length) return;
  const batch = await anthropic().messages.batches.create({ requests });
  await enqueue("poll_batches", { batchId: batch.id, kind: "classify" }, { runAt: new Date(Date.now() + 2 * 60_000), dedupeKey: `batch:${batch.id}` });
}

/** Called by the batch poller with each finished answer. */
export async function handleClassifyBatchResult(documentId: string, message: Anthropic.Message, model: string) {
  await recordRun({ helper: "classify", model, usage: message.usage, batch: true, entity: { type: "document", id: documentId } });
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || doc.deletedAt) return;
  const ctx = await context();
  const format = zodOutputFormat(schemaFor(ctx));
  const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  try {
    const out = format.parse(text) as z.infer<ReturnType<typeof schemaFor>>;
    await saveResult(clean(ctx, documentId, out, doc), out.personalDataConcern);
  } catch {
    // The folder or partner lists changed while the batch ran: classify again directly.
    await enqueue("classify_document", { documentId }, { dedupeKey: `classify:${documentId}` });
  }
}

export type ClassificationDecision = Partial<Omit<ClassificationPayload, "documentId" | "previous" | "confidence">> & { keyDateTasks?: boolean };

/** She accepted (maybe after edits): file the document as proposed. */
export async function applyClassification(payload: unknown, decision: unknown, source: EntityRef | null) {
  void source;
  const p = payload as ClassificationPayload;
  const d = (decision ?? {}) as ClassificationDecision;
  const merged = { ...p, ...d };
  const { updateDocument } = await import("@/server/services/documents");
  await updateDocument(p.documentId, {
    title: merged.title,
    docType: merged.docType,
    language: merged.language,
    status: merged.status,
    periodLabel: merged.periodLabel,
    folderId: merged.folderId,
    summary: merged.summary,
    keyDates: merged.keyDates,
    classificationStatus: "confirmed",
  });
  const ref = { type: "document" as const, id: p.documentId };
  if (merged.tags?.length) await addTags(ref, merged.tags);
  for (const orgId of merged.partnerIds ?? []) await addLink(ref, { type: "organisation", id: orgId }, "partner", "ai");
  let tasksCreated = 0;
  if (d.keyDateTasks && merged.keyDates?.length) {
    const { createTask } = await import("@/server/services/tasks");
    const { todayStr } = await import("@/lib/dates");
    const today = todayStr();
    // Only deadlines still ahead become tasks.
    for (const k of merged.keyDates.filter((x) => x.date >= today)) {
      await createTask({ title: k.label, dueDate: k.date, sourceType: "document", sourceId: p.documentId, orgIds: merged.partnerIds }, "ai");
      tasksCreated++;
    }
  }
  const { indexDocument } = await import("@/server/services/documents");
  await indexDocument(p.documentId);
  return { status: "accepted" as const, result: { tasksCreated } };
}
