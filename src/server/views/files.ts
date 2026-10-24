import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { FileFilters, FilesMode, FilesScreenProps } from "@/components/files/files-screen";
import type { DocumentPageData } from "@/components/files/document-screen";
import type { FileItem } from "@/components/files/types";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import { getDb } from "@/server/db/client";
import { aiSuggestions, documents } from "@/server/db/schema";
import { resolveEntities, type EntityRef, type EntityType } from "@/server/entities";
import {
  distinctPeriods,
  folderChain,
  getDocument,
  listAllFolders,
  listDocTypes,
  listDocuments,
  listRecentDocuments,
  listSubfolders,
  type DocumentFilters,
  type DocumentSort,
  type DocumentView,
} from "@/server/services/documents";
import { listPeriods } from "@/server/services/indicators";
import { listLinks } from "@/server/services/links";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { getSuggestion, listPendingSuggestions } from "@/server/services/suggestions";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const SORTS: DocumentSort[] = ["name", "updated", "created", "size", "type"];
const MIMES = ["pdf", "word", "sheet", "slides", "image", "email"] as const;

export function toFileItem(d: DocumentView): FileItem {
  return {
    id: d.id,
    title: d.title,
    filename: d.filename,
    mime: d.mime,
    size: d.size,
    docType: d.docType,
    status: d.status,
    language: d.language,
    periodLabel: d.periodLabel,
    starred: d.starred,
    aiOff: d.aiOff,
    classificationStatus: d.classificationStatus,
    childDataFlag: d.childDataFlag,
    textStatus: d.textStatus,
    folderId: d.folderId,
    updatedAt: d.updatedAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    orgIds: d.orgIds,
    tags: d.tags,
  };
}

/** Suggestions as the inbox cards show them, with source titles resolved. */
export async function toInboxSuggestions(rows: (typeof aiSuggestions.$inferSelect)[]): Promise<InboxSuggestion[]> {
  const refs: EntityRef[] = rows.filter((s) => s.sourceType && s.sourceId).map((s) => ({ type: s.sourceType as EntityType, id: s.sourceId! }));
  const resolved = await resolveEntities(refs);
  return rows.map((s) => {
    const src = s.sourceType && s.sourceId ? resolved.get(`${s.sourceType}:${s.sourceId}`) : undefined;
    return {
      id: s.id,
      kind: s.kind,
      title: s.title,
      summary: s.summary,
      createdAt: s.createdAt.toISOString(),
      source: src ? { type: src.type, id: src.id, title: src.title, href: src.href } : null,
      payload: s.payload,
      display: null,
    };
  });
}

export async function fileCounts() {
  const db = await getDb();
  const [[toCheck], [flagged]] = await Promise.all([
    db.select({ n: count() }).from(documents).where(and(isNull(documents.deletedAt), eq(documents.classificationStatus, "suggested"))),
    db.select({ n: count() }).from(documents).where(and(isNull(documents.deletedAt), eq(documents.classificationStatus, "flagged"))),
  ]);
  return { toCheck: Number(toCheck?.n ?? 0), flagged: Number(flagged?.n ?? 0) };
}

/** Belgeler: one folder (or the root), or one of the flat views across all folders. */
export async function loadFilesScreen(input: { folderId: string | null; sp: SP }): Promise<FilesScreenProps | null> {
  const { sp } = input;
  const view = one(sp.view);
  const mode: FilesMode = input.folderId ? "folder" : view === "recent" || view === "starred" || view === "all" ? view : "folder";
  const filters: FileFilters = {
    type: one(sp.type),
    org: one(sp.org),
    period: one(sp.period),
    lang: one(sp.lang),
    mime: one(sp.mime),
    q: one(sp.q),
    status: one(sp.status),
    tag: one(sp.tag),
  };
  const sortRaw = one(sp.sort);
  const sort: DocumentSort = SORTS.includes(sortRaw as DocumentSort) ? (sortRaw as DocumentSort) : "updated";
  const dirRaw = one(sp.dir);
  const dir: "asc" | "desc" = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === "name" || sort === "type" ? "asc" : "desc";

  let folder: FilesScreenProps["folder"] = null;
  let breadcrumb: { id: string; name: string }[] = [];
  let inheritedAiOff = false;
  if (input.folderId) {
    const chain = await folderChain(input.folderId);
    const self = chain.at(-1);
    if (!self || self.id !== input.folderId) return null;
    const all = await listAllFolders();
    const row = all.find((f) => f.id === input.folderId);
    if (!row) return null;
    folder = { id: row.id, name: row.name, aiOff: row.aiOff, parentId: row.parentId };
    breadcrumb = chain.slice(0, -1).map((c) => ({ id: c.id, name: c.name }));
    inheritedAiOff = chain.slice(0, -1).some((c) => c.aiOff);
  }

  const hasFilter = Object.values(filters).some(Boolean);
  const docFilters: DocumentFilters = {
    folderId: input.folderId,
    // Inside a folder, filters keep to that folder (Drive). At the top level and in the flat views
    // they look across every folder, so a filter there finds any file.
    anyFolder: mode !== "folder" || (hasFilter && !input.folderId),
    docType: filters.type,
    orgId: filters.org && /^[0-9a-f-]{36}$/i.test(filters.org) ? filters.org : undefined,
    period: filters.period,
    language: filters.lang,
    mime: MIMES.includes(filters.mime as (typeof MIMES)[number]) ? (filters.mime as DocumentFilters["mime"]) : undefined,
    text: filters.q,
    status: filters.status,
    tag: filters.tag,
    starred: mode === "starred" || undefined,
  };

  const organizeId = one(sp.organize);
  const [subfolders, files, allFolders, docTypes, orgs, periods, counts, organizeRow] = await Promise.all([
    mode === "folder" && !hasFilter ? listSubfolders(input.folderId) : Promise.resolve([]),
    mode === "recent" && !hasFilter ? listRecentDocuments(40) : listDocuments(docFilters, { sort, dir }),
    listAllFolders(),
    listDocTypes(),
    listOrganisationsLite(),
    distinctPeriods(),
    fileCounts(),
    organizeId && /^[0-9a-f-]{36}$/i.test(organizeId) ? getSuggestion(organizeId) : Promise.resolve(null),
  ]);
  const organize = organizeRow && organizeRow.status === "pending" && organizeRow.kind === "organize" ? (await toInboxSuggestions([organizeRow]))[0]! : null;

  return {
    mode,
    folder,
    breadcrumb,
    subfolders: subfolders.map((f) => ({ id: f.id, name: f.name, documentCount: f.documentCount, folderCount: f.folderCount, aiOff: f.aiOff })),
    files: files.map(toFileItem),
    allFolders: allFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, aiOff: f.aiOff })),
    docTypes: docTypes.map((d) => ({ key: d.key, tr: d.tr, en: d.en })),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    periods,
    filters,
    sort,
    dir,
    counts,
    organize,
    folderNames: Object.fromEntries(allFolders.map((f) => [f.id, f.name])),
    inheritedAiOff,
  };
}

