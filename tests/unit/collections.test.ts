import { describe, expect, it } from "vitest";
import { cleanSmartFilter } from "@/server/services/collections";

describe("cleanSmartFilter", () => {
  it("keeps only the conditions she set", () => {
    expect(cleanSmartFilter({ q: "  rapor ", types: ["document", "document", "note"], orgId: undefined, tag: " ", from: "2026-07-01" })).toEqual({
      q: "rapor",
      types: ["document", "note"],
      from: "2026-07-01",
    });
  });

  it("refuses a filter with no condition, which would match everything", () => {
    expect(cleanSmartFilter({})).toBeNull();
    expect(cleanSmartFilter({ q: "   ", types: [] })).toBeNull();
    expect(cleanSmartFilter(null)).toBeNull();
  });
});
