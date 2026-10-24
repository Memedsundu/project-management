import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { documents, documentTypes, documentVersions, folders } from "@/server/db/schema";
import type { KeyDate } from "@/server/db/schema/files";
import { enqueue, kickJobs } from "@/server/jobs/queue";
import { indexRecord, unindexRecord } from "@/server/search/index-service";
import { deleteObject } from "@/server/storage";
import { logActivity, type Actor } from "./activity";
import { idsWithTag, tagsFor } from "./tags";

export type DocumentRow = typeof documents.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;

/** Built-in document types (Paperless-style). She can edit the list in Ayarlar. */
export const DEFAULT_DOC_TYPES: { key: string; tr: string; en: string; description: string }[] = [
  { key: "proposal", tr: "Proje önerisi", en: "Proposal", description: "Project proposal, concept note or narrative submitted to the donor." },
  { key: "agreement", tr: "Sözleşme / anlaşma", en: "Agreement", description: "Grant agreement, partner agreement, MoU, amendment, contract." },
  { key: "budget", tr: "Bütçe", en: "Budget", description: "Budget, budget revision, financial plan, cost breakdown." },
  { key: "financial_report", tr: "Mali rapor", en: "Financial report", description: "Expenditure report, financial statement, audit." },
  { key: "narrative_report", tr: "Faaliyet raporu", en: "Narrative report", description: "Progress, interim, quarterly or final narrative report." },
  { key: "partner_report", tr: "Ortak raporu", en: "Partner report", description: "A report sent by an implementing partner." },
  { key: "workplan", tr: "İş planı", en: "Workplan", description: "Workplan, Gantt chart, activity schedule." },
  { key: "logframe", tr: "Mantıksal çerçeve", en: "Logframe", description: "Logical framework, results framework, indicator matrix, M&E plan." },
  { key: "meeting_minutes", tr: "Toplantı tutanağı", en: "Meeting minutes", description: "Minutes, notes or summary of a meeting." },
  { key: "field_visit", tr: "Saha ziyareti", en: "Field visit report", description: "Monitoring or field visit report, trip report." },
  { key: "assessment", tr: "Değerlendirme / araştırma", en: "Assessment / study", description: "Needs assessment, baseline, evaluation, research, study." },
  { key: "training", tr: "Eğitim materyali", en: "Training material", description: "Training module, curriculum, presentation, participant list totals." },
  { key: "communication", tr: "İletişim / görünürlük", en: "Communication", description: "Visibility material, press release, brochure, case story without names." },
  { key: "correspondence", tr: "Yazışma", en: "Correspondence", description: "Letters, official correspondence, saved emails." },
  { key: "policy", tr: "Politika / rehber", en: "Policy / guideline", description: "Policy, SOP, guideline, safeguarding or procurement rules." },
  { key: "procurement", tr: "Satın alma", en: "Procurement", description: "Tender, quotation, purchase order, invoice." },
  { key: "data", tr: "Veri / tablo", en: "Data / table", description: "Spreadsheet of totals, indicator data, monitoring data." },
  { key: "other", tr: "Diğer", en: "Other", description: "Anything that fits none of the types above." },
];

export async function listDocTypes() {
  const db = await getDb();
  const rows = await db.select().from(documentTypes).orderBy(asc(documentTypes.sort), asc(documentTypes.nameTr));
  if (rows.length) return rows.map((r) => ({ key: r.key, tr: r.nameTr, en: r.nameEn, description: r.description ?? "" }));
  return DEFAULT_DOC_TYPES;
}

export async function saveDocTypes(list: { key: string; tr: string; en: string; description?: string }[]) {
  const db = await getDb();
  await db.delete(documentTypes);
  if (list.length) {
    await db.insert(documentTypes).values(
      list.map((x, i) => ({ key: x.key, nameTr: x.tr, nameEn: x.en, description: x.description ?? null, sort: i })),
    );
  }
}

/* ------------------------------ Folders ------------------------------ */

export async function createFolder(name: string, parentId: string | null) {
  const clean = z.string().trim().min(1).max(200).parse(name);
  const db = await getDb();
  const [row] = await db.insert(folders).values({ name: clean, parentId }).returning();
  await logActivity({ action: "create", entityType: "folder", entityId: row!.id, title: clean });
  await indexFolder(row!.id);
  return row!;
}

