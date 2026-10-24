"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { act, UserError } from "@/server/action";
import { commitImportSchema, importSheetSchema } from "@/server/services/workplan-import";
import {
  activityInputSchema,
  addDependency,
  createActivity,
  deleteHoliday,
  deleteSeason,
  moveActivity,
  removeDependency,
  restoreDates,
  saveHoliday,
  saveSeason,
  SEASON_PRESETS,
  seasonSchema,
  updateActivity,
} from "@/server/services/workplan";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const locale = async () => ((await getLocale()) === "en" ? "en" : "tr") as "tr" | "en";

export async function createActivityAction(input: z.input<typeof activityInputSchema>) {
  return act(async () => {
    const row = await createActivity(activityInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateActivityAction(id: string, patch: Partial<z.input<typeof activityInputSchema>>) {
  return act(async () => {
    const row = await updateActivity(uuid.parse(id), activityInputSchema.partial().parse(patch));
    if (!row) throw new UserError("Faaliyet bulunamadı.");
    return null;
  });
}

/** Drag or resize on the timeline; returns the old dates of everything that moved, for "Geri al". */
export async function moveActivityAction(id: string, startDate: string | null, endDate: string | null, shiftDependents = true) {
  return act(async () => {
    const res = await moveActivity(uuid.parse(id), day.nullable().parse(startDate), day.nullable().parse(endDate), { shiftDependents });
    if (!res) throw new UserError("Faaliyet bulunamadı.");
    return res;
  });
}

export async function restoreDatesAction(list: { id: string; startDate: string | null; endDate: string | null }[]) {
  return act(async () => {
    await restoreDates(z.array(z.object({ id: uuid, startDate: day.nullable(), endDate: day.nullable() })).max(500).parse(list));
    return null;
  });
}

export async function addDependencyAction(activityId: string, dependsOnId: string) {
  return act(async () => {
    await addDependency(uuid.parse(activityId), uuid.parse(dependsOnId));
    return null;
  });
}

export async function removeDependencyAction(activityId: string, dependsOnId: string) {
  return act(async () => {
    await removeDependency(uuid.parse(activityId), uuid.parse(dependsOnId));
    return null;
  });
}

/* ------------------------------ Seasons and holidays ------------------------------ */

export async function saveSeasonAction(id: string | null, input: z.input<typeof seasonSchema>) {
  return act(async () => {
    const row = await saveSeason(id ? uuid.parse(id) : null, input);
    if (!row) throw new UserError("Mevsim bulunamadı.");
    return { id: row.id };
  });
}

export async function addSeasonPresetAction(index: number) {
  return act(async () => {
    const preset = SEASON_PRESETS[z.number().int().min(0).max(SEASON_PRESETS.length - 1).parse(index)]!;
    const row = await saveSeason(null, { ...preset, provinces: [...preset.provinces] });
    return { id: row!.id };
  });
}

export async function deleteSeasonAction(id: string) {
  return act(async () => {
    await deleteSeason(uuid.parse(id));
    return null;
  });
}

const holidaySchema = z.object({
  date: day,
  nameTr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).default(""),
  kind: z.enum(["public", "religious", "other"]).default("other"),
  halfDay: z.boolean().default(false),
});

export async function saveHolidayAction(id: string | null, input: z.input<typeof holidaySchema>) {
  return act(async () => {
    const h = holidaySchema.parse(input);
    const row = await saveHoliday(id ? uuid.parse(id) : null, { ...h, nameEn: h.nameEn || h.nameTr });
    if (!row) throw new UserError("Tatil bulunamadı.");
    return { id: row.id };
  });
}

export async function deleteHolidayAction(id: string) {
  return act(async () => {
    await deleteHoliday(uuid.parse(id));
    return null;
  });
}

/* ---------------------------------- Excel import ---------------------------------- */

/** Read the file and propose a mapping: the one she used for the same columns before, else Claude's, else header words. */
export async function parseImportAction(form: FormData) {
  return act(
    async () => {
      const file = form.get("file");
      if (!(file instanceof File)) throw new UserError("Dosya seçilmedi.");
      const { parseImportFile } = await import("@/server/services/workplan-import");
      const parsed = await parseImportFile(file, await locale());
      let ai: { mapping: Record<number, string>; baseMonth: string | null } | null = null;
      let aiError: string | null = null;
      const first = parsed.sheets[0]!;
      if (!first.remembered) {
        const { aiStatus } = await import("@/server/ai/client");
        const s = await aiStatus();
        if (s.configured && s.enabled && !s.capReached) {
          try {
            const { suggestColumnMapping } = await import("@/server/ai/workplan");
            ai = await suggestColumnMapping(first.sheet);
          } catch (err) {
            const { aiErrorMessage } = await import("@/server/ai/client");
            aiError = aiErrorMessage(err, await locale());
          }
        }
      }
      return { ...parsed, ai, aiError };
    },
    { write: false },
  );
}

export async function suggestMappingAction(sheet: z.input<typeof importSheetSchema>) {
  return act(
    async () => {
      const { suggestColumnMapping } = await import("@/server/ai/workplan");
      return suggestColumnMapping(importSheetSchema.parse(sheet));
    },
    { write: false },
  );
}

export async function commitImportAction(input: z.input<typeof commitImportSchema>) {
  return act(async () => {
    const { commitImport } = await import("@/server/services/workplan-import");
    return commitImport(input);
  });
}

/* ------------------------------------- Claude ------------------------------------- */

/** "Hazırlık öner": preparation tasks for one activity, or for what starts in the next six weeks. */
export async function proposePrepAction(activityId?: string | null) {
  return act(async () => {
    const { proposePrepTasks } = await import("@/server/ai/workplan");
    return proposePrepTasks({ activityId: activityId ? uuid.parse(activityId) : null, locale: await locale() });
  });
}

export async function summariseDelaysAction() {
  return act(
    async () => {
      const { summariseDelays } = await import("@/server/ai/workplan");
      return summariseDelays(await locale());
    },
    { write: false },
  );
}
