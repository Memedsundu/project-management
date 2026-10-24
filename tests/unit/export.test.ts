import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { count, eq, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Search, activity and the session are side effects here; the rules under test are about rows.
vi.mock("@/server/search/index-service", () => ({ unindexRecord: vi.fn(async () => {}), indexRecord: vi.fn(async () => {}) }));
vi.mock("@/server/services/reindex", () => ({ reindexEntity: vi.fn(async () => {}), INDEXERS: {} }));
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/server/auth/session", () => ({ assertUser: vi.fn(async () => ({ id: "u", name: "Test" })), getCurrentUser: vi.fn(async () => ({ id: "u", name: "Test" })) }));

process.env.DATABASE_URL = "memory://";
process.env.LOCAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "export-test-"));

const schema = await import("@/server/db/schema");
const { getDb } = await import("@/server/db/client");
const { BACKUP_TABLES, LOCAL_TABLES, SCHEMA_TAG, backupRelations, collectTables } = await import("@/server/export/backup");
const { beginRestore, finishRestore, insertRows, prepareFiles, projectIsEmpty } = await import("@/server/export/restore");
const { layoutArchive, makeCtx, relativeHref, relinkMarkdown, safeSegment } = await import("@/server/export/archive");
const { archiveWords } = await import("@/server/export/words");
const { PARENT_COLUMNS, batchRows, parentsFirst } = await import("@/lib/backup-format");
const { foldText } = await import("@/lib/fold");
const { getSetting, setSetting } = await import("@/server/services/settings");
const { closeProject, reopenProject } = await import("@/server/services/closure");
const { act } = await import("@/server/action");
const { scheduleDue } = await import("@/server/jobs/schedule");
const { putObject } = await import("@/server/storage");

type Db = Awaited<ReturnType<typeof getDb>>;
let db: Db;

beforeAll(async () => {
  db = await getDb();
});

describe("what a backup holds", () => {
  it("covers every table: each one is either her project or this installation", () => {
    const all = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
    const known = new Set([...BACKUP_TABLES, ...LOCAL_TABLES].map((t) => getTableName(t)));
    expect(all.map((t) => getTableName(t)).filter((n) => !known.has(n))).toEqual([]);
  });

  it("writes every table after the tables it points at, and points at nothing local", () => {
    const order = BACKUP_TABLES.map((t) => getTableName(t));
    const local = new Set(LOCAL_TABLES.map((t) => getTableName(t)));
    for (const r of backupRelations()) {
      expect(local.has(r.references), `${r.table}.${r.column} → ${r.references}`).toBe(false);
      if (r.references === r.table) expect(PARENT_COLUMNS[r.table], `${r.table} parent column`).toBe(r.column);
      else expect(order.indexOf(r.references), `${r.table} after ${r.references}`).toBeLessThan(order.indexOf(r.table));
    }
  });

  it("names the last database migration", () => {
    const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    expect(SCHEMA_TAG).toBe(journal.entries.at(-1)!.tag);
  });
});

