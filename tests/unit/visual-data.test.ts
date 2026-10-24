import { describe, expect, it, vi } from "vitest";

// The chart rules under test sit on top of the IPTT, the partner list and the workplan; those are stand-ins here.
const state = vi.hoisted(() => ({
  periods: [] as { id: string; label: string }[],
  rows: [] as Record<string, unknown>[],
  byPartner: [] as { orgId: string | null; orgName: string; byPeriod: Record<string, number> }[],
  orgs: [] as { id: string; name: string; shortName: string | null; kind: string }[],
  activities: [] as { status: string; late: boolean }[],
}));
vi.mock("@/server/services/indicators", () => ({
  ipttTable: vi.fn(async () => ({ periods: state.periods, rows: state.rows })),
  actualsByPartner: vi.fn(async () => state.byPartner),
}));
vi.mock("@/server/services/partners-lite", () => ({ listOrganisationsLite: vi.fn(async () => state.orgs) }));
vi.mock("@/server/services/workplan", () => ({ listActivities: vi.fn(async () => state.activities) }));
vi.mock("@/server/services/reports", () => ({ getVisual: vi.fn(async () => null) }));

const { chartData } = await import("@/server/services/visual-data");

const IND = "6f1c2a52-3b0e-4c8e-9a51-1d2e3f4a5b6c";
const IND2 = "7a2d3b63-4c1f-4d9f-8b62-2e3f4a5b6c7d";
const quarters = ["2026 Q1", "2026 Q2", "2026 Q3"].map((label, i) => ({ id: `p${i + 1}`, label }));
const row = (over: Record<string, unknown>) => ({
  id: IND,
  code: "1.1.1",
  name: "Households reached",
  unit: "number",
  cumulative: false,
  cells: quarters.map((p) => ({ periodId: p.id, target: 100, actual: null, proposed: 0, percent: null })),
  percentToDate: null,
  ...over,
});
const partner = (id: string, name: string) => ({ id, name, shortName: null, kind: "partner" });

describe("chartData: partners", () => {
  it("keeps the first three partners of her list in their own colours and folds the rest into Other", async () => {
    state.periods = quarters;
    state.rows = [row({})];
    state.orgs = [partner("a", "Ortak A"), partner("b", "Ortak B"), partner("c", "Ortak C"), partner("d", "Ortak D"), partner("e", "Ortak E")];
    // B reports most, but slots follow her list, never the size of the numbers.
    state.byPartner = [
      { orgId: "b", orgName: "Ortak B", byPeriod: { p1: 50, p2: 60 } },
      { orgId: "a", orgName: "Ortak A", byPeriod: { p1: 5, p2: 6 } },
      { orgId: "c", orgName: "Ortak C", byPeriod: { p2: 9 } },
      { orgId: "d", orgName: "Ortak D", byPeriod: { p1: 1 } },
      { orgId: "e", orgName: "Ortak E", byPeriod: { p1: 2, p2: 3 } },
    ];
    const d = await chartData({ source: "indicator_partners", type: "bar", indicatorIds: [IND] });
    expect(d.series.map((s) => [s.key, s.slot, s.role])).toEqual([
      ["a", 0, "series"],
      ["b", 1, "series"],
      ["c", 2, "series"],
      ["other", 3, "other"],
    ]);
    // Only the quarters with a value are shown; Other adds D and E where either reported.
    expect(d.categories).toEqual(["2026 Q1", "2026 Q2"]);
    expect(d.series.at(-1)!.values).toEqual([3, 3]);
    expect(d.notes).toContain("too_many_partners");
  });

  it("names a single fourth partner instead of calling it Other, and shows percentages side by side", async () => {
    state.rows = [row({ unit: "percent" })];
    state.orgs = [partner("a", "Ortak A"), partner("b", "Ortak B"), partner("c", "Ortak C"), partner("d", "Ortak D")];
    state.byPartner = [
      { orgId: "a", orgName: "Ortak A", byPeriod: { p1: 40 } },
      { orgId: "d", orgName: "Ortak D", byPeriod: { p1: 70 } },
    ];
    const d = await chartData({ source: "indicator_partners", type: "stacked", indicatorIds: [IND] });
    expect(d.type).toBe("bar");
    expect(d.series.map((s) => [s.key, s.name, s.slot])).toEqual([
      ["a", "Ortak A", 0],
      ["d", "Ortak D", 3],
    ]);
    expect(d.notes).not.toContain("too_many_partners");
  });
});

describe("chartData: progress and workplan", () => {
  it("shows progress to target as rounded percentages against a 100% line", async () => {
    state.rows = [row({ percentToDate: 0.6834 }), row({ id: IND2, code: "1.2", percentToDate: null })];
    const d = await chartData({ source: "indicator_progress", type: "bar", indicatorIds: [] });
    expect(d).toMatchObject({ horizontal: true, reference: 100, unit: "percent", categories: ["1.1.1"] });
    expect(d.series[0]!.values).toEqual([68.3]);
  });

  it("counts activities by status, with late unfinished ones as delayed and no empty Cancelled bar", async () => {
    state.activities = [
      { status: "done", late: false },
      { status: "ongoing", late: true },
      { status: "planned", late: false },
      { status: "planned", late: false },
    ];
    const d = await chartData({ source: "workplan_status", type: "bar" });
    expect(d.categories).toEqual(["done", "ongoing", "planned", "delayed"]);
    expect(d.series[0]!.values).toEqual([1, 0, 2, 1]);
  });
});
