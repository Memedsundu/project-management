import { describe, expect, it } from "vitest";
import { batchRows, isBackup, parentsFirst, planRestore, repairReferences, type Backup, type BackupRelation } from "@/lib/backup-format";

const relations: BackupRelation[] = [
  { table: "documents", column: "folder_id", references: "folders", onDelete: "set null", notNull: false },
  { table: "document_versions", column: "document_id", references: "documents", onDelete: "cascade", notNull: true },
  { table: "doc_passages", column: "version_id", references: "document_versions", onDelete: "cascade", notNull: true },
  { table: "tasks", column: "parent_id", references: "tasks", onDelete: "cascade", notNull: false },
];
const polymorphic = [
  { table: "links", typeColumn: "from_type", idColumn: "from_id" },
  { table: "links", typeColumn: "to_type", idColumn: "to_id" },
];
const entityTables = { document: "documents", task: "tasks", folder: "folders" };
const meta = { relations, polymorphic, entityTables };

describe("repairReferences", () => {
  it("forgets a missing folder, drops what hangs on a missing record, and keeps going down the chain", () => {
    const { tables, dropped } = repairReferences(
      {
        folders: [{ id: "f1" }],
        documents: [
          { id: "d1", folder_id: "f1" },
          { id: "d2", folder_id: "gone" },
        ],
        document_versions: [
          { id: "v1", document_id: "d1" },
          { id: "v2", document_id: "held" },
        ],
        doc_passages: [
          { id: "p1", version_id: "v1" },
          { id: "p2", version_id: "v2" },
        ],
        tasks: [
          { id: "t1", parent_id: null },
          { id: "t2", parent_id: "t-trashed" },
          { id: "t3", parent_id: "t2" },
        ],
        links: [
          { id: "l1", from_type: "task", from_id: "t1", to_type: "document", to_id: "d1" },
          { id: "l2", from_type: "task", from_id: "t3", to_type: "document", to_id: "d1" },
          { id: "l3", from_type: "meeting", from_id: "m1", to_type: "document", to_id: "d1" },
        ],
      },
      meta,
    );
    expect(tables.documents).toEqual([
      { id: "d1", folder_id: "f1" },
      { id: "d2", folder_id: null },
    ]);
    expect(tables.document_versions!.map((v) => v.id)).toEqual(["v1"]);
    // The passage of the dropped version goes too, on a later round.
    expect(tables.doc_passages!.map((p) => p.id)).toEqual(["p1"]);
    // A sub-task of a dropped task goes with it.
    expect(tables.tasks!.map((t) => t.id)).toEqual(["t1"]);
    // Links to dropped records go; a kind the backup does not know stays as it is.
    expect(tables.links!.map((l) => l.id)).toEqual(["l1", "l3"]);
    expect(dropped).toEqual({ document_versions: 1, doc_passages: 1, tasks: 2, links: 1 });
  });

  it("does not change tables it does not need to", () => {
    const input = { folders: [{ id: "f1" }], documents: [{ id: "d1", folder_id: "f1" }] };
    const { tables, dropped } = repairReferences(input, meta);
    expect(tables.documents).toBe(input.documents);
    expect(dropped).toEqual({});
  });
});

describe("parentsFirst", () => {
  it("puts every parent before its children, wherever they started", () => {
    const rows = [
      { id: "c", parent_id: "b" },
      { id: "b", parent_id: "a" },
      { id: "x", parent_id: null },
      { id: "a", parent_id: null },
    ];
    const order = parentsFirst(rows).map((r) => r.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order).toHaveLength(4);
  });

  it("treats a row whose parent is not there as a top row, and cuts a loop", () => {
    const out = parentsFirst([
      { id: "a", parent_id: "missing" },
      { id: "p", parent_id: "q" },
      { id: "q", parent_id: "p" },
    ]);
    expect(out[0]).toEqual({ id: "a", parent_id: "missing" });
    // The loop's rows still come back, one of them without a parent.
    expect(out.map((r) => r.id).sort()).toEqual(["a", "p", "q"]);
    expect(out.filter((r) => r.parent_id === null)).toHaveLength(2);
  });
});

function backup(tables: Backup["tables"]): Backup {
  return { format: "uygulama-backup", version: 1, schema: "x", exportedAt: "2026-10-24T10:00:00.000Z", appName: "a", projectName: "p", locale: "tr", parts: 1, relations, polymorphic, entityTables, tables, files: {}, held: [] };
}

describe("planRestore", () => {
  const b = backup({
    folders: [],
    documents: [
      { id: "d1", current_version_id: "v1b" },
      { id: "d2", current_version_id: "v2" },
    ],
    document_versions: [
      { id: "v1a", document_id: "d1" },
      { id: "v1b", document_id: "d1" },
      { id: "v2", document_id: "d2" },
    ],
    doc_passages: [
      { id: "p1", version_id: "v1b" },
      { id: "p2", version_id: "v2" },
    ],
    links: [{ id: "l1", from_type: "document", from_id: "d2", to_type: "task", to_id: "t1" }],
    tasks: [{ id: "t1", parent_id: null }],
  });

  it("brings everything back when every file is there", () => {
    const plan = planRestore(b, new Set(["v1a", "v1b", "v2"]));
    expect(plan.skippedDocuments).toBe(0);
    expect(plan.skippedVersions).toBe(0);
    expect(plan.tables.documents).toHaveLength(2);
  });

  it("leaves out a document whose current file is missing, with its passages and links", () => {
    const plan = planRestore(b, new Set(["v1a", "v1b"]));
    expect(plan.tables.documents!.map((d) => d.id)).toEqual(["d1"]);
    expect(plan.tables.doc_passages!.map((p) => p.id)).toEqual(["p1"]);
    expect(plan.tables.links).toEqual([]);
    expect(plan.skippedDocuments).toBe(1);
  });

  it("keeps a document when only an older version is missing", () => {
    const plan = planRestore(b, new Set(["v1b", "v2"]));
    expect(plan.tables.documents).toHaveLength(2);
    expect(plan.tables.document_versions!.map((v) => v.id)).toEqual(["v1b", "v2"]);
    expect(plan.skippedVersions).toBe(1);
    expect(plan.skippedDocuments).toBe(0);
  });
});

describe("batchRows", () => {
  it("cuts by count and by size, and never leaves a big row out", () => {
    const small = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));
    expect(batchRows(small, 1_000_000, 3).map((b) => b.length)).toEqual([3, 3, 1]);
    const big = { id: "big", text: "x".repeat(500) };
    const sizes = batchRows([{ id: "a" }, big, { id: "b" }], 300, 100).map((b) => b.map((r) => r.id));
    expect(sizes).toEqual([["a"], ["big"], ["b"]]);
    expect(batchRows([])).toEqual([]);
  });
});

describe("isBackup", () => {
  it("knows the data file and nothing else", () => {
    expect(isBackup(backup({}))).toBe(true);
    expect(isBackup({ format: "other", version: 1, tables: {}, relations: [] })).toBe(false);
    expect(isBackup(null)).toBe(false);
  });
});
