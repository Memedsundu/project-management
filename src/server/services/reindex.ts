import "server-only";
import type { EntityType } from "@/server/entities";

/**
 * Re-add one record to the search index (after a restore or an import).
 * Each domain registers its indexer below as it is built.
 */
type Indexer = (id: string) => Promise<void>;

const loaders: Partial<Record<EntityType, () => Promise<Indexer>>> = {};

export async function reindexEntity(type: EntityType, id: string) {
  const load = loaders[type];
  if (!load) return;
  const indexer = await load();
  await indexer(id);
}

export const INDEXERS = loaders;
