import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Search and activity are side effects here; the rules under test are about the text.
vi.mock("@/server/search/index-service", () => ({ unindexRecord: vi.fn(async () => {}), indexRecord: vi.fn(async () => {}) }));
vi.mock("@/server/services/reindex", () => ({ reindexEntity: vi.fn(async () => {}) }));
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => {}) }));

process.env.DATABASE_URL = "memory://";

const { getDb } = await import("@/server/db/client");
const { addSection, acceptDraft, createReport, duplicateReport, getReport, numberCheckOf, setReportSources, setSectionDraft, shiftCitations, textHash, updateSection } = await import(
  "@/server/services/reports"
);
const { reportForExport } = await import("@/server/views/report-export");
const { pngName } = await import("@/components/reports/one-pager-canvas");

type Cite = { n: number; sourceType: string; sourceId: string; title: string; page?: number | null };
const docA = randomUUID();
const docB = randomUUID();
const cite = (n: number, sourceId: string, title: string, page: number | null = null): Cite => ({ n, sourceType: "document", sourceId, title, page });

async function reportWith(sections: { heading: string; content: string; citations: Cite[] }[]) {
  const r = await createReport({ title: "Quarterly report", language: "en-GB" });
  const first = (await getReport(r.id))!.sections[0]!;
  await updateSection(first.id, { heading: sections[0]!.heading, content: sections[0]!.content, citations: sections[0]!.citations });
  for (const s of sections.slice(1)) {
    const added = await addSection(r.id, { heading: s.heading });
    await updateSection(added.id, { content: s.content, citations: s.citations });
  }
  return r.id;
}

beforeAll(async () => {
  await getDb();
});

describe("shiftCitations", () => {
  it("moves an appended draft's numbers past the ones already in the section", () => {
    const out = shiftCitations("Teams reached 412 households [1][2].", [cite(1, docA, "A"), cite(2, docB, "B")], 3);
    expect(out.content).toBe("Teams reached 412 households [4][5].");
    expect(out.citations.map((c) => c.n)).toEqual([4, 5]);
  });

  it("leaves brackets that are not citations as written", () => {
    expect(shiftCitations("See annex [9] and the visit note [1].", [cite(1, docA, "A")], 2).content).toBe("See annex [9] and the visit note [3].");
  });

  it("changes nothing when there is nothing before it", () => {
    const list = [cite(1, docA, "A")];
    expect(shiftCitations("Text [1].", list, 0)).toEqual({ content: "Text [1].", citations: list });
  });
});

describe("number check bookkeeping", () => {
  it("gives the same text the same fingerprint and any edit a new one", () => {
    expect(textHash("We reached 380 households.")).toBe(textHash("We reached 380 households."));
    expect(textHash("We reached 380 households.")).not.toBe(textHash("We reached 398 households."));
    expect(textHash("")).toMatch(/^[0-9a-z]+$/);
  });

  it("reads a stored check, and treats old empty lists as never checked", () => {
    expect(numberCheckOf([])).toBeNull();
    expect(numberCheckOf(null)).toBeNull();
    expect(numberCheckOf({ at: "2026-10-24T10:00:00Z", items: [] })).toBeNull();
    expect(numberCheckOf({ at: "2026-10-24T10:00:00Z", hash: "abc", items: [] })).toEqual({ at: "2026-10-24T10:00:00Z", hash: "abc", periodLabel: null, items: [] });
  });
});

