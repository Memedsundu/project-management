import { describe, expect, it } from "vitest";
import { nextIndicatorCode, nextNodeCode, numInput, parseNumber, runningTotals, spreadTargets } from "@/components/indicators/shared";
import { columnPeriods, quarterRows } from "@/server/services/indicators";

describe("parseNumber", () => {
  it("reads both conventions", () => {
    expect(parseNumber("1.240")).toBe(1240);
    expect(parseNumber("1,240")).toBe(1240);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("1.240,5")).toBe(1240.5);
    expect(parseNumber("1,240.5")).toBe(1240.5);
    expect(parseNumber("0,125")).toBe(0.125);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber(" 45 ")).toBe(45);
    expect(parseNumber("-3,5")).toBe(-3.5);
  });
  it("tells empty from wrong", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("  ")).toBeNull();
    expect(parseNumber("12a")).toBeUndefined();
    expect(parseNumber("%45")).toBeUndefined();
  });
  it("round-trips what the input boxes show", () => {
    for (const v of [0, 7, 12.5, 1240, 1240.5, 0.25, 45.75, 12.125, 99999.99]) {
      expect(parseNumber(numInput(v, "tr"))).toBeCloseTo(Math.round(v * 100) / 100, 6);
      expect(parseNumber(numInput(v, "en"))).toBeCloseTo(Math.round(v * 100) / 100, 6);
    }
  });
});

describe("indicator helpers", () => {
  it("suggests the next code under an output", () => {
    const node = { id: "n", code: "1.2", title: "x", level: "output" as const, parentId: null };
    expect(nextIndicatorCode(["1.2.1", "1.2.2", "2.1.1"], node)).toBe("1.2.3");
    expect(nextIndicatorCode([], node)).toBe("1.2.1");
  });
  it("keeps running totals empty until the first value", () => {
    expect(runningTotals([null, 5, null, 3])).toEqual([null, 5, 5, 8]);
  });
});

describe("spreadTargets", () => {
  it("splits a count over the periods, the last one taking the remainder", () => {
    expect(spreadTargets(4, 1000, 0, true, "number")).toEqual([250, 250, 250, 250]);
    expect(spreadTargets(3, 100, null, true, "number")).toEqual([33, 33, 34]);
  });
  it("climbs from the baseline for a level or a percentage", () => {
    expect(spreadTargets(4, 80, 40, false, "percent")).toEqual([50, 60, 70, 80]);
    expect(spreadTargets(3, 10, null, false, "number")).toEqual([3.33, 6.67, 10]);
  });
  it("gives nothing for no periods", () => {
    expect(spreadTargets(0, 100, 0, true, "number")).toEqual([]);
  });
});

describe("nextNodeCode", () => {
  const goal = { id: "g", code: "G", level: "goal" as const, parentId: null };
  const o1 = { id: "o1", code: "1", level: "outcome" as const, parentId: "g" };
  const out11 = { id: "x", code: "1.1", level: "output" as const, parentId: "o1" };
  it("numbers outcomes under the goal and outputs under their outcome", () => {
    expect(nextNodeCode([], "goal", null)).toBe("G");
    expect(nextNodeCode([goal], "outcome", goal)).toBe("1");
    expect(nextNodeCode([goal, o1], "outcome", goal)).toBe("2");
    expect(nextNodeCode([goal, o1], "output", o1)).toBe("1.1");
    expect(nextNodeCode([goal, o1, out11], "output", o1)).toBe("1.2");
  });
});

describe("quarterRows and columnPeriods", () => {
  it("makes calendar quarters for a January start", () => {
    const rows = quarterRows(2026, 2027);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({ label: "2026 Q1", kind: "quarter", startDate: "2026-01-01", endDate: "2026-03-31" });
    expect(rows[7]).toEqual({ label: "2027 Q4", kind: "quarter", startDate: "2027-10-01", endDate: "2027-12-31" });
  });
  it("makes project quarters for another start month", () => {
    const rows = quarterRows(2026, 2029, 9);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ label: "Y1 Q1", kind: "quarter", startDate: "2026-09-01", endDate: "2026-11-30" });
    expect(rows[1]).toMatchObject({ label: "Y1 Q2", startDate: "2026-12-01", endDate: "2027-02-28" });
    expect(rows[11]).toMatchObject({ label: "Y3 Q4", startDate: "2029-06-01", endDate: "2029-08-31" });
  });
  it("uses quarters as IPTT columns, or every period when there are none", () => {
    const q = { kind: "quarter" };
    const h = { kind: "half" };
    expect(columnPeriods([q, h, q])).toEqual([q, q]);
    expect(columnPeriods([h, h])).toEqual([h, h]);
  });
});