/** One file: preview, details, versions, links and what Claude proposed for it. */
export async function loadDocumentPage(id: string, sp: SP): Promise<DocumentPageData | null> {
  const doc = await getDocument(id);
  if (!doc || doc.deletedAt) return null;
  const [chain, links, docTypes, orgs, allFolders, pending, periods] = await Promise.all([
    folderChain(doc.folderId),
    listLinks({ type: "document", id }),
    listDocTypes(),
    listOrganisationsLite(),
    listAllFolders(),
    listPendingSuggestions({ source: { type: "document", id }, limit: 20 }),
    listPeriods(),
  ]);
  const suggestions = await toInboxSuggestions(pending);
  const pageRaw = Number(one(sp.page));
  return {
    doc: {
      id: doc.id,
      title: doc.title,
      filename: doc.filename,
      mime: doc.mime,
      size: doc.size,
      docType: doc.docType,
      status: doc.status,
      language: doc.language,
      periodLabel: doc.periodLabel,
      summary: doc.summary,
      keyDates: doc.keyDates ?? [],
      starred: doc.starred,
      aiOff: doc.aiOff,
      classificationStatus: doc.classificationStatus,
      childDataFlag: doc.childDataFlag,
      childDataReason: doc.childDataReason,
      textStatus: doc.textStatus,
      pageCount: doc.pageCount,
      folderId: doc.folderId,
      currentVersionId: doc.currentVersionId,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      orgIds: doc.orgIds,
      tags: doc.tags,
      source: doc.source,
    },
    folderPath: chain.map((c) => ({ id: c.id, name: c.name })),
    inheritedAiOff: chain.some((c) => c.aiOff),
    versions: doc.versions.map((v) => ({
      id: v.id,
      version: v.version,
      filename: v.filename,
      size: v.size,
      mime: v.mime,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
      current: v.id === doc.currentVersionId,
    })),
    links: links
      .filter((l) => l.kind !== "partner")
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    docTypes: docTypes.map((d) => ({ key: d.key, tr: d.tr, en: d.en })),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    allFolders: allFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, aiOff: f.aiOff })),
    folderNames: Object.fromEntries(allFolders.map((f) => [f.id, f.name])),
    classification: suggestions.find((s) => s.kind === "classification") ?? null,
    suggestions: suggestions.filter((s) => s.kind !== "classification"),
    periods: periods.map((p) => ({ id: p.id, label: p.label })),
    page: Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : null,
  };
}

/** Kontrol: Claude's filing proposals to check, and files held back for possible child data. */
export async function loadCheckScreen() {
  const db = await getDb();
  const [pending, flaggedRows, docTypes, orgs, allFolders, counts] = await Promise.all([
    listPendingSuggestions({ kinds: ["classification"], limit: 200 }),
    db.select().from(documents).where(and(isNull(documents.deletedAt), eq(documents.childDataFlag, true))).limit(200),
    listDocTypes(),
    listOrganisationsLite(),
    listAllFolders(),
    fileCounts(),
  ]);
  const docIds = pending.map((p) => String((p.payload as { documentId?: string }).documentId ?? "")).filter(Boolean);
  const docs = docIds.length
    ? await db
        .select({ id: documents.id, filename: documents.filename, mime: documents.mime, size: documents.size, deletedAt: documents.deletedAt, folderId: documents.folderId, createdAt: documents.createdAt })
        .from(documents)
        .where(inArray(documents.id, docIds))
    : [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const items = (await toInboxSuggestions(pending))
    .map((s) => {
      const docId = String((s.payload as { documentId?: string }).documentId ?? "");
      const d = byId.get(docId);
      if (!d || d.deletedAt) return null;
      return { suggestion: s, file: { id: d.id, filename: d.filename, mime: d.mime, size: d.size, folderId: d.folderId, createdAt: d.createdAt.toISOString() } };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  return {
    items,
    flagged: flaggedRows.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.filename,
      mime: d.mime,
      size: d.size,
      reason: d.childDataReason,
      folderId: d.folderId,
      createdAt: d.createdAt.toISOString(),
    })),
    docTypes: docTypes.map((d) => ({ key: d.key, tr: d.tr, en: d.en })),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    allFolders: allFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, aiOff: f.aiOff })),
    counts,
  };
}

export type CheckScreenData = Awaited<ReturnType<typeof loadCheckScreen>>;
