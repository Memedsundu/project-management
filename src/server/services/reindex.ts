import "server-only";
import type { EntityType } from "@/server/entities";

/**
 * Re-add one record to the search index (after a restore or an import).
 * Each domain registers its indexer here.
 */
type Indexer = (id: string) => Promise<void>;

const loaders: Partial<Record<EntityType, () => Promise<Indexer>>> = {
  task: async () => (await import("./tasks")).indexTask,
  note: async () => (await import("./notes")).indexNote,
  document: async () => (await import("./documents")).indexDocument,
  folder: async () => (await import("./documents")).indexFolder,
  meeting: async () => (await import("./meetings")).indexMeeting,
  series: async () => (await import("./meetings")).indexSeries,
  decision: async () => (await import("./meetings")).indexDecision,
  organisation: async () => (await import("./partners")).indexOrganisation,
  contact: async () => (await import("./partners")).indexContact,
  activity: async () => (await import("./workplan")).indexActivity,
  indicator: async () => (await import("./indicators")).indexIndicator,
  logframe: async () => (await import("./indicators")).indexLogframeNode,
  report: async () => (await import("./reports")).indexReport,
  collection: async () => (await import("./collections")).indexCollection,
  visual: async () => (await import("./reports")).indexVisual,
};

export async function reindexEntity(type: EntityType, id: string) {
  const load = loaders[type];
  if (!load) return;
  const indexer = await load();
  await indexer(id);
}

export const INDEXERS = loaders;
