import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, EMBEDDING_DIMENSIONS, id, tsvector, updatedAt } from "./common";

export const folders = pgTable(
  "folders",
  {
    id: id(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "cascade" }),
    aiOff: boolean("ai_off").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("folders_parent_idx").on(t.parentId)],
);

/** Document types she edits in Ayarlar (Paperless "document types"). */
export const documentTypes = pgTable(
  "document_types",
  {
    id: id(),
    key: text("key").notNull(),
    nameTr: text("name_tr").notNull(),
    nameEn: text("name_en").notNull(),
    description: text("description"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("document_types_key_idx").on(t.key)],
);

export type KeyDate = { date: string; label: string };

export const documents = pgTable(
  "documents",
  {
    id: id(),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    currentVersionId: uuid("current_version_id"),
    docType: text("doc_type"),
    status: text("status").notNull().default("final"), // draft | final | signed
    language: text("language"), // tr | en | other
    periodLabel: text("period_label"),
    periodId: uuid("period_id"),
    summary: text("summary"),
    keyDates: jsonb("key_dates").$type<KeyDate[]>().notNull().default([]),
    source: text("source").notNull().default("upload"), // upload | email | export
    aiOff: boolean("ai_off").notNull().default(false),
    classificationStatus: text("classification_status").notNull().default("pending"), // pending | suggested | confirmed | flagged | skipped | failed
    childDataFlag: boolean("child_data_flag").notNull().default(false),
    childDataReason: text("child_data_reason"),
    starred: boolean("starred").notNull().default(false),
    pageCount: integer("page_count"),
    textStatus: text("text_status").notNull().default("pending"), // pending | done | partial | failed | none
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    meta: jsonb("meta").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("documents_folder_idx").on(t.folderId),
    index("documents_sha_idx").on(t.sha256),
    index("documents_type_idx").on(t.docType),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    note: text("note"),
    textContent: text("text_content"),
    createdAt: createdAt(),
  },
  (t) => [index("document_versions_doc_idx").on(t.documentId, t.version)],
);

/** Text passages extracted from a file version, one or more per page. */
export const docPassages = pgTable(
  "doc_passages",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    page: integer("page"),
    chunk: integer("chunk").notNull().default(0),
    text: text("text").notNull(),
    foldedText: text("folded_text").notNull(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(folded_text, ''))`),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    index("doc_passages_doc_idx").on(t.documentId),
    index("doc_passages_tsv_idx").using("gin", t.tsv),
  ],
);
