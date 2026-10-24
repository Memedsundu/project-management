import "server-only";
import { and, asc, eq, getTableColumns, getTableName, isNull, notInArray, type Column } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { PARENT_COLUMNS, parentsFirst, repairReferences, type BackupPolymorphic, type BackupRelation, type BackupRow } from "@/lib/backup-format";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ENTITIES, ENTITY_TYPES } from "@/server/entities";

/** The last migration in drizzle/meta/_journal.json; a test keeps the two in step. */
export const SCHEMA_TAG = "0004_report_drafts";

/**
 * Her project's tables, in the order a restore writes them: every table
 * comes after the tables it points at, and the settings come last.
 */
export const BACKUP_TABLES: PgTable[] = [
  s.organisations,
  s.contacts,
  s.folders,
  s.documentTypes,
  s.periods,
  s.documents,
  s.documentVersions,
  s.docPassages,
  s.logframeNodes,
  s.activities,
  s.activityDependencies,
  s.seasons,
  s.holidays,
  s.indicators,
  s.indicatorTargets,
  s.indicatorValues,
  s.tasks,
  s.notes,
  s.noteVersions,
  s.meetingSeries,
  s.meetings,
  s.decisions,
  s.templates,
  s.reports,
  s.reportSections,
  s.collections,
  s.askThreads,
  s.visuals,
  s.assistantConversations,
  s.studioOutputs,
  s.recipes,
  s.briefs,
  s.tags,
  s.taggings,
  s.links,
  s.activityLog,
  s.aiSuggestions,
  s.aiRuns,
  s.glossaryTerms,
  s.savedViews,
  s.appSettings,
];

/**
 * Tables that belong to one installation and are made again there: the
 * person and her passkeys, sign-ins, devices for notifications, the job
 * queue and the search index.
 */
export const LOCAL_TABLES: PgTable[] = [s.users, s.passkeys, s.sessions, s.authChallenges, s.recoveryCodes, s.pushSubscriptions, s.sentNotifications, s.jobs, s.searchIndex];

/** Settings that belong to one installation: the push keys and a restore in progress. */
export const LOCAL_SETTINGS = ["vapid", "restore"];

/** Columns made again on restore from another column (the accent-free copy of a passage). */
export const DERIVED_COLUMNS: Record<string, string[]> = { doc_passages: ["folded_text"] };

export const POLYMORPHIC: BackupPolymorphic[] = [
  { table: "links", typeColumn: "from_type", idColumn: "from_id" },
  { table: "links", typeColumn: "to_type", idColumn: "to_id" },
  { table: "taggings", typeColumn: "entity_type", idColumn: "entity_id" },
];

export type ColumnKind = "date" | "string" | "number" | "boolean" | "json" | "array" | "skip";

export type ColumnInfo = { key: string; name: string; kind: ColumnKind; notNull: boolean; column: Column };

/** Columns worth keeping: generated search vectors and embeddings are made again. */
export function columnsOf(table: PgTable): ColumnInfo[] {
  return Object.entries(getTableColumns(table)).map(([key, col]) => {
    let kind: ColumnKind;
    if (col.generated || col.columnType === "PgVector" || col.columnType === "PgCustomColumn") kind = "skip";
    else if (col.dataType === "date") kind = "date";
    else if (col.dataType === "number" || col.dataType === "bigint") kind = "number";
    else if (col.dataType === "boolean" || col.dataType === "json" || col.dataType === "array") kind = col.dataType;
    else kind = "string";
    return { key, name: col.name, kind, notNull: col.notNull, column: col };
  });
}

export function tableByName() {
  return new Map(BACKUP_TABLES.map((t) => [getTableName(t), t]));
}

/** Foreign keys between the tables in the backup, as the database enforces them. */
export function backupRelations(): BackupRelation[] {
  const out: BackupRelation[] = [];
  for (const table of BACKUP_TABLES) {
    const cfg = getTableConfig(table);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const col = ref.columns[0]!;
      out.push({ table: cfg.name, column: col.name, references: getTableName(ref.foreignTable), onDelete: fk.onDelete ?? "no action", notNull: col.notNull });
    }
  }
  return out;
}

/** Entity kinds (as links and tags name them) and their tables. */
export function entityTables(): Record<string, string> {
  return Object.fromEntries(ENTITY_TYPES.map((type) => [type, getTableName(ENTITIES[type].table)]));
}

function toJson(value: unknown, kind: ColumnKind) {
  if (value === null || value === undefined) return null;
  if (kind === "date" && value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Every table as rows keyed by column name. Trashed records stay out, as do
 * files the child-data check holds; whatever pointed at them is repaired
 * the way the database would (cascade or set null).
 */
export async function collectTables() {
  const db = await getDb();
  const raw: Record<string, BackupRow[]> = {};
  for (const table of BACKUP_TABLES) {
    const name = getTableName(table);
    const derived = new Set(DERIVED_COLUMNS[name] ?? []);
    const cols = columnsOf(table).filter((c) => c.kind !== "skip" && !derived.has(c.name));
    const pick = Object.fromEntries(cols.map((c) => [c.key, c.column])) as Record<string, AnyPgColumn>;
    const all = getTableColumns(table);
    const where = [];
    if ("deletedAt" in all) where.push(isNull(all.deletedAt!));
    if (table === s.documents) where.push(eq(s.documents.childDataFlag, false));
    if (table === s.appSettings) where.push(notInArray(s.appSettings.key, LOCAL_SETTINGS));
    const order = "createdAt" in all ? [asc(all.createdAt!)] : [];
    const rows = (await db
      .select(pick)
      .from(table)
      .where(where.length ? and(...where) : undefined)
      .orderBy(...order)) as Record<string, unknown>[];
    raw[name] = rows.map((r) => Object.fromEntries(cols.map((c) => [c.name, toJson(r[c.key], c.kind)])));
  }
  const relations = backupRelations();
  const meta = { relations, polymorphic: POLYMORPHIC, entityTables: entityTables() };
  const { tables, dropped } = repairReferences(raw, meta);
  for (const [name, column] of Object.entries(PARENT_COLUMNS)) if (tables[name]) tables[name] = parentsFirst(tables[name], column);
  const held = await db
    .select({ title: s.documents.title, reason: s.documents.childDataReason })
    .from(s.documents)
    .where(and(isNull(s.documents.deletedAt), eq(s.documents.childDataFlag, true)))
    .orderBy(asc(s.documents.title));
  return { tables, dropped, held, ...meta };
}

export type CollectedTables = Awaited<ReturnType<typeof collectTables>>;
