import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Search and activity are side effects here; the rules under test are about rows.
vi.mock("@/server/search/index-service", () => ({ unindexRecord: vi.fn(async () => {}), indexRecord: vi.fn(async () => {}) }));
vi.mock("@/server/services/reindex", () => ({ reindexEntity: vi.fn(async () => {}) }));
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock("@/server/services/documents-search-hooks", () => ({ purgeDocumentFiles: vi.fn(async () => {}), removeDocumentPassagesFromSearch: vi.fn(async () => {}) }));

process.env.DATABASE_URL = "memory://";

const { getDb } = await import("@/server/db/client");
const { documents, folders, notes } = await import("@/server/db/schema");
const { listTrash, moveToTrash, purge, purgeExpired, restoreFromTrash, daysLeft } = await import("@/server/services/trash");

type Db = Awaited<ReturnType<typeof getDb>>;
let db: Db;

async function folder(name: string, parentId: string | null = null) {
  const [f] = await db.insert(folders).values({ name, parentId }).returning();
  return f!;
}
async function file(title: string, folderId: string | null) {
  const [d] = await db.insert(documents).values({ title, filename: `${title}.pdf`, mime: "application/pdf", size: 10, sha256: title, folderId }).returning();
  return d!;
}
async function page(title: string, parentId: string | null = null) {
  const [n] = await db.insert(notes).values({ title, parentId }).returning();
  return n!;
}
const deletedIn = async (table: typeof documents | typeof folders | typeof notes, ids: string[]) =>
  (await db.select({ id: table.id, deletedAt: table.deletedAt }).from(table).where(inArray(table.id, ids))).filter((r) => r.deletedAt).map((r) => r.id).sort();

beforeAll(async () => {
  db = await getDb();
});

describe("trash: a folder takes what is in it", () => {
  it("moves files and subfolders with the folder, lists one row, and brings them back together", async () => {
    const top = await folder("Ortak raporları");
    const sub = await folder("2026", top.id);
    const a = await file("Rapor A", top.id);
    const b = await file("Rapor B", sub.id);
    const loose = await file("Ayrı silinen", sub.id);
    await moveToTrash("document", loose.id);

    await moveToTrash("folder", top.id);
    expect(await deletedIn(documents, [a.id, b.id])).toEqual([a.id, b.id].sort());
    expect(await deletedIn(folders, [sub.id])).toEqual([sub.id]);

    const items = await listTrash();
    const row = items.find((i) => i.id === top.id)!;
    expect(row.inside).toBe(3); // the subfolder and its two files
    expect(items.some((i) => i.id === a.id || i.id === b.id || i.id === sub.id)).toBe(false);
    // The file she deleted on its own before stays a row of its own.
    expect(items.some((i) => i.id === loose.id)).toBe(true);

    await restoreFromTrash("folder", top.id);
    expect(await deletedIn(documents, [a.id, b.id])).toEqual([]);
    expect(await deletedIn(folders, [top.id, sub.id])).toEqual([]);
    // Restoring the folder does not bring back what she deleted separately.
    expect(await deletedIn(documents, [loose.id])).toEqual([loose.id]);
  });

  it("puts a file back at the top when its folder is still in the trash", async () => {
    const f = await folder("Eski");
    const d = await file("Tek dosya", f.id);
    await moveToTrash("document", d.id);
    await moveToTrash("folder", f.id);
    await restoreFromTrash("document", d.id);
    const [row] = await db.select().from(documents).where(eq(documents.id, d.id));
    expect(row!.deletedAt).toBeNull();
    expect(row!.folderId).toBeNull();
  });

  it("deletes everything that went with the folder when it is deleted forever", async () => {
    const top = await folder("Silinecek");
    const sub = await folder("Alt", top.id);
    const a = await file("Bir", top.id);
    const b = await file("İki", sub.id);
    await moveToTrash("folder", top.id);
    await purge("folder", top.id);
    expect(await db.select().from(documents).where(inArray(documents.id, [a.id, b.id]))).toHaveLength(0);
    expect(await db.select().from(folders).where(inArray(folders.id, [top.id, sub.id]))).toHaveLength(0);
  });
});

describe("trash: a page takes its subpages", () => {
  it("hides, restores and purges subpages with their page", async () => {
    const p = await page("Saha notları");
    const c1 = await page("Adana", p.id);
    const c2 = await page("Köy 1", c1.id);
    await moveToTrash("note", p.id);
    expect(await deletedIn(notes, [c1.id, c2.id])).toEqual([c1.id, c2.id].sort());
    expect((await listTrash()).find((i) => i.id === p.id)!.inside).toBe(2);

    await restoreFromTrash("note", p.id);
    expect(await deletedIn(notes, [p.id, c1.id, c2.id])).toEqual([]);

    await moveToTrash("note", p.id);
    await purge("note", p.id);
    expect(await db.select().from(notes).where(inArray(notes.id, [p.id, c1.id, c2.id]))).toHaveLength(0);
  });
});

describe("trash: the 30-day clock", () => {
  it("empties only what is older than 30 days, with what went with it", async () => {
    const old = await folder("Çok eski");
    const inside = await file("İçindeki", old.id);
    const fresh = await file("Yeni silinen", null);
    await moveToTrash("folder", old.id);
    await moveToTrash("document", fresh.id);
    const long = new Date(Date.now() - 31 * 86_400_000);
    await db.update(folders).set({ deletedAt: long }).where(eq(folders.id, old.id));
    await db.update(documents).set({ deletedAt: long }).where(eq(documents.id, inside.id));

    expect(await purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(documents).where(eq(documents.id, inside.id))).toHaveLength(0);
    expect(await db.select().from(documents).where(eq(documents.id, fresh.id))).toHaveLength(1);
  });

  it("counts the days left", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(daysLeft(new Date("2026-10-24T09:00:00Z"), now)).toBe(30);
    expect(daysLeft(new Date("2026-09-25T12:00:00Z"), now)).toBe(1);
    expect(daysLeft(new Date("2026-09-01T12:00:00Z"), now)).toBe(0);
  });
});
