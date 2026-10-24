import { describe, expect, it } from "vitest";
import { onlyGiven } from "@/lib/patch";
import { indicatorInputSchema, nodeInputSchema, valueInputSchema } from "@/server/services/indicators";
import { collectionInputSchema } from "@/server/services/collections";
import { meetingPatchSchema } from "@/server/services/meetings";
import { contactInputSchema, orgInputSchema } from "@/server/services/partners";
import { reportInputSchema, visualInputSchema } from "@/server/services/reports";
import { taskPatchSchema } from "@/server/services/tasks";
import { activityInputSchema } from "@/server/services/workplan";

// An update that names one field must not touch the others. Zod 4 applies
// defaults inside .partial(), so every patch path either has no defaults or
// keeps only the given keys.
describe("patch schemas", () => {
  it("add nothing to an empty patch when there are no defaults", () => {
    for (const s of [taskPatchSchema, meetingPatchSchema, orgInputSchema.partial(), contactInputSchema.partial(), collectionInputSchema.partial(), nodeInputSchema.partial(), activityInputSchema.partial()]) {
      expect(s.parse({})).toEqual({});
    }
  });

  it("keep only the given keys where defaults exist", () => {
    for (const s of [indicatorInputSchema, valueInputSchema, reportInputSchema, visualInputSchema]) {
      const raw = {};
      expect(onlyGiven(raw, s.partial().parse(raw) as Record<string, unknown>)).toEqual({});
    }
    const raw = { name: "Yeni ad" };
    expect(onlyGiven(raw, indicatorInputSchema.partial().parse(raw))).toEqual({ name: "Yeni ad" });
  });
});
