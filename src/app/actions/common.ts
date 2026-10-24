"use server";

import { z } from "zod";
import { act } from "@/server/action";
import { ENTITY_TYPES, type EntityType } from "@/server/entities";
import { listActivity } from "@/server/services/activity";
import { addLink, listLinks, removeLink, type LinkKind } from "@/server/services/links";
import { listTags, setTags, tagsOf } from "@/server/services/tags";
import { moveToTrash, purge, purgeExpired, restoreFromTrash, listTrash } from "@/server/services/trash";
import { keywordSearch } from "@/server/search/search";

const typeSchema = z.enum(ENTITY_TYPES);
const refSchema = z.object({ type: typeSchema, id: z.string().uuid() });
const kindSchema = z.enum(["related", "mention", "partner", "attendee", "collection_item", "source", "attachment"]);

export async function trashAction(type: EntityType, id: string) {
  return act(async () => {
    const ref = refSchema.parse({ type, id });
    const row = await moveToTrash(ref.type, ref.id);
    return { ok: Boolean(row) };
  });
}

export async function trashManyAction(type: EntityType, ids: string[]) {
  return act(async () => {
    const t = typeSchema.parse(type);
    const list = z.array(z.string().uuid()).max(300).parse(ids);
    for (const id of list) await moveToTrash(t, id);
    return { count: list.length };
  });
}

export async function restoreManyAction(type: EntityType, ids: string[]) {
  return act(async () => {
    const t = typeSchema.parse(type);
    for (const id of z.array(z.string().uuid()).max(300).parse(ids)) await restoreFromTrash(t, id);
    return null;
  });
}

export async function restoreAction(type: EntityType, id: string) {
  return act(async () => {
    const ref = refSchema.parse({ type, id });
    await restoreFromTrash(ref.type, ref.id);
    return null;
  });
}

export async function purgeAction(type: EntityType, id: string) {
  return act(async () => {
    const ref = refSchema.parse({ type, id });
    await purge(ref.type, ref.id);
    return null;
  });
}

export async function emptyTrashAction() {
  return act(async () => {
    const items = await listTrash();
    for (const item of items) await purge(item.type, item.id);
    return { count: items.length };
  });
}

export async function purgeExpiredAction() {
  return act(async () => ({ count: await purgeExpired() }));
}

export async function addLinkAction(from: { type: EntityType; id: string }, to: { type: EntityType; id: string }, kind: LinkKind = "related") {
  return act(async () => {
    await addLink(refSchema.parse(from), refSchema.parse(to), kindSchema.parse(kind));
    return null;
  });
}

export async function removeLinkAction(from: { type: EntityType; id: string }, to: { type: EntityType; id: string }, kind?: LinkKind) {
  return act(async () => {
    await removeLink(refSchema.parse(from), refSchema.parse(to), kind ? kindSchema.parse(kind) : undefined);
    return null;
  });
}

export async function linksOfAction(ref: { type: EntityType; id: string }) {
  return act(async () => listLinks(refSchema.parse(ref)), { write: false });
}

export async function setTagsAction(ref: { type: EntityType; id: string }, names: string[]) {
  return act(async () => {
    const parsed = refSchema.parse(ref);
    const rows = await setTags(parsed, z.array(z.string().max(60)).max(30).parse(names));
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }));
  });
}

export async function tagsOfAction(ref: { type: EntityType; id: string }) {
  return act(async () => tagsOf(refSchema.parse(ref)), { write: false });
}

export async function allTagsAction() {
  return act(async () => listTags(), { write: false });
}

export async function historyAction(ref: { type: EntityType; id: string }) {
  return act(
    async () => {
      const parsed = refSchema.parse(ref);
      const rows = await listActivity({ entityType: parsed.type, entityId: parsed.id, limit: 40 });
      return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), action: r.action, actor: r.actor, summary: r.summary, title: r.title }));
    },
    { write: false },
  );
}

/** Used by every record picker (links, @mentions, collections). */
export async function searchEntitiesAction(query: string, types?: EntityType[]) {
  return act(
    async () => {
      const q = z.string().max(200).parse(query);
      const t = types ? z.array(typeSchema).parse(types) : undefined;
      const hits = await keywordSearch(q, { filters: { types: t }, limit: 12 });
      return hits.map((h) => ({ type: h.type, id: h.id, title: h.title, href: h.href, snippet: h.snippet }));
    },
    { write: false },
  );
}

/** ⌘K results: up to 30 hits with snippets, grouped on the client. */
export async function commandSearchAction(query: string) {
  return act(
    async () => {
      const q = z.string().max(300).parse(query);
      const hits = await keywordSearch(q, { limit: 30 });
      return hits.map((h) => ({ type: h.type, id: h.id, title: h.title, href: h.href, snippet: h.snippet, page: h.page ?? null }));
    },
    { write: false },
  );
}

/** "Görevleri çıkar" on any note, meeting, file or saved email. */
export async function extractTasksAction(ref: { type: EntityType; id: string }) {
  return act(
    async () => {
      const { extractTasksFrom } = await import("@/server/ai/extract-tasks");
      return extractTasksFrom(refSchema.parse(ref));
    },
    { write: false },
  );
}

const proposedSchema = z.object({
  title: z.string().trim().min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  ownerName: z.string().max(120).nullish(),
  ownerOrgId: z.string().uuid().nullish(),
  priority: z.number().int().min(1).max(4).nullish(),
  notes: z.string().max(4000).nullish(),
  parentId: z.string().uuid().nullish(),
});

/** Create the proposed tasks she kept, linked to where they came from. */
export async function acceptProposedTasksAction(source: { type: EntityType; id: string } | null, items: z.input<typeof proposedSchema>[]) {
  return act(async () => {
    const { createTask } = await import("@/server/services/tasks");
    const src = source ? refSchema.parse(source) : null;
    const list = z.array(proposedSchema).max(60).parse(items);
    const ids: string[] = [];
    for (const t of list) {
      const task = await createTask(
        {
          title: t.title,
          dueDate: t.dueDate ?? null,
          startDate: t.startDate ?? null,
          ownerOrgId: t.ownerOrgId ?? null,
          ownerName: t.ownerOrgId ? null : (t.ownerName ?? null),
          priority: t.priority ?? undefined,
          notes: t.notes ?? null,
          parentId: t.parentId ?? null,
          sourceType: src?.type ?? null,
          sourceId: src?.id ?? null,
        },
        "ai",
      );
      ids.push(task.id);
    }
    return { ids };
  });
}
