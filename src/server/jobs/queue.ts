import "server-only";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { jobs } from "@/server/db/schema";

/**
 * A small job queue in Postgres. Work is queued by server actions, started
 * right after the response with after(), and picked up again by the cron tick
 * if a function stopped half way.
 */

export type JobType =
  | "extract_text"
  | "classify_document"
  | "poll_batches"
  | "embed_pending"
  | "daily_brief"
  | "weekly_review"
  | "partner_report_check"
  | "run_recipe"
  | "organize_folder"
  | "read_indicators"
  | "send_reminders"
  | "workplan_prep";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const HANDLERS: Record<JobType, () => Promise<Handler>> = {
  extract_text: async () => (await import("@/server/files/extract-job")).extractTextJob,
  classify_document: async () => (await import("@/server/ai/classify")).classifyDocumentJob,
  poll_batches: async () => (await import("@/server/ai/batches")).pollBatchesJob,
  embed_pending: async () => (await import("@/server/search/embeddings")).embedPendingJob,
  daily_brief: async () => (await import("@/server/ai/helpers")).dailyBriefJob,
  weekly_review: async () => (await import("@/server/ai/helpers")).weeklyReviewJob,
  partner_report_check: async () => (await import("@/server/ai/helpers")).partnerReportCheckJob,
  run_recipe: async () => (await import("@/server/ai/helpers")).runRecipeJob,
  organize_folder: async () => (await import("@/server/ai/organize")).organizeFolderJob,
  read_indicators: async () => (await import("@/server/ai/indicator-reader")).readIndicatorsJob,
  send_reminders: async () => (await import("@/server/notifications/reminders")).sendRemindersJob,
  workplan_prep: async () => (await import("@/server/ai/workplan")).workplanPrepJob,
};

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
) {
  const db = await getDb();
  if (opts.dedupeKey) {
    const existing = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, opts.dedupeKey), inArray(jobs.status, ["queued", "running"])))
      .limit(1);
    if (existing.length) return existing[0]!.id;
  }
  const [row] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning({ id: jobs.id });
  return row!.id;
}

/** Jobs left "running" by a function that timed out go back to the queue. */
async function reclaimStale(db: Awaited<ReturnType<typeof getDb>>) {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)));
}

let running = false;

/** Run due jobs until the list is empty or the time budget is used. */
export async function runDueJobs(opts: { limit?: number; budgetMs?: number; types?: JobType[] } = {}) {
  if (running) return 0;
  running = true;
  const started = Date.now();
  const budget = opts.budgetMs ?? 45_000;
  const limit = opts.limit ?? 20;
  let done = 0;
  try {
    const db = await getDb();
    await reclaimStale(db);
    while (done < limit && Date.now() - started < budget) {
      const where = [eq(jobs.status, "queued"), lte(jobs.runAt, new Date())];
      if (opts.types?.length) where.push(inArray(jobs.type, opts.types));
      const [next] = await db.select().from(jobs).where(and(...where)).orderBy(asc(jobs.runAt)).limit(1);
      if (!next) break;
      // Claim it; another runner may have taken it in the meantime.
      const claimed = await db
        .update(jobs)
        .set({ status: "running", lockedAt: new Date(), attempts: sql`${jobs.attempts} + 1`, updatedAt: new Date() })
        .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
        .returning();
      const job = claimed[0];
      if (!job) continue;
      try {
        const load = HANDLERS[job.type as JobType];
        if (!load) throw new Error(`Unknown job type ${job.type}`);
        const handler = await load();
        await handler((job.payload ?? {}) as Record<string, unknown>);
        await db.update(jobs).set({ status: "done", lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retry = job.attempts < job.maxAttempts && !(err instanceof PermanentJobError);
        await db
          .update(jobs)
          .set({
            status: retry ? "queued" : "failed",
            lockedAt: null,
            lastError: message.slice(0, 2000),
            // Back off: 1, 4, 9 minutes.
            runAt: retry ? new Date(Date.now() + job.attempts * job.attempts * 60_000) : job.runAt,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, job.id));
        console.error(`[jobs] ${job.type} failed:`, message);
      }
      done++;
    }
  } finally {
    running = false;
  }
  return done;
}

/** Thrown by a handler when retrying cannot help (missing record, AI switched off). */
export class PermanentJobError extends Error {}

/** Start queued work right after the response is sent. */
export async function kickJobs(types?: JobType[]) {
  const { after } = await import("next/server");
  try {
    after(async () => {
      await runDueJobs({ limit: 10, budgetMs: 50_000, types }).catch((e) => console.error("[jobs]", e));
    });
  } catch {
    // Outside a request (cron, tests): the next tick picks the work up.
  }
}

export async function jobStats() {
  const db = await getDb();
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
