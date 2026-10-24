import "server-only";
import { and, asc, count, getTableColumns, getTableName, gt, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { BackupRow } from "@/lib/backup-format";
import { foldText } from "@/lib/fold";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ENTITIES, type EntityType } from "@/server/entities";
import { reserveUploadKey } from "@/server/files/uploads";
import { enqueue } from "@/server/jobs/queue";
import { INDEXERS, reindexEntity } from "@/server/services/reindex";
import { getSetting, setSetting } from "@/server/services/settings";
import { newStorageKey, objectSize, storageReady } from "@/server/storage";
import { BACKUP_TABLES, columnsOf, LOCAL_SETTINGS, tableByName, type ColumnInfo } from "./backup";

/**
 * Restoring an export into an empty workspace: the browser reads the ZIP,
 * sends the files straight to storage and the rows in small batches; the
 * server checks each step. A restore that stops halfway can simply be run
 * again: it starts by clearing what the last attempt wrote, and files that
 * already reached storage are not sent twice.
 */

/** What she writes herself; a workspace with none of it (outside the trash) is empty. */
const CONTENT: PgTable[] = [s.tasks, s.meetings, s.documents, s.folders, s.organisations, s.contacts, s.activities, s.indicators, s.logframeNodes, s.reports, s.decisions, s.collections];

export async function projectIsEmpty() {
  const db = await getDb();
  const counts = await Promise.all([
    ...CONTENT.map((t) => {
      const cols = getTableColumns(t);
      return db
        .select({ n: count() })
        .from(t)
        .where("deletedAt" in cols ? isNull(cols.deletedAt!) : undefined);
    }),
    // The assistant's memory page and empty daily pages appear on their own.
    db
      .select({ n: count() })
      .from(s.notes)
      .where(and(isNull(s.notes.deletedAt), ne(s.notes.kind, "memory"), or(ne(s.notes.title, ""), ne(s.notes.plainText, "")))),
  ]);
  return counts.every(([r]) => Number(r?.n ?? 0) === 0);
}

export async function restoreState() {
  const [marker, empty] = await Promise.all([getSetting("restore"), projectIsEmpty()]);
  return { inProgress: marker, allowed: empty || Boolean(marker) };
}

async function clearTable(table: PgTable) {
  const db = await getDb();
  if (table === s.appSettings) await db.delete(s.appSettings).where(notInArray(s.appSettings.key, LOCAL_SETTINGS));
  else await db.delete(table);
}

/** Step 1: only on an empty workspace (or after an unfinished restore); clears the project's tables. */
export async function beginRestore(meta: { exportedAt: string; projectName: string }) {
  if (!storageReady()) throw new UserError("Dosya deposu hazır değil.", "storage_not_ready");
  const state = await restoreState();
  if (!state.allowed) throw new UserError("Geri yükleme yalnızca boş bir çalışma alanında yapılabilir.", "not_empty");
  await setSetting("restore", { startedAt: new Date().toISOString(), exportedAt: meta.exportedAt.slice(0, 40), projectName: meta.projectName.slice(0, 200) });
  // Children first, so no row is left pointing at a parent that is gone.
  for (const table of [...BACKUP_TABLES].reverse()) await clearTable(table);
  const db = await getDb();
  await db.delete(s.searchIndex);
  await db.delete(s.jobs);
  return { order: BACKUP_TABLES.map((t) => getTableName(t)) };
}

async function assertRestoring() {
  if (!(await getSetting("restore"))) throw new UserError("Geri yükleme başlamamış.", "no_restore");
}

