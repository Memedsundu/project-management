import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { formatLongDay, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { tasks } from "@/server/db/schema";
import type { EntityRef } from "@/server/entities";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import type { ProposedTask } from "@/server/services/suggestions";
import { aiJson, asMaterial } from "./client";
import { requireAiText } from "./context";

const ActionsSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().describe("Short imperative task title in the language of the source."),
      ownerName: z.string().nullable().describe("Who must do it, if named. Null when it is her own task."),
      ownerPartnerId: z.string().nullable().describe("Partner id from the list when a partner must do it."),
      dueDate: z.string().nullable().describe("YYYY-MM-DD when a date is stated or clearly implied, else null."),
      notes: z.string().nullable().describe("One sentence of context, quoting the source briefly."),
    }),
  ),
});

/** "Görevleri çıkar": action items with an owner and a date, for her to review. */
export async function extractTasksFromText(input: { text: string; title: string; kind: string; date?: string | null }): Promise<ProposedTask[]> {
  const today = todayStr();
  const partners = await listOrganisationsLite();
  const list = partners.map((p) => `- ${p.id}: ${p.name}${p.shortName ? ` (${p.shortName})` : ""}`).join("\n");
  const out = await aiJson({
    helper: "extractTasks",
    effort: "low",
    maxTokens: 6000,
    schema: ActionsSchema,
    system: `Find the action items in the material: things someone must do. Skip things already done and general discussion. Today is ${today} (${formatLongDay(today, "en")}). Resolve relative dates ("next Friday", "ayın 15'i") against ${input.date ?? today}. Partners:\n${list || "(none)"}`,
    messages: [{ role: "user", content: asMaterial("source", { title: input.title, kind: input.kind, date: input.date }, input.text) }],
  });
  const ids = new Set(partners.map((p) => p.id));
  return out.tasks.slice(0, 40).map((t) => ({
    title: t.title.slice(0, 300),
    ownerOrgId: t.ownerPartnerId && ids.has(t.ownerPartnerId) ? t.ownerPartnerId : null,
    ownerName: t.ownerPartnerId && ids.has(t.ownerPartnerId) ? null : t.ownerName,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate ?? "") ? t.dueDate : null,
    notes: t.notes,
  }));
}

export async function extractTasksFrom(ref: EntityRef) {
  const t = await requireAiText(ref, { max: 80_000 });
  if (!t.text.trim()) return [];
  return extractTasksFromText({ text: t.text, title: t.title, kind: t.kind, date: t.date });
}

const StepsSchema = z.object({ steps: z.array(z.string().describe("One concrete step, imperative.")) });

/** Split a big task into steps; she picks which to keep as sub-tasks. */
export async function proposeSubtasks(taskId: string): Promise<ProposedTask[]> {
  const db = await getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return [];
  const out = await aiJson({
    helper: "extractTasks",
    effort: "low",
    maxTokens: 3000,
    schema: StepsSchema,
    system: "Split the task into 3 to 7 concrete steps in the same language. Keep each step short.",
    messages: [{ role: "user", content: asMaterial("source", { title: task.title }, task.notes ?? task.title) }],
  });
  return out.steps.slice(0, 10).map((s) => ({ title: s, parentId: taskId }));
}
