import { cronAuthorized } from "@/server/cron/auth";
import { runDueJobs } from "@/server/jobs/queue";
import { nightly } from "@/server/jobs/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 04:00 Istanbul: empty the trash after 30 days and tidy housekeeping rows. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await nightly();
  const ran = await runDueJobs({ limit: 40, budgetMs: 200_000 });
  return Response.json({ ...result, ran });
}
