import "server-only";
import { and, eq } from "drizzle-orm";
import { foldText } from "@/lib/fold";
import { getDb } from "@/server/db/client";
import { searchIndex } from "@/server/db/schema";
import type { EntityType } from "@/server/entities";

const MAX_BODY = 20_000;

export type IndexEntry = {
  type: EntityType;
  id: string;
  title: string;
  body?: string | null;
  meta?: Record<string, unknown>;
  aiOff?: boolean;
  occurredAt?: Date | null;
};

/** Add or refresh one record in the search index. Clears its vector so it is re-embedded. */
export async function indexRecord(entry: IndexEntry) {
  const db = await getDb();
  const body = (entry.body ?? "").slice(0, MAX_BODY);
  const values = {
    entityType: entry.type,
    entityId: entry.id,
    title: entry.title || "—",
    body,
    foldedTitle: foldText(entry.title),
    foldedBody: foldText(body),
    meta: entry.meta ?? {},
    aiOff: entry.aiOff ?? false,
    occurredAt: entry.occurredAt ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(searchIndex)
    .values(values)
    .onConflictDoUpdate({
      target: [searchIndex.entityType, searchIndex.entityId],
      set: { ...values, embedding: null, embeddedAt: null },
    });
}

export async function unindexRecord(type: EntityType, id: string) {
  const db = await getDb();
  await db.delete(searchIndex).where(and(eq(searchIndex.entityType, type), eq(searchIndex.entityId, id)));
}
