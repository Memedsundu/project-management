import "server-only";
import { listAskThreads } from "@/server/ai/ask";
import { aiConfigured } from "@/server/ai/client";
import { listStudioOutputs } from "@/server/ai/collections";
import { aiOffKeys } from "@/server/ai/context";
import { collectionItems, getCollection, listCollections, smartFilterSchema, type SmartFilter } from "@/server/services/collections";
import { listDocTypes } from "@/server/services/documents";
import { listLinks } from "@/server/services/links";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { listTags } from "@/server/services/tags";

const smartOf = (raw: unknown): SmartFilter | null => {
  if (!raw) return null;
  const parsed = smartFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** What the smart-filter fields offer: partners, file types and tags. */
async function filterOptions() {
  const [orgs, docTypes, tags] = await Promise.all([listOrganisationsLite(), listDocTypes(), listTags()]);
  return {
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
    docTypes: docTypes.map((d) => ({ key: d.key, tr: d.tr, en: d.en })),
    tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
  };
}
export type FilterOptions = Awaited<ReturnType<typeof filterOptions>>;

/** "Koleksiyonlar": one card per collection with what is inside (Dropbox Dash Stacks). */
export async function loadCollections() {
  const [list, options] = await Promise.all([listCollections(), filterOptions()]);
  const cards = await Promise.all(
    list.map(async (c) => {
      const items = await collectionItems(c.id, { limit: 100 });
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        pinned: c.pinned,
        smartFilter: smartOf(c.smartFilter),
        count: items.length,
        preview: items.slice(0, 3).map((i) => ({ type: i.type, id: i.id, title: i.title, href: i.href })),
        updatedAt: c.updatedAt.toISOString(),
      };
    }),
  );
  return { collections: cards, options, aiReady: aiConfigured() };
}
export type CollectionsData = Awaited<ReturnType<typeof loadCollections>>;
export type CollectionCard = CollectionsData["collections"][number];

/** One collection as a NotebookLM notebook: its sources, the chat about them and the Studio outputs. */
export async function loadCollectionPage(id: string) {
  const c = await getCollection(id);
  if (!c || c.deletedAt) return null;
  const [threads, outputs, off, options, related] = await Promise.all([
    listAskThreads({ scopeType: "collection", scopeId: id, limit: 40 }),
    listStudioOutputs("collection", id),
    aiOffKeys(c.items.map((i) => ({ type: i.type, id: i.id }))),
    filterOptions(),
    listLinks({ type: "collection", id }, { kinds: ["related"] }),
  ]);
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    pinned: c.pinned,
    smartFilter: smartOf(c.smartFilter),
    updatedAt: c.updatedAt.toISOString(),
    items: c.items.map((i) => ({ type: i.type, id: i.id, title: i.title, href: i.href, source: i.source, aiOff: off.has(`${i.type}:${i.id}`) })),
    // Oldest first, like a conversation.
    threads: [...threads].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    outputs,
    // Notes saved from the chat or Studio; they are not sources unless she adds them.
    notes: related.filter((l) => l.type === "note" && !l.deleted && !c.items.some((i) => i.type === "note" && i.id === l.id)).map((l) => ({ id: l.id, title: l.title, href: l.href })),
    options,
    aiReady: aiConfigured(),
  };
}
export type CollectionPageData = NonNullable<Awaited<ReturnType<typeof loadCollectionPage>>>;