export async function updateFolder(id: string, patch: { name?: string; parentId?: string | null; aiOff?: boolean }) {
  const db = await getDb();
  const set: Partial<typeof folders.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = z.string().trim().min(1).max(200).parse(patch.name);
  if (patch.parentId !== undefined) {
    if (patch.parentId && (await folderIsInside(patch.parentId, id))) throw new UserError("Bir klasör kendi içine taşınamaz.");
    set.parentId = patch.parentId;
  }
  if (patch.aiOff !== undefined) set.aiOff = patch.aiOff;
  const [row] = await db.update(folders).set(set).where(eq(folders.id, id)).returning();
  if (!row) return null;
  await logActivity({
    action: patch.name !== undefined ? "rename" : patch.parentId !== undefined ? "move" : "update",
    entityType: "folder",
    entityId: id,
    title: row.name,
    summary: patch.aiOff !== undefined ? (patch.aiOff ? "ai_off" : "ai_on") : null,
  });
  await indexFolder(id);
  if (patch.aiOff !== undefined) {
    // Documents below inherit the switch: refresh their search rows.
    for (const docId of await documentIdsUnder(id)) await indexDocument(docId);
  }
  return row;
}

async function folderIsInside(candidate: string, ancestor: string) {
  if (candidate === ancestor) return true;
  const chain = await folderChain(candidate);
  return chain.some((f) => f.id === ancestor);
}

/** The folder and everything above it, root first. */
export async function folderChain(folderId: string | null) {
  if (!folderId) return [] as { id: string; name: string; aiOff: boolean }[];
  const db = await getDb();
  const res = (await db.execute(sql`
    with recursive up as (
      select id, parent_id, name, ai_off, 0 as depth from folders where id = ${folderId}::uuid
      union all
      select f.id, f.parent_id, f.name, f.ai_off, up.depth + 1 from folders f join up on f.id = up.parent_id where up.depth < 30
    ) select id, name, ai_off as "aiOff" from up order by depth desc`)) as unknown as { rows: { id: string; name: string; aiOff: boolean }[] };
  return res.rows ?? [];
}

export async function documentIdsUnder(folderId: string) {
  const db = await getDb();
  const res = (await db.execute(sql`
    with recursive down as (
      select id from folders where id = ${folderId}::uuid
      union all
      select f.id from folders f join down on f.parent_id = down.id
    ) select d.id from documents d where d.folder_id in (select id from down) and d.deleted_at is null`)) as unknown as { rows: { id: string }[] };
  return (res.rows ?? []).map((r) => r.id);
}

export async function listAllFolders() {
  const db = await getDb();
  return db
    .select({ id: folders.id, name: folders.name, parentId: folders.parentId, aiOff: folders.aiOff })
    .from(folders)
    .where(isNull(folders.deletedAt))
    .orderBy(asc(folders.name));
}

export async function indexFolder(id: string) {
  const db = await getDb();
  const [f] = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  if (!f || f.deletedAt) return unindexRecord("folder", id);
  const chain = await folderChain(f.parentId);
  await indexRecord({ type: "folder", id, title: f.name, body: chain.map((c) => c.name).join(" / "), meta: { parentId: f.parentId }, occurredAt: f.updatedAt });
}

/* ------------------------------ Documents ------------------------------ */

export type DocumentFilters = {
  folderId?: string | null;
  anyFolder?: boolean;
  docType?: string;
  orgId?: string;
  tag?: string;
  status?: string;
  language?: string;
  period?: string;
  starred?: boolean;
  toCheck?: boolean;
  text?: string;
  mime?: "pdf" | "word" | "sheet" | "slides" | "image" | "email" | "other";
};

export type DocumentSort = "name" | "updated" | "created" | "size" | "type";

const MIME_GROUPS: Record<NonNullable<DocumentFilters["mime"]>, SQL> = {
  pdf: sql`${documents.mime} = 'application/pdf'`,
  word: sql`(${documents.mime} like '%wordprocessingml%' or ${documents.mime} = 'application/msword' or ${documents.mime} like 'application/vnd.oasis.opendocument.text%')`,
  sheet: sql`(${documents.mime} like '%spreadsheetml%' or ${documents.mime} = 'application/vnd.ms-excel' or ${documents.mime} = 'text/csv')`,
  slides: sql`(${documents.mime} like '%presentationml%' or ${documents.mime} = 'application/vnd.ms-powerpoint')`,
  image: sql`${documents.mime} like 'image/%'`,
  email: sql`(${documents.mime} = 'message/rfc822' or ${documents.mime} = 'application/vnd.ms-outlook')`,
  other: sql`true`,
};