function convert(v: unknown, c: ColumnInfo) {
  if (v === null || v === undefined) return null;
  switch (c.kind) {
    case "date":
      return new Date(String(v));
    case "number":
      return typeof v === "number" ? v : Number(v);
    case "boolean":
      return v === true || v === "true";
    case "array":
      return Array.isArray(v) ? v : [];
    case "json":
      return v;
    default:
      return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

/** A backup row (keyed by column name) as values for an insert; unknown columns are ignored, missing ones take their default. */
export function rowValues(tableName: string, row: BackupRow, cols: ColumnInfo[]) {
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    if (!(c.name in row)) continue;
    const v = convert(row[c.name], c);
    if (v instanceof Date && Number.isNaN(v.getTime())) throw new UserError(`Geçersiz tarih: ${tableName}.${c.name}`, "invalid_backup");
    if (v === null && c.notNull) continue;
    out[c.key] = v;
  }
  // The accent-free copy search uses is made again here, not carried in the backup.
  if (tableName === "doc_passages") out.foldedText = foldText(String(row.text ?? ""));
  return out;
}

/** Step 3: one batch of one table. The first batch of each table clears it, so a restore can run twice. */
export async function insertRows(tableName: string, rows: BackupRow[], opts: { reset?: boolean } = {}) {
  await assertRestoring();
  const table = tableByName().get(tableName);
  if (!table) throw new UserError(`Bilinmeyen tablo: ${tableName}`, "invalid_backup");
  if (opts.reset) await clearTable(table);
  const cols = columnsOf(table).filter((c) => c.kind !== "skip");
  const values = rows.filter((r) => tableName !== "app_settings" || !LOCAL_SETTINGS.includes(String(r.key))).map((r) => rowValues(tableName, r, cols));
  const db = await getDb();
  for (let i = 0; i < values.length; i += 200) {
    await db
      .insert(table)
      .values(values.slice(i, i + 200) as never)
      .onConflictDoNothing();
  }
  return values.length;
}

const KEY = /^documents\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/[^/\\]{1,200}$/;

export type RestoreFileIn = { versionId: string; key: string; size: number; sha256: string; name: string; type: string };
export type RestoreFileOut = { versionId: string; key: string } & ({ status: "stored" } | { status: "upload"; uploadId: string; mode: "blob" | "local" });

/**
 * Step 2, for a batch of files: a file already in storage with the same size
 * stays (restoring into the same store); the rest get an upload slot, under
 * the backup's own key when it is a valid one.
 */
export async function prepareFiles(items: RestoreFileIn[]): Promise<RestoreFileOut[]> {
  await assertRestoring();
  const out: RestoreFileOut[] = [];
  for (const it of items) {
    let key = KEY.test(it.key) && !it.key.includes("..") ? it.key : newStorageKey(it.name);
    const stored = await objectSize(key);
    if (stored === it.size) {
      out.push({ versionId: it.versionId, key, status: "stored" });
      continue;
    }
    // Something else sits under that key: the file gets a fresh one.
    if (stored !== null) key = newStorageKey(it.name);
    const slot = await reserveUploadKey({ name: it.name, size: it.size, type: it.type, sha256: it.sha256 }, key);
    out.push({ versionId: it.versionId, key, status: "upload", uploadId: slot.uploadId, mode: slot.mode });
  }
  return out;
}

const INDEX_TYPES = Object.keys(INDEXERS) as EntityType[];
export type IndexCursor = { type: number; after: string | null };

/** Step 4: the search index, rebuilt in slices that each fit one request. */
export async function reindexSlice(cursor: IndexCursor | null, budgetMs = 15_000) {
  await assertRestoring();
  const db = await getDb();
  if (!cursor) {
    await db.delete(s.searchIndex);
    cursor = { type: 0, after: null };
  }
  const started = Date.now();
  let done = 0;
  while (cursor.type < INDEX_TYPES.length && Date.now() - started < budgetMs) {
    const type = INDEX_TYPES[cursor.type]!;
    const table = ENTITIES[type].table;
    const where: SQL[] = [];
    if (cursor.after) where.push(gt(table.id, cursor.after));
    if ("deletedAt" in table) where.push(isNull(table.deletedAt));
    const rows = (await db
      .select({ id: table.id })
      .from(table)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(table.id))
      .limit(40)) as { id: string }[];
    for (const r of rows) {
      await reindexEntity(type, r.id);
      done++;
    }
    cursor = rows.length < 40 ? { type: cursor.type + 1, after: null } : { type: cursor.type, after: rows.at(-1)!.id };
  }
  return { cursor: cursor.type >= INDEX_TYPES.length ? null : cursor, done };
}

/** Step 5: the restore is over; embeddings for search by meaning are made in the background. */
export async function finishRestore() {
  await assertRestoring();
  await setSetting("restore", null);
  await enqueue("embed_pending", {}, { dedupeKey: "embed_pending" });
  const db = await getDb();
  const [docs] = await db.select({ n: count() }).from(s.documents).where(isNull(s.documents.deletedAt));
  return { documents: Number(docs?.n ?? 0) };
}

/** Counts of what a finished restore brought back, for her to compare with the summary she saw. */
export async function restoredCounts(names: string[]) {
  const db = await getDb();
  const byName = tableByName();
  const out: Record<string, number> = {};
  for (const name of names) {
    const table = byName.get(name);
    if (!table) continue;
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = Number(r?.n ?? 0);
  }
  return out;
}

