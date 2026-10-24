import "server-only";
import { inArray } from "drizzle-orm";
import type { NotePageData } from "@/components/notes/note-page";
import type { Block } from "@/lib/blocks";
import { addDaysStr, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { tasks } from "@/server/db/schema";
import { listLinks } from "@/server/services/links";
import { childNotes, getNote, noteBreadcrumb } from "@/server/services/notes";
import { listOrganisationsLite } from "@/server/services/partners-lite";

function taskIdsIn(blocks: Block[] | undefined, out: Set<string>) {
  for (const b of blocks ?? []) {
    if (b.type === "task" && typeof b.props?.taskId === "string" && b.props.taskId) out.add(b.props.taskId);
    taskIdsIn(b.children, out);
  }
  return out;
}

/** Everything one page screen needs, in one round of queries. */
export async function loadNotePage(id: string): Promise<NotePageData | null> {
  const note = await getNote(id);
  if (!note || note.deletedAt) return null;
  const content = (note.content as Block[]) ?? [];
  const ids = [...taskIdsIn(content, new Set())];
  const db = await getDb();
  const [crumbs, kids, links, partners, taskRows] = await Promise.all([
    noteBreadcrumb(id),
    childNotes(id),
    listLinks({ type: "note", id }),
    listOrganisationsLite(),
    ids.length
      ? db.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, deletedAt: tasks.deletedAt }).from(tasks).where(inArray(tasks.id, ids))
      : Promise.resolve([]),
  ]);
  const today = todayStr();
  return {
    note: {
      id: note.id,
      title: note.title,
      icon: note.icon,
      kind: note.kind,
      dailyDate: note.dailyDate,
      pinned: note.pinned,
      aiOff: note.aiOff,
      parentId: note.parentId,
      updatedAt: note.updatedAt.toISOString(),
      content,
    },
    breadcrumb: crumbs,
    subPages: kids.map((k) => ({ id: k.id, title: k.title, icon: k.icon })),
    links: links.map((l) => ({ type: l.type, id: l.id, title: l.title, href: l.href, kind: l.kind, direction: l.direction, createdBy: l.createdBy })),
    taskStates: Object.fromEntries(taskRows.map((r) => [r.id, { title: r.title, status: r.status, dueDate: r.dueDate, deleted: Boolean(r.deletedAt) }])),
    today,
    partners: partners.map((p) => ({ id: p.id, name: p.name, shortName: p.shortName })),
    daily: note.dailyDate ? { prev: addDaysStr(note.dailyDate, -1), next: addDaysStr(note.dailyDate, 1) } : null,
  };
}