export async function listDocuments(f: DocumentFilters, opts: { sort?: DocumentSort; dir?: "asc" | "desc"; limit?: number } = {}) {
  const db = await getDb();
  const where: SQL[] = [isNull(documents.deletedAt)];
  if (!f.anyFolder) where.push(f.folderId ? eq(documents.folderId, f.folderId) : isNull(documents.folderId));
  if (f.docType) where.push(eq(documents.docType, f.docType));
  if (f.status) where.push(eq(documents.status, f.status));
  if (f.language) where.push(eq(documents.language, f.language));
  if (f.period) where.push(eq(documents.periodLabel, f.period));
  if (f.starred) where.push(eq(documents.starred, true));
  if (f.toCheck) where.push(inArray(documents.classificationStatus, ["suggested", "flagged"]));
  if (f.text) where.push(ilike(documents.title, `%${f.text}%`));
  if (f.mime && f.mime !== "other") where.push(MIME_GROUPS[f.mime]);
  if (f.tag) {
    const ids = await idsWithTag("document", f.tag);
    where.push(ids.length ? inArray(documents.id, ids) : sql`false`);
  }
  if (f.orgId) {
    where.push(
      sql`exists (select 1 from links l where ((l.from_type = 'document' and l.from_id = ${documents.id} and l.to_type = 'organisation' and l.to_id = ${f.orgId}::uuid) or (l.to_type = 'document' and l.to_id = ${documents.id} and l.from_type = 'organisation' and l.from_id = ${f.orgId}::uuid)))`,
    );
  }
  const dir = opts.dir ?? (opts.sort === "name" || opts.sort === "type" ? "asc" : "desc");
  const col =
    opts.sort === "name"
      ? sql`lower(${documents.title})`
      : opts.sort === "size"
        ? sql`${documents.size}`
        : opts.sort === "created"
          ? sql`${documents.createdAt}`
          : opts.sort === "type"
            ? sql`coalesce(${documents.docType}, 'zzz')`
            : sql`${documents.updatedAt}`;
  const rows = await db
    .select()
    .from(documents)
    .where(and(...where))
    .orderBy(dir === "asc" ? sql`${col} asc` : sql`${col} desc`, asc(documents.title))
    .limit(opts.limit ?? 500);
  return decorateDocuments(rows);
}

export type DocumentView = DocumentRow & { tags: { name: string; slug: string }[]; orgIds: string[] };

export async function decorateDocuments(rows: DocumentRow[]): Promise<DocumentView[]> {
  if (!rows.length) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const [tagMap, linkRows] = await Promise.all([
    tagsFor("document", ids),
    db.execute(sql`
      select from_id as doc, to_id as org from links where from_type = 'document' and to_type = 'organisation' and from_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      union
      select to_id as doc, from_id as org from links where to_type = 'document' and from_type = 'organisation' and to_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`),
  ]);
  const orgs = new Map<string, string[]>();
  for (const r of (linkRows as unknown as { rows: { doc: string; org: string }[] }).rows ?? []) {
    orgs.set(r.doc, [...(orgs.get(r.doc) ?? []), r.org]);
  }
  return rows.map((r) => ({ ...r, tags: (tagMap.get(r.id) ?? []).map((t) => ({ name: t.name, slug: t.slug })), orgIds: orgs.get(r.id) ?? [] }));
}

export async function listSubfolders(parentId: string | null) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(folders)
    .where(and(isNull(folders.deletedAt), parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId)))
    .orderBy(asc(sql`lower(${folders.name})`));
  if (!rows.length) return [];
  const counts = (await db.execute(sql`
    select folder_id, count(*)::int as n from documents where deleted_at is null and folder_id in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)}) group by folder_id`)) as unknown as {
    rows: { folder_id: string; n: number }[];
  };
  const sub = (await db.execute(sql`
    select parent_id, count(*)::int as n from folders where deleted_at is null and parent_id in (${sql.join(rows.map((r) => sql`${r.id}::uuid`), sql`, `)}) group by parent_id`)) as unknown as {
    rows: { parent_id: string; n: number }[];
  };
  const dc = new Map((counts.rows ?? []).map((r) => [r.folder_id, Number(r.n)]));
  const fc = new Map((sub.rows ?? []).map((r) => [r.parent_id, Number(r.n)]));
  return rows.map((r) => ({ ...r, documentCount: dc.get(r.id) ?? 0, folderCount: fc.get(r.id) ?? 0 }));
}

export async function getDocument(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!row) return null;
  const [view] = await decorateDocuments([row]);
  const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.version));
  return { ...view!, versions };
}

