import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/search/index-service", () => ({ unindexRecord: vi.fn(async () => {}), indexRecord: vi.fn(async () => {}) }));
vi.mock("@/server/services/reindex", () => ({ reindexEntity: vi.fn(async () => {}) }));
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => {}) }));

process.env.DATABASE_URL = "memory://";

const { getDb } = await import("@/server/db/client");
const { briefs } = await import("@/server/db/schema");
const { countUnreadBriefs, getBrief, lastBriefDays, listBriefs, markBriefsRead, plainPreview, unreadBriefs } = await import("@/server/services/briefs");
const { formatDayRange } = await import("@/lib/dates");

async function brief(kind: string, day: string, title: string, content = "- line") {
  const db = await getDb();
  const [row] = await db.insert(briefs).values({ kind, day, title, content }).returning();
  return row!;
}

beforeAll(async () => {
  await getDb();
});

describe("plainPreview", () => {
  it("turns Markdown into one line of words", () => {
    expect(plainPreview("## Bu hafta\n- **3** görevi bitirdin.\n- [Q3 raporu](/files/1) geldi.\n\n> Not")).toBe("Bu hafta 3 görevi bitirdin. Q3 raporu geldi. Not");
  });

  it("cuts a long text at a word-friendly length", () => {
    const out = plainPreview("kelime ".repeat(60), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("briefs", () => {
  it("offers the ones she has not opened, apart from the day's summary", async () => {
    const daily = await brief("daily", "2026-10-23", "Cuma, 23 Ekim");
    const weekly = await brief("weekly", "2026-10-23", "Haftalık değerlendirme · 19–25 Ekim");
    const check = await brief("partner_check", "2026-10-01", "Aylık ortak raporu kontrolü");
    await brief("recipe", "2026-10-22", "Ortak brifi", "## Ortak brifi\n- Durum: iyi");

    const unread = await unreadBriefs(2);
    expect(unread.total).toBe(3);
    expect(unread.items).toHaveLength(2);
    expect(unread.items.some((i) => i.id === daily.id)).toBe(false);
    expect(await countUnreadBriefs()).toBe(3);

    await markBriefsRead([weekly.id, check.id, daily.id]);
    expect(await countUnreadBriefs()).toBe(1);
    expect((await getBrief(weekly.id))?.read).toBe(true);

    // Newest day first, and a filter by kind.
    const all = await listBriefs();
    expect(all.map((b) => b.day)).toEqual(["2026-10-23", "2026-10-23", "2026-10-22", "2026-10-01"]);
    expect((await listBriefs({ kind: "recipe" })).map((b) => b.preview)).toEqual(["Ortak brifi Durum: iyi"]);

    expect(await lastBriefDays()).toEqual({ daily: "2026-10-23", weekly: "2026-10-23", partner_check: "2026-10-01" });
  });
});

describe("formatDayRange", () => {
  it("names a week in one month or across two", () => {
    expect(formatDayRange("2026-10-19", "2026-10-25", "tr")).toBe("19–25 Ekim");
    expect(formatDayRange("2026-09-28", "2026-10-04", "tr")).toBe("28 Eylül – 4 Ekim");
    expect(formatDayRange("2026-10-19", "2026-10-25", "en")).toBe("19–25 October");
  });
});
