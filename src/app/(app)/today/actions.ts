"use server";

import { z } from "zod";
import { textToBlocks, type Block } from "@/lib/blocks";
import { todayStr } from "@/lib/dates";
import { act } from "@/server/action";
import { dailyBriefJob } from "@/server/ai/helpers";
import { getOrCreateDailyNote, updateNote } from "@/server/services/notes";
import { updateTask } from "@/server/services/tasks";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "Şimdi hazırla": write today's brief now (with Claude when AI is on, plain facts otherwise). */
export async function refreshBriefAction() {
  return act(async () => {
    const brief = await dailyBriefJob({ day: todayStr(), notify: false });
    return { id: brief.id };
  });
}

/** Morning plan (Sunsama): the tasks she picked for today, in order, with estimates. */
export async function planDayAction(input: { day: string; items: { id: string; estimateMin: number | null }[]; removed: string[] }) {
  return act(async () => {
    const p = z
      .object({
        day,
        items: z.array(z.object({ id: z.string().uuid(), estimateMin: z.number().int().min(0).max(24 * 60).nullable() })).max(100),
        removed: z.array(z.string().uuid()).max(200),
      })
      .parse(input);
    for (const [i, item] of p.items.entries()) {
      await updateTask(item.id, { planDate: p.day, planOrder: i, estimateMin: item.estimateMin || null });
    }
    for (const id of p.removed) await updateTask(id, { planDate: null, planOrder: null });
    return { count: p.items.length };
  });
}

/** Evening wrap-up: move leftovers to the next working day and keep one line in the daily note. */
export async function wrapUpAction(input: { day: string; moveIds: string[]; reflection: string }) {
  return act(async () => {
    const p = z.object({ day, moveIds: z.array(z.string().uuid()).max(200), reflection: z.string().max(4000) }).parse(input);
    const { nextWorkingDay } = await import("@/server/services/workplan");
    const { addDaysStr } = await import("@/lib/dates");
    const next = await nextWorkingDay(addDaysStr(p.day, 1));
    for (const id of p.moveIds) await updateTask(id, { planDate: next, startDate: next, planOrder: null });
    if (p.reflection.trim()) {
      const note = await getOrCreateDailyNote(p.day);
      const content = [...((note.content as Block[]) ?? []), ...textToBlocks(`Günün sonu: ${p.reflection.trim()}`)];
      await updateNote(note.id, { content });
    }
    return { moved: p.moveIds.length, next };
  });
}
