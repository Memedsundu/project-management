"use server";

import { z } from "zod";
import { act } from "@/server/action";
import { isEntityType } from "@/server/entities";

/**
 * Hazır talimatlar (Granola Recipes, Notion skills): saved instructions she
 * runs on the page she is on, or on a schedule. Each result is kept on Özetler.
 */

const uuid = z.string().uuid();

export async function listRecipesAction() {
  return act(
    async () => {
      const { listRecipes } = await import("@/server/ai/helpers");
      return (await listRecipes()).map((r) => ({
        id: r.id,
        name: r.name,
        instructions: r.instructions,
        model: r.model,
        schedule: r.schedule as "daily_0800" | "friday_1600" | "monthly_first_workday" | null,
        builtin: Boolean(r.builtinKey),
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
      }));
    },
    { write: false },
  );
}

export async function saveRecipeAction(id: string | null, input: { name: string; instructions: string; model: string; schedule: string | null }) {
  return act(async () => {
    const { recipeSchema, saveRecipe } = await import("@/server/ai/helpers");
    const row = await saveRecipe(id ? uuid.parse(id) : null, recipeSchema.parse({ ...input, enabled: true }));
    return { id: row?.id ?? null };
  });
}

export async function deleteRecipeAction(id: string) {
  return act(async () => {
    const { deleteRecipe } = await import("@/server/ai/helpers");
    await deleteRecipe(uuid.parse(id));
    return null;
  });
}

/** Run a recipe now, on the page she is looking at when it is a record. */
export async function runRecipeAction(id: string, entity: { type: string; id: string } | null = null) {
  return act(async () => {
    const { runRecipe } = await import("@/server/ai/helpers");
    const on = entity && isEntityType(entity.type) && uuid.safeParse(entity.id).success ? { type: entity.type, id: entity.id } : null;
    const brief = await runRecipe(uuid.parse(id), on);
    return { id: brief.id, title: brief.title, content: brief.content };
  });
}