export async function findDuplicate(sha256: string) {
  const db = await getDb();
  const [row] = await db
    .select({ id: documents.id, title: documents.title, folderId: documents.folderId })
    .from(documents)
    .where(and(eq(documents.sha256, sha256), isNull(documents.deletedAt)))
    .limit(1);
  if (row) return row;
  // An older version of another document with the same bytes.
  const [ver] = await db
    .select({ id: documents.id, title: documents.title, folderId: documents.folderId })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(eq(documentVersions.sha256, sha256), isNull(documents.deletedAt)))
    .limit(1);
  return ver ?? null;
}

function titleFromFilename(name: string) {
  return name.replace(/\.[a-z0-9]{1,6}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || name;
}

export async function createDocumentFromUpload(input: {
  key: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  folderId: string | null;
  title?: string;
  source?: "upload" | "email" | "export";
  actor?: Actor;
}) {
  const db = await getDb();
  const [doc] = await db
    .insert(documents)
    .values({
      folderId: input.folderId,
      title: input.title ?? titleFromFilename(input.filename),
      filename: input.filename,
      mime: input.mime || "application/octet-stream",
      size: input.size,
      sha256: input.sha256,
      source: input.source ?? "upload",
    })
    .returning();
  const [ver] = await db
    .insert(documentVersions)
    .values({ documentId: doc!.id, version: 1, storageKey: input.key, filename: input.filename, mime: doc!.mime, size: input.size, sha256: input.sha256 })
    .returning();
  await db.update(documents).set({ currentVersionId: ver!.id }).where(eq(documents.id, doc!.id));
  await logActivity({ action: "upload", entityType: "document", entityId: doc!.id, title: doc!.title, actor: input.actor ?? "user" });
  await indexDocument(doc!.id);
  await enqueue("extract_text", { documentId: doc!.id, versionId: ver!.id }, { dedupeKey: `extract:${ver!.id}` });
  await kickJobs(["extract_text", "classify_document", "embed_pending"]);
  return { ...doc!, currentVersionId: ver!.id };
}

/** "Yeni sürüm yükle": the file keeps its place, links and history (Drive "Manage versions"). */
export async function addDocumentVersion(documentId: string, input: { key: string; filename: string; mime: string; size: number; sha256: string; note?: string | null }) {
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new UserError("Belge bulunamadı.");
  const [{ max } = { max: 0 }] = (await db
    .select({ max: sql<number>`coalesce(max(${documentVersions.version}), 0)::int` })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))) as { max: number }[];
  const [ver] = await db
    .insert(documentVersions)
    .values({ documentId, version: Number(max) + 1, storageKey: input.key, filename: input.filename, mime: input.mime, size: input.size, sha256: input.sha256, note: input.note ?? null })
    .returning();
  await db
    .update(documents)
    .set({ currentVersionId: ver!.id, filename: input.filename, mime: input.mime, size: input.size, sha256: input.sha256, textStatus: "pending", updatedAt: new Date() })
    .where(eq(documents.id, documentId));
  await logActivity({ action: "version", entityType: "document", entityId: documentId, title: doc.title, summary: `v${ver!.version}${input.note ? ` · ${input.note}` : ""}` });
  await enqueue("extract_text", { documentId, versionId: ver!.id, reclassify: false }, { dedupeKey: `extract:${ver!.id}` });
  await kickJobs(["extract_text", "embed_pending"]);
  return ver!;
}

/** Make an older version current again (the newer one stays in the list). */
export async function restoreDocumentVersion(documentId: string, versionId: string) {
  const db = await getDb();
  const [ver] = await db.select().from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId))).limit(1);
  if (!ver) throw new UserError("Sürüm bulunamadı.");
  await db
    .update(documents)
    .set({ currentVersionId: ver.id, filename: ver.filename, mime: ver.mime, size: ver.size, sha256: ver.sha256, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
  await logActivity({ action: "restore_version", entityType: "document", entityId: documentId, summary: `v${ver.version}` });
  await indexDocument(documentId);
}

export const documentPatchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  folderId: z.string().uuid().nullish(),
  docType: z.string().max(60).nullish(),
  status: z.enum(["draft", "final", "signed"]).optional(),
  language: z.enum(["tr", "en", "other"]).nullish(),
  periodLabel: z.string().max(60).nullish(),
  summary: z.string().max(4000).nullish(),
  keyDates: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().max(200) })).max(30).optional(),
  aiOff: z.boolean().optional(),
  starred: z.boolean().optional(),
  classificationStatus: z.enum(["pending", "suggested", "confirmed", "flagged", "skipped", "failed"]).optional(),
  childDataFlag: z.boolean().optional(),
});
export type DocumentPatch = z.input<typeof documentPatchSchema>;

