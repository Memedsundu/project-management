/**
 * The data file inside an export ("veri/proje-verisi.json"): every table of
 * her project as rows keyed by column name, where each file sits in the ZIP,
 * and how the tables point at each other. The file describes its own
 * references, so the browser can check a backup before restoring it. These
 * helpers run on the server (export) and in the browser (restore).
 */

export const BACKUP_FORMAT = "uygulama-backup";
export const BACKUP_VERSION = 1;

/** Where the data file sits in the ZIP, by the language of the export. */
export const DATA_FILE_PATHS = ["veri/proje-verisi.json", "data/project-data.json"] as const;

export type BackupRow = Record<string, unknown>;

/** One foreign key: `table.column` points at `references.id`. */
export type BackupRelation = { table: string; column: string; references: string; onDelete: string; notNull: boolean };

/** A reference by kind and id (links, tags): the kind names an entity, `entityTables` its table. */
export type BackupPolymorphic = { table: string; typeColumn: string; idColumn: string };

export type BackupFile = { path: string; part: number; size: number; sha256: string };

/** Self-referencing tables and their parent column: rows are written parent first. */
export const PARENT_COLUMNS: Record<string, string> = { folders: "parent_id", notes: "parent_id", tasks: "parent_id", logframe_nodes: "parent_id" };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** The last database migration the export was made with. */
  schema: string;
  exportedAt: string;
  appName: string;
  projectName: string;
  locale: "tr" | "en";
  /** Parts of a split export; files are spread over them. */
  parts: number;
  relations: BackupRelation[];
  polymorphic: BackupPolymorphic[];
  entityTables: Record<string, string>;
  tables: Record<string, BackupRow[]>;
  /** document version id → the file in the ZIP. */
  files: Record<string, BackupFile>;
  /** Files held back by the child-data check: only their titles leave the app. */
  held: { title: string; reason: string | null }[];
};

export function isBackup(v: unknown): v is Backup {
  const b = v as Partial<Backup> | null;
  return Boolean(b && b.format === BACKUP_FORMAT && typeof b.version === "number" && b.tables && typeof b.tables === "object" && Array.isArray(b.relations));
}

/**
 * Makes the rows agree with each other, the way the database would: a row
 * whose parent is missing goes too (cascade) or forgets the parent (set
 * null), until nothing changes; then links and tags to missing records go.
 * Used when trashed or held records are left out of an export, and when a
 * restore has to leave out files that are not in the ZIP.
 */
export function repairReferences(
  tables: Record<string, BackupRow[]>,
  meta: { relations: BackupRelation[]; polymorphic: BackupPolymorphic[]; entityTables: Record<string, string> },
) {
  const out: Record<string, BackupRow[]> = { ...tables };
  const ids = new Map<string, Set<string>>();
  for (const [name, rows] of Object.entries(out)) ids.set(name, new Set(rows.map((r) => String(r.id))));
  const dropped: Record<string, number> = {};
  const drop = (table: string, n = 1) => (dropped[table] = (dropped[table] ?? 0) + n);

  for (let changed = true; changed; ) {
    changed = false;
    for (const rel of meta.relations) {
      const rows = out[rel.table];
      if (!rows?.length) continue;
      const target = ids.get(rel.references);
      let touched = false;
      const next: BackupRow[] = [];
      for (const r of rows) {
        const v = r[rel.column];
        if (v === null || v === undefined || target?.has(String(v))) {
          next.push(r);
          continue;
        }
        touched = true;
        if (rel.onDelete === "set null" && !rel.notNull) {
          next.push({ ...r, [rel.column]: null });
        } else {
          ids.get(rel.table)?.delete(String(r.id));
          drop(rel.table);
        }
      }
      if (touched) {
        out[rel.table] = next;
        changed = true;
      }
    }
  }

  for (const p of meta.polymorphic) {
    const rows = out[p.table];
    if (!rows?.length) continue;
    const next = rows.filter((r) => {
      const type = String(r[p.typeColumn] ?? "");
      const table = meta.entityTables[type];
      if (!table) return true;
      return ids.get(table)?.has(String(r[p.idColumn])) ?? false;
    });
    if (next.length !== rows.length) {
      drop(p.table, rows.length - next.length);
      out[p.table] = next;
    }
  }
  return { tables: out, dropped };
}

/** Rows of a self-referencing table, each parent before its children. A loop, if one ever existed, is cut. */
export function parentsFirst(rows: BackupRow[], column = "parent_id") {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const children = new Map<string, BackupRow[]>();
  const roots: BackupRow[] = [];
  for (const r of rows) {
    const parent = r[column];
    if (parent === null || parent === undefined || !byId.has(String(parent))) roots.push(r);
    else children.set(String(parent), [...(children.get(String(parent)) ?? []), r]);
  }
  const out: BackupRow[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const r = queue.shift()!;
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
    queue.push(...(children.get(id) ?? []));
  }
  for (const r of rows) if (!seen.has(String(r.id))) out.push({ ...r, [column]: null });
  return out;
}

/**
 * What a restore can bring back from the ZIPs she chose: documents whose
 * current file is missing are left out (with what hangs on them), as are
 * older versions without their file.
 */
export function planRestore(backup: Backup, available: Set<string>) {
  const tables: Record<string, BackupRow[]> = { ...backup.tables };
  const versions = tables.document_versions ?? [];
  const missing = new Set(versions.filter((v) => !available.has(String(v.id))).map((v) => String(v.id)));
  tables.document_versions = versions.filter((v) => !missing.has(String(v.id)));
  const docs = tables.documents ?? [];
  tables.documents = docs.filter((d) => !d.current_version_id || !missing.has(String(d.current_version_id)));
  const skippedDocuments = docs.length - tables.documents.length;
  const repaired = repairReferences(tables, backup);
  return { tables: repaired.tables, skippedDocuments, skippedVersions: missing.size, dropped: repaired.dropped };
}

/** Splits rows into batches small enough for one request (Vercel accepts 4.5 MB). */
export function batchRows(rows: BackupRow[], maxBytes = 2_000_000, maxRows = 500) {
  const encoder = new TextEncoder();
  const out: BackupRow[][] = [];
  let current: BackupRow[] = [];
  let size = 0;
  for (const r of rows) {
    const n = encoder.encode(JSON.stringify(r)).length;
    if (current.length && (size + n > maxBytes || current.length >= maxRows)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(r);
    size += n;
  }
  if (current.length) out.push(current);
  return out;
}
