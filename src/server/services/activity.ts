import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { activityLog } from "@/server/db/schema";
import type { EntityType } from "@/server/entities";

export type Actor = "user" | "ai" | "system";

export async function logActivity(entry: {
  action: string;
  entityType: EntityType | string;
  entityId?: string | null;
  title?: string | null;
  summary?: string | null;
  actor?: Actor;
  data?: unknown;
}) {
  const db = await getDb();
  await db.insert(activityLog).values({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    title: entry.title?.slice(0, 300) ?? null,
    summary: entry.summary ?? null,
    actor: entry.actor ?? "user",
    data: entry.data ?? null,
  });
}

export async function listActivity(opts: { entityType?: string; entityId?: string; limit?: number } = {}) {
  const db = await getDb();
  const where = [];
  if (opts.entityType) where.push(eq(activityLog.entityType, opts.entityType));
  if (opts.entityId) where.push(eq(activityLog.entityId, opts.entityId));
  return db
    .select()
    .from(activityLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(activityLog.at))
    .limit(opts.limit ?? 50);
}