export async function updateDocument(id: string, raw: DocumentPatch, actor: Actor = "user") {
  const patch = documentPatchSchema.parse(raw);
  const db = await getDb();
  const [before] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!before) return null;
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (set as Record<string, unknown>)[k] = v;
  }
  if (patch.childDataFlag === false) set.childDataReason = null;
  const [row] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  const action =
    patch.title !== undefined && patch.title !== before.title
      ? "rename"
      : patch.folderId !== undefined && patch.folderId !== before.folderId
        ? "move"
        : "update";
  const changed = Object.keys(patch).filter((k) => k !== "title" && k !== "folderId");
  await logActivity({ action, entityType: "document", entityId: id, title: row!.title, summary: action === "update" ? changed.join(", ") : null, actor });
  await indexDocument(id);
  return row!;
}

export async function moveDocuments(ids: string[], folderId: string | null) {
  for (const id of ids) await updateDocument(id, { folderId });
}

export async function touchDocument(id: string) {
  const db = await getDb();
  await db.update(documents).set({ lastOpenedAt: new Date() }).where(eq(documents.id, id));
}

/** The search row: title, file name, folder path, type, summary. Words inside the file live in doc_passages. */
export async function indexDocument(id: string) {
  const db = await getDb();
  const [d] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!d || d.deletedAt) return unindexRecord("document", id);
  const chain = await folderChain(d.folderId);
  const orgRows = (await db.execute(sql`
    select to_id as org from links where from_type = 'document' and from_id = ${id}::uuid and to_type = 'organisation'
    union select from_id as org from links where to_type = 'document' and to_id = ${id}::uuid and from_type = 'organisation'`)) as unknown as { rows: { org: string }[] };
  const tagMap = await tagsFor("document", [id]);
  const aiOff = d.aiOff || d.childDataFlag || chain.some((c) => c.aiOff);
  await indexRecord({
    type: "document",
    id,
    title: d.title,
    body: [d.filename, chain.map((c) => c.name).join(" / "), d.summary, d.periodLabel, (tagMap.get(id) ?? []).map((t) => `#${t.name}`).join(" "), (d.keyDates ?? []).map((k: KeyDate) => k.label).join("; ")]
      .filter(Boolean)
      .join("\n"),
    meta: { docType: d.docType, orgIds: (orgRows.rows ?? []).map((r) => r.org), folderId: d.folderId, mime: d.mime, status: d.status, period: d.periodLabel },
    aiOff,
    occurredAt: d.createdAt,
  });
}

export async function listRecentDocuments(limit = 12) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(documents)
    .where(isNull(documents.deletedAt))
    .orderBy(desc(sql`greatest(${documents.updatedAt}, coalesce(${documents.lastOpenedAt}, ${documents.updatedAt}))`))
    .limit(limit);
  return decorateDocuments(rows);
}

export async function listDocumentsToCheck() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(documents)
    .where(and(isNull(documents.deletedAt), inArray(documents.classificationStatus, ["suggested", "flagged"])))
    .orderBy(desc(documents.createdAt))
    .limit(300);
  return decorateDocuments(rows);
}

export async function listKeyDates(fromDay: string, toDay: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: documents.id, title: documents.title, keyDates: documents.keyDates })
    .from(documents)
    .where(and(isNull(documents.deletedAt), sql`jsonb_array_length(${documents.keyDates}) > 0`));
  const out: { documentId: string; title: string; date: string; label: string }[] = [];
  for (const r of rows) for (const k of r.keyDates ?? []) if (k.date >= fromDay && k.date <= toDay) out.push({ documentId: r.id, title: r.title, date: k.date, label: k.label });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function distinctPeriods() {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ p: documents.periodLabel })
    .from(documents)
    .where(and(isNull(documents.deletedAt), isNotNull(documents.periodLabel), ne(documents.periodLabel, "")));
  return rows.map((r) => r.p!).sort();
}

/** Delete stored bytes of every version (used when a file is purged from the trash). */
export async function purgeDocumentBytes(documentId: string) {
  const db = await getDb();
  const versions = await db.select({ key: documentVersions.storageKey }).from(documentVersions).where(eq(documentVersions.documentId, documentId));
  for (const v of versions) await deleteObject(v.key);
}
