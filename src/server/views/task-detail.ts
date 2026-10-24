import "server-only";
import { resolveEntity, type EntityType } from "@/server/entities";
import { listActivity } from "@/server/services/activity";
import { listLinks } from "@/server/services/links";
import { getTask } from "@/server/services/tasks";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The task side panel (?open=<id>) on any screen: the task, its links, history and source. */
export async function loadTaskDetail(openId: string | undefined | null) {
  if (!openId || !UUID.test(openId)) return null;
  const task = await getTask(openId);
  if (!task || task.deletedAt) return null;
  const ref = { type: "task" as const, id: task.id };
  const [links, history, source] = await Promise.all([
    listLinks(ref),
    listActivity({ entityType: "task", entityId: task.id, limit: 30 }),
    task.sourceType && task.sourceId ? resolveEntity({ type: task.sourceType as EntityType, id: task.sourceId }) : Promise.resolve(null),
  ]);
  return {
    task,
    links: links
      .filter((l) => l.kind !== "source")
      .map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    history: history.map((h) => ({ id: h.id, at: h.at.toISOString(), action: h.action, actor: h.actor, summary: h.summary })),
    source: source && !source.deleted ? { title: source.title, href: source.href, type: source.type } : null,
  };
}

export type TaskDetailData = NonNullable<Awaited<ReturnType<typeof loadTaskDetail>>>;