describe("accepting Claude's draft", () => {
  const draft = (content: string, citations: Cite[]) => ({ content, citations, at: new Date().toISOString(), instruction: null, model: null });

  it("appends after her text with the draft's sources numbered after hers", async () => {
    const id = await reportWith([{ heading: "Summary", content: "Our own paragraph [1].", citations: [cite(1, docA, "Visit note")] }]);
    const section = (await getReport(id))!.sections[0]!;
    await setSectionDraft(section.id, draft("Claude's paragraph [1][2].", [cite(1, docB, "IPTT"), cite(2, docA, "Visit note", 3)]));

    const saved = await acceptDraft(section.id, "append");
    expect(saved.content).toBe("Our own paragraph [1].\n\nClaude's paragraph [2][3].");
    expect(saved.citations.map((c) => [c.n, c.title])).toEqual([
      [1, "Visit note"],
      [2, "IPTT"],
      [3, "Visit note"],
    ]);
    expect(saved.draft).toBeNull();
  });

  it("replaces her text when she uses the draft, and appends into an empty section without shifting", async () => {
    const id = await reportWith([{ heading: "Summary", content: "Old text [1].", citations: [cite(1, docA, "A")] }]);
    const section = (await getReport(id))!.sections[0]!;
    await setSectionDraft(section.id, draft("New text [1].", [cite(1, docB, "B")]));
    const replaced = await acceptDraft(section.id, "replace");
    expect(replaced.content).toBe("New text [1].");
    expect(replaced.citations).toEqual([cite(1, docB, "B")]);

    await updateSection(section.id, { content: "  ", citations: [] });
    await setSectionDraft(section.id, draft("Fresh [1].", [cite(1, docA, "A")]));
    expect((await acceptDraft(section.id, "append")).content).toBe("Fresh [1].");
  });

  it("refuses when there is no draft waiting", async () => {
    const id = await reportWith([{ heading: "Summary", content: "", citations: [] }]);
    const section = (await getReport(id))!.sections[0]!;
    await expect(acceptDraft(section.id, "replace")).rejects.toThrow("Bekleyen bir taslak yok.");
  });
});

describe("reportForExport", () => {
  async function twoSections() {
    return reportWith([
      { heading: "Summary", content: "Reached 412 households [1]. Sessions ran [2][1]. See annex [7].", citations: [cite(1, docA, "Visit note", 3), cite(2, docB, "IPTT")] },
      { heading: "Progress", content: "Targets held [1]. Next quarter [2].", citations: [cite(1, docB, "IPTT"), cite(2, docA, "Visit note", 4)] },
    ]);
  }

  it("numbers sources once across the report, in order of first use", async () => {
    const out = (await reportForExport(await twoSections()))!;
    expect(out.sections.map((s) => s.content)).toEqual(["Reached 412 households⟦1⟧. Sessions ran⟦1,2⟧. See annex [7].", "Targets held⟦2⟧. Next quarter⟦3⟧."]);
    // The same file on another page is another source.
    expect(out.sources).toEqual([
      { n: 1, title: "Visit note", page: 3 },
      { n: 2, title: "IPTT", page: null },
      { n: 3, title: "Visit note", page: 4 },
    ]);
  });

  it("drops the numbers and the source list for a clean copy, keeping her own brackets", async () => {
    const out = (await reportForExport(await twoSections(), { clean: true }))!;
    expect(out.sections.map((s) => s.content)).toEqual(["Reached 412 households. Sessions ran. See annex [7].", "Targets held. Next quarter."]);
    expect(out.sources).toEqual([]);
  });
});

describe("duplicateReport", () => {
  it("copies the sections and guidance for the next period with empty text and no sources", async () => {
    const id = await reportWith([
      { heading: "Summary", content: "Q2 text [1].", citations: [cite(1, docA, "A")] },
      { heading: "Challenges", content: "Q2 challenges.", citations: [] },
    ]);
    await setReportSources(id, [{ type: "document", id: docA }]);
    const first = (await getReport(id))!.sections[0]!;
    await updateSection(first.id, { guidance: "Main achievements of the period.", wordLimit: 300 });

    const copy = await duplicateReport(id, { title: "Quarterly report · Q3", periodId: null });
    const full = (await getReport(copy.id))!;
    expect(full.title).toBe("Quarterly report · Q3");
    expect(full.sources).toEqual([]);
    expect(full.sections.map((s) => [s.heading, s.guidance, s.wordLimit, s.content, s.citations])).toEqual([
      ["Summary", "Main achievements of the period.", 300, "", []],
      ["Challenges", null, null, "", []],
    ]);
  });
});

describe("pngName", () => {
  it("keeps the title in plain letters, so every browser saves it under that name", () => {
    expect(pngName("Hanelere ulaşım")).toBe("Hanelere ulasim.png");
    expect(pngName("Q3 özeti")).toBe("Q3 ozeti.png");
    expect(pngName("İŞ PLANI: Ekim/Kasım?")).toBe("IS PLANI Ekim Kasim.png");
    expect(pngName("")).toBe("gorsel.png");
  });
});
