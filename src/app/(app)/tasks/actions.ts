"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { todayStr } from "@/lib/dates";
import { act } from "@/server/action";
import { aiConfigured } from "@/server/ai/client";
import { getDb } from "@/server/db/client";
import { savedViews } from "@/server/db/schema";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import {
  bulkUpdate,
  createTask,
  reorderTasks,
  taskInputSchema,
  taskPatchSchema,
  updateTask,
  getTask,
  type TaskInput,
  type TaskPatch,
} from "@/server/services/tasks";

export async function quickAddContextAction() {
  return act(
    async () => {
      const orgs = await listOrganisationsLite();
      return { today: todayStr(), partners: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })), ai: aiConfigured() };
    },
    { write: false },
  );
}

export async function createTaskAction(input: TaskInput) {
  return act(async () => {
    const task = await createTask(taskInputSchema.parse(input));
    return { id: task.id, title: task.title };
  });
}

export async function createTasksAction(inputs: TaskInput[]) {
  return act(async () => {
    const list = z.array(taskInputSchema).max(200).parse(inputs);
    const ids: string[] = [];
    for (const input of list) ids.push((await createTask(input)).id);
    return { ids };
  });
}

export async function updateTaskAction(id: string, patch: TaskPatch) {
  return act(async () => {
    const res = await updateTask(z.string().uuid().parse(id), taskPatchSchema.parse(patch));
    return { spawnedId: res?.spawned?.id ?? null, spawnedDue: res?.spawned?.dueDate ?? null };
  });
}

export async function setTaskDoneAction(id: string, done: boolean) {
  return act(async () => {
    const res = await updateTask(z.string().uuid().parse(id), { status: done ? "done" : "todo" });
    return { spawnedId: res?.spawned?.id ?? null, spawnedDue: res?.spawned?.dueDate ?? res?.spawned?.startDate ?? null };
  });
}

export async function bulkUpdateTasksAction(ids: string[], patch: TaskPatch) {
  return act(async () => ({ count: await bulkUpdate(z.array(z.string().uuid()).max(300).parse(ids), taskPatchSchema.parse(patch)) }));
}

export async function reorderTasksAction(ids: string[], field: "sortOrder" | "planOrder" = "sortOrder") {
  return act(async () => {
    await reorderTasks(z.array(z.string().uuid()).max(500).parse(ids), field);
    return null;
  });
}

export async function getTaskAction(id: string) {
  return act(async () => getTask(z.string().uuid().parse(id)), { write: false });
}

const filtersSchema = z.object({
  ownerKind: z.enum(["me", "others"]).optional(),
  orgId: z.string().uuid().optional(),
  tag: z.string().max(60).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  due: z.enum(["overdue", "today", "week", "month", "none"]).optional(),
  text: z.string().max(100).optional(),
});

export async function saveTaskViewAction(name: string, filters: z.input<typeof filtersSchema>, pinned = true) {
  return act(async () => {
    const db = await getDb();
    const [row] = await db
      .insert(savedViews)
      .values({ kind: "tasks", name: z.string().trim().min(1).max(80).parse(name), filters: filtersSchema.parse(filters), pinned })
      .returning();
    return { id: row!.id };
  });
}

export async function deleteSavedViewAction(id: string) {
  return act(async () => {
    const db = await getDb();
    await db.delete(savedViews).where(eq(savedViews.id, z.string().uuid().parse(id)));
    return null;
  });
}

export async function pinSavedViewAction(id: string, pinned: boolean) {
  return act(async () => {
    const db = await getDb();
    await db.update(savedViews).set({ pinned, updatedAt: new Date() }).where(and(eq(savedViews.id, z.string().uuid().parse(id))));
    return null;
  });
}

export async function aiParseTaskAction(text: string) {
  return act(async () => {
    const { aiParseTask } = await import("@/server/ai/parse-task");
    return aiParseTask(z.string().min(1).max(2000).parse(text));
  }, { write: false });
}

export async function splitTaskAction(id: string) {
  return act(async () => {
    const { proposeSubtasks } = await import("@/server/ai/extract-tasks");
    return proposeSubtasks(z.string().uuid().parse(id));
  }, { write: false });
}