describe("export and restore, round trip", () => {
  it("brings back exactly what was exported, and leaves held files and the trash out", async () => {
    const s = schema;
    const [org] = await db.insert(s.organisations).values({ name: "Kır Çocukları Derneği", shortName: "KÇD" }).returning();
    await db.insert(s.contacts).values({ name: "Ayşe Demir", organisationId: org!.id });
    const [top] = await db.insert(s.folders).values({ name: "Ortak raporları" }).returning();
    const [sub] = await db.insert(s.folders).values({ name: "2026", parentId: top!.id }).returning();
    const [doc] = await db.insert(s.documents).values({ title: "Rapor Q3", filename: "Rapor Q3.pdf", mime: "application/pdf", size: 10, sha256: "a".repeat(64), folderId: sub!.id }).returning();
    const [ver] = await db.insert(s.documentVersions).values({ documentId: doc!.id, version: 1, storageKey: "documents/2026/10/x/Rapor Q3.pdf", filename: "Rapor Q3.pdf", mime: "application/pdf", size: 10, sha256: "a".repeat(64), textContent: "Şanlıurfa'da hasat" }).returning();
    await db.update(s.documents).set({ currentVersionId: ver!.id }).where(eq(s.documents.id, doc!.id));
    await db.insert(s.docPassages).values({ documentId: doc!.id, versionId: ver!.id, page: 1, text: "Şanlıurfa'da hasat", foldedText: foldText("Şanlıurfa'da hasat") });
    const [held] = await db.insert(s.documents).values({ title: "liste", filename: "liste.xlsx", mime: "application/xlsx", size: 5, sha256: "b".repeat(64), childDataFlag: true, childDataReason: "adlar" }).returning();
    await db.insert(s.documents).values({ title: "silinen", filename: "silinen.pdf", mime: "application/pdf", size: 5, sha256: "c".repeat(64), deletedAt: new Date() });
    const [page] = await db.insert(s.notes).values({ title: "Saha planı", content: [{ type: "paragraph", content: [{ type: "text", text: "Ekim" }] }] as never }).returning();
    await db.insert(s.notes).values({ title: "Ekim ziyareti", parentId: page!.id });
    const [task] = await db.insert(s.tasks).values({ title: "Ortak raporunu oku", dueDate: "2026-11-02" }).returning();
    await db.insert(s.tasks).values({ title: "Sayıları kontrol et", parentId: task!.id });
    const [meeting] = await db.insert(s.meetings).values({ title: "Ortaklar toplantısı", startsAt: new Date("2026-10-20T07:00:00Z") }).returning();
    await db.insert(s.decisions).values({ text: "Raporlar ayın 20'sine kadar", decidedOn: "2026-10-20", meetingId: meeting!.id, organisationId: org!.id });
    const [tag] = await db.insert(s.tags).values({ name: "saha", slug: "saha" }).returning();
    await db.insert(s.taggings).values([
      { tagId: tag!.id, entityType: "task", entityId: task!.id },
      { tagId: tag!.id, entityType: "document", entityId: held!.id },
    ]);
    await db.insert(s.links).values([
      { fromType: "meeting", fromId: meeting!.id, toType: "document", toId: doc!.id },
      { fromType: "task", fromId: task!.id, toType: "document", toId: held!.id },
    ]);
    await setSetting("profile", { ...(await getSetting("profile")), projectName: "Hasat" });
    await setSetting("vapid", { publicKey: "pub", privateKey: "priv" });

    const before = await collectTables();
    expect(before.held).toEqual([{ title: "liste", reason: "adlar" }]);
    expect(before.tables.documents!.map((d) => d.title)).toEqual(["Rapor Q3"]);
    // What pointed at the held file stays out with it.
    expect(before.tables.taggings).toHaveLength(1);
    expect(before.tables.links).toHaveLength(1);
    // Search columns are made again, not carried.
    expect(before.tables.doc_passages![0]).not.toHaveProperty("folded_text");
    expect(before.tables.doc_passages![0]).not.toHaveProperty("tsv");
    expect(before.tables.app_settings!.some((r) => r.key === "vapid")).toBe(false);

    // A workspace with her data in it cannot be restored over.
    expect(await projectIsEmpty()).toBe(false);
    await expect(beginRestore({ exportedAt: "x", projectName: "Hasat" })).rejects.toThrow();

    // After an unfinished restore it can; the first step clears her project and keeps this installation's settings.
    await setSetting("restore", { startedAt: "2026-10-24T10:00:00Z", exportedAt: "x", projectName: "Hasat" });
    const { order } = await beginRestore({ exportedAt: "2026-10-24T10:00:00Z", projectName: "Hasat" });
    expect(await projectIsEmpty()).toBe(true);
    expect((await db.select({ n: count() }).from(s.documents))[0]!.n).toBe(0);
    expect(await getSetting("vapid")).toEqual({ publicKey: "pub", privateKey: "priv" });

    const wire = JSON.parse(JSON.stringify(before.tables)) as typeof before.tables;
    for (const name of order) {
      let rows = wire[name] ?? [];
      if (PARENT_COLUMNS[name]) rows = parentsFirst(rows, PARENT_COLUMNS[name]);
      for (const [i, batch] of batchRows(rows, 2_000, 3).entries()) await insertRows(name, batch, { reset: i === 0 });
    }
    // A batch sent twice (a retry after a dropped connection) changes nothing.
    await insertRows("tasks", wire.tasks!.slice(0, 1));
    await finishRestore();

    const after = await collectTables();
    expect(after.tables).toEqual(before.tables);
    expect(after.held).toEqual([]);
    const [passage] = await db.select().from(s.docPassages);
    expect(passage!.foldedText).toBe(foldText("Şanlıurfa'da hasat"));
    expect(await getSetting("restore")).toBeNull();
    expect((await getSetting("profile")).projectName).toBe("Hasat");
    expect(await getSetting("vapid")).toEqual({ publicKey: "pub", privateKey: "priv" });
    // Once finished, the restore steps refuse to run.
    await expect(insertRows("tasks", [])).rejects.toThrow();
  });

  it("keeps a file already in storage and gives the others an upload slot under a safe key", async () => {
    await setSetting("restore", { startedAt: "2026-10-24T10:00:00Z", exportedAt: "x", projectName: "p" });
    const key = "documents/2026/10/0b6f3b8e-8c1c-4f7a-9d61-3c1f2a4b5c6d/Rapor.pdf";
    await putObject(key, Buffer.from("0123456789"), "application/pdf");
    const base = { sha256: "a".repeat(64), name: "Rapor.pdf", type: "application/pdf" };
    const out = await prepareFiles([
      { ...base, versionId: "00000000-0000-4000-8000-000000000001", key, size: 10 },
      { ...base, versionId: "00000000-0000-4000-8000-000000000002", key, size: 11 },
      { ...base, versionId: "00000000-0000-4000-8000-000000000003", key: "../../etc/passwd", size: 3 },
    ]);
    expect(out[0]).toEqual({ versionId: "00000000-0000-4000-8000-000000000001", key, status: "stored" });
    expect(out[1]!.status).toBe("upload");
    // Another file already sits under that key: this one gets a fresh key.
    expect(out[1]!.key).not.toBe(key);
    expect(out[2]!.status).toBe("upload");
    expect(out[2]!.key).toMatch(/^documents\/\d{4}\/\d{2}\//);
    await setSetting("restore", null);
  });
});

describe("closing the project", () => {
  it("makes the workspace read-only and stops scheduled work, until she reopens it", async () => {
    await closeProject();
    const archive = await getSetting("archive");
    expect(archive.readOnly).toBe(true);
    expect(archive.archivedAt).toBeTruthy();
    const change = await act(async () => "changed");
    expect(change).toMatchObject({ ok: false, code: "read_only" });
    // Reading and the reopen itself still work.
    expect(await act(async () => "read", { write: false })).toEqual({ ok: true, data: "read" });
    expect(await scheduleDue()).toEqual([]);

    await reopenProject();
    expect(await getSetting("archive")).toEqual({ readOnly: false, archivedAt: null });
    expect(await act(async () => "changed")).toEqual({ ok: true, data: "changed" });
  });
});

describe("the archive layout", () => {
  const w = archiveWords(false);
  const tables = {
    folders: [
      { id: "f1", name: "Ortak raporları", parent_id: null },
      { id: "f2", name: "2026", parent_id: "f1" },
      { id: "f3", name: "a/b: c?", parent_id: null },
    ],
    documents: [
      { id: "d1", folder_id: "f2", filename: "Rapor.pdf", current_version_id: "v2" },
      { id: "d2", folder_id: "f2", filename: "rapor.pdf", current_version_id: "v3" },
      { id: "d3", folder_id: null, filename: "CON.txt", current_version_id: "v4" },
    ],
    document_versions: [
      { id: "v1", document_id: "d1", version: 1, filename: "Rapor.pdf", size: 600, created_at: "2026-10-01T10:00:00Z" },
      { id: "v2", document_id: "d1", version: 2, filename: "Rapor.pdf", size: 600, created_at: "2026-10-02T10:00:00Z" },
      { id: "v3", document_id: "d2", version: 1, filename: "rapor.pdf", size: 600, created_at: "2026-10-03T10:00:00Z" },
      { id: "v4", document_id: "d3", version: 1, filename: "CON.txt", size: 10, created_at: "2026-10-03T10:00:00Z" },
    ],
    notes: [
      { id: "n1", title: "Saha planı", parent_id: null, kind: "page" },
      { id: "n2", title: "Ekim", parent_id: "n1", kind: "page" },
      { id: "n3", title: "", parent_id: null, kind: "daily", daily_date: "2026-10-24" },
    ],
    meetings: [{ id: "m1", title: "Ortaklar", starts_at: "2026-10-20T07:00:00.000Z" }],
  };

  it("puts files in their folders with names every system accepts, and older versions apart", () => {
    const layout = layoutArchive(tables, w, { files: true });
    expect(layout.folders.get("f2")).toBe("Belgeler/Ortak raporları/2026");
    expect(layout.folders.get("f3")).toBe("Belgeler/a b c");
    // Same name in another case: Windows and macOS would see one file.
    expect([layout.documents.get("d1"), layout.documents.get("d2")].sort()).toEqual(["Belgeler/Ortak raporları/2026/Rapor (2).pdf", "Belgeler/Ortak raporları/2026/rapor.pdf"]);
    expect(layout.documents.get("d3")).toBe("Belgeler/CON_.txt");
    const older = layout.files.find((f) => f.versionId === "v1")!;
    expect(older.current).toBe(false);
    expect(older.path).toBe("Belgeler/_Önceki sürümler/Ortak raporları/2026/Rapor (sürüm 1).pdf");
    expect(layout.notes.get("n2")).toBe("Notlar/Saha planı/Ekim");
    expect(layout.notes.get("n3")).toBe("Notlar/Günlük notlar/2026-10-24");
    expect(layout.meetings.get("m1")).toBe("Toplantılar/2026-10-20 Ortaklar");
    expect(layout.parts).toBe(1);
  });

  it("spreads big files over parts, current files first", () => {
    const layout = layoutArchive(tables, w, { files: true, partBytes: 1000 });
    expect(layout.parts).toBe(3);
    expect(layout.files.filter((f) => f.current).map((f) => f.part)).toEqual([1, 1, 2]);
    expect(layout.files.find((f) => f.versionId === "v1")!.part).toBe(3);
    expect(layoutArchive(tables, w, { files: false }).files).toEqual([]);
  });

  it("links pages to each other and to files with relative paths", () => {
    expect(relativeHref("Notlar/Saha planı/Ekim.md", "Belgeler/Ortak raporları/Rapor.pdf")).toBe("../../Belgeler/Ortak%20raporlar%C4%B1/Rapor.pdf");
    expect(relativeHref("Notlar/Saha planı.md", "Notlar/Saha planı/Ekim.md")).toBe("./Saha%20plan%C4%B1/Ekim.md");
    const note = "11111111-1111-4111-8111-111111111111";
    const doc = "22222222-2222-4222-8222-222222222222";
    const t = {
      folders: [],
      documents: [{ id: doc, folder_id: null, filename: "Rapor.pdf", current_version_id: "v" }],
      document_versions: [{ id: "v", document_id: doc, version: 1, filename: "Rapor.pdf", size: 1 }],
      notes: [{ id: note, title: "Plan", parent_id: null, kind: "page" }],
    };
    const ctx = makeCtx(t, layoutArchive(t, w, { files: true }), w, false, "https://app.example");
    const md = `[Plan](app://note/${note}) [Rapor](/files/d/${doc}) [Gitti](/notes/33333333-3333-4333-8333-333333333333) [Ayarlar](/settings)`;
    // A page that is not in the ZIP keeps its words; app pages that are not records point at the app.
    expect(relinkMarkdown(md, "Notlar/Saha planı.md", ctx.resolve, ctx.origin)).toBe("[Plan](./Plan.md) [Rapor](../Belgeler/Rapor.pdf) Gitti [Ayarlar](https://app.example/settings)");
  });

  it("makes safe names", () => {
    expect(safeSegment('  rapor: "son" hali.  ')).toBe("rapor son hali");
    expect(safeSegment("aux")).toBe("aux_");
    expect(safeSegment("...")).toBe("_");
    expect(safeSegment("x".repeat(200)).length).toBe(80);
  });
});
