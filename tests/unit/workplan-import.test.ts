import { describe, expect, it } from "vitest";
import { buildSheet, guessMapping, matchOrgs, matchProvinces, parseCellDate, parsePeriodHeader, parseProgress, parseStatus, rowsToActivities, type GridCell } from "@/lib/workplan-import";

const base = { year: 2026, month: 1 };
const g = (rows: (string | [string, boolean])[][]): GridCell[][] => rows.map((r) => r.map((c) => (Array.isArray(c) ? { text: c[0], filled: c[1] } : { text: c })));

describe("period headers", () => {
  it("reads Turkish and English month headers", () => {
    expect(parsePeriodHeader("Oca 2026", { base })).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    expect(parsePeriodHeader("Şubat 2028", { base })).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(parsePeriodHeader("Aug-27", { base })).toMatchObject({ from: "2027-08-01", to: "2027-08-31" });
    expect(parsePeriodHeader("2026-03", { base })).toMatchObject({ from: "2026-03-01" });
    expect(parsePeriodHeader("Eki", { year: 2026, base })).toMatchObject({ from: "2026-10-01" });
    expect(parsePeriodHeader("Eki", { base })).toBeNull();
  });
  it("reads quarters and relative months", () => {
    expect(parsePeriodHeader("Q2 2026", { base })).toMatchObject({ from: "2026-04-01", to: "2026-06-30" });
    expect(parsePeriodHeader("Ç3 2027", { base })).toMatchObject({ from: "2027-07-01", to: "2027-09-30" });
    expect(parsePeriodHeader("M14", { base: { year: 2026, month: 4 } })).toMatchObject({ from: "2027-05-01", relative: true });
    expect(parsePeriodHeader("Y2 Q1", { base })).toMatchObject({ from: "2027-01-01", to: "2027-03-31" });
    expect(parsePeriodHeader("Faaliyet", { base })).toBeNull();
  });
});

describe("cells", () => {
  it("reads dates in several shapes", () => {
    expect(parseCellDate("15.03.2026", "start", base)).toBe("2026-03-15");
    expect(parseCellDate("2026-03-15", "start", base)).toBe("2026-03-15");
    expect(parseCellDate("46096", "start", base)).toBe("2026-03-15");
    expect(parseCellDate("Mart 2026", "end", base)).toBe("2026-03-31");
    expect(parseCellDate("31.02.2026", "start", base)).toBeNull();
  });
  it("reads status and progress", () => {
    expect(parseStatus("Devam ediyor")).toBe("ongoing");
    expect(parseStatus("Tamamlandı")).toBe("done");
    expect(parseStatus("Delayed")).toBe("delayed");
    expect(parseProgress("0.45")).toBe(45);
    expect(parseProgress("80%")).toBe(80);
  });
  it("matches partners and provinces", () => {
    const orgs = [
      { id: "a", name: "Kalkınma Atölyesi", shortName: "KA" },
      { id: "b", name: "Hayata Destek Derneği", shortName: "HD" },
    ];
    expect(matchOrgs(["KA", "Hayata Destek", "UNICEF"], orgs)).toEqual({ ids: ["a", "b"], unmatched: ["UNICEF"] });
    expect(matchProvinces(["SANLIURFA", "Adana", "adana"])).toEqual(["Şanlıurfa", "Adana"]);
  });
});

describe("sheets", () => {
  it("finds the header row and maps a plain list", () => {
    const sheet = buildSheet(
      "Plan",
      g([
        ["İş Planı 2026–2029"],
        [],
        ["Kod", "Faaliyet", "Sorumlu ortak", "İl", "Başlangıç", "Bitiş", "Durum"],
        ["1", "Çıktı 1: Aileler bilgilendirilir"],
        ["1.1", "Aile bilgilendirme oturumları", "KA", "Şanlıurfa, Adana", "01.03.2026", "30.06.2026", "Planlandı"],
        ["1.2", "Mevsimlik tarım işçisi çadır alanı ziyaretleri", "HD", "Ordu", "15.07.2026", "30.09.2026", ""],
      ]),
      base,
    )!;
    expect(sheet.headerRow).toBe(3);
    const mapping = guessMapping(sheet);
    expect(Object.values(mapping)).toEqual(["code", "title", "partners", "provinces", "start", "end", "status"]);
    const { outputs, activities } = rowsToActivities(sheet, mapping, base);
    expect(outputs).toEqual([{ code: "1", title: "Aileler bilgilendirilir", level: "output", parent: null }]);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ code: "1.1", start: "2026-03-01", end: "2026-06-30", partners: ["KA"], provinces: ["Şanlıurfa", "Adana"], status: "planned", section: "1" });
  });

  it("reads a Gantt grid with a year row and marked months", () => {
    const sheet = buildSheet(
      "Gantt",
      g([
        ["", "", "2026", "", "", ""],
        ["No", "Activity", "Jul", "Aug", "Sep", "Oct"],
        ["2.1", "Harvest season monitoring visits", "", "x", ["", true], ""],
        ["2.2", "Teacher training", "", "", "", "X"],
      ]),
      base,
    )!;
    const mapping = guessMapping(sheet);
    expect(mapping[0]).toBe("code");
    expect(mapping[1]).toBe("title");
    const { activities } = rowsToActivities(sheet, mapping, base);
    expect(activities[0]).toMatchObject({ code: "2.1", start: "2026-08-01", end: "2026-09-30" });
    expect(activities[1]).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
  });
});
