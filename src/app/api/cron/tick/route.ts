import { cronAuthorized } from "@/server/cron/auth";
import { runDueJobs } from "@/server/jobs/queue";
import { scheduleDue } from "@/server/jobs/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Every 15 minutes in the day: queue what is due, then work through the queue. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const queued = await scheduleDue();
  const ran = await runDueJobs({ limit: 40, budgetMs: 240_000 });
  return Response.json({ queued, ran });
}
