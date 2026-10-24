import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { nowTz, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { authChallenges, briefs, jobs, sentNotifications } from "@/server/db/schema";
import { enqueue } from "./queue";

/**
 * Decides on each cron tick what is due: the 08:00 brief on working days,
 * the Friday 16:00 review, the partner report check on the first working day
 * of the month, scheduled recipes, and reminders. Each helper runs once per
 * day (or month) because the brief it writes is checked first.
 */
export async function scheduleDue(now = nowTz()) {
  // A closed project stays as it was: no briefs, reminders or other scheduled work.
  const { projectClosed } = await import("@/server/services/closure");
  if (await projectClosed()) return [];
  const day = todayStr(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const dow = now.getDay(); // 0 Sunday … 6 Saturday, Istanbul time
  const db = await getDb();
  const { ensureHolidays, isWorkingDay } = await import("@/server/services/workplan");
  await ensureHolidays();
  const workday = await isWorkingDay(day);
  const { getSetting } = await import("@/server/services/settings");
  const on = await getSetting("scheduledHelpers");
  const queued: string[] = [];

  const hasBrief = async (kind: string, from: string) => {
    const rows = await db
      .select({ id: briefs.id })
      .from(briefs)
      .where(and(eq(briefs.kind, kind), sql`${briefs.day} >= ${from}`))
      .limit(1);
    return rows.length > 0;
  };

  if (on.dailyBrief && workday && minutes >= 8 * 60 && minutes < 14 * 60 && !(await hasBrief("daily", day))) {
    await enqueue("daily_brief", { day }, { dedupeKey: `daily_brief:${day}` });
    queued.push("daily_brief");
  }
  if (on.weeklyReview && dow === 5 && minutes >= 16 * 60 && !(await hasBrief("weekly", day))) {
    await enqueue("weekly_review", { day }, { dedupeKey: `weekly_review:${day}` });
    queued.push("weekly_review");
  }
  const monthStart = `${day.slice(0, 7)}-01`;
  if (on.partnerCheck && workday && minutes >= 9 * 60 && !(await hasBrief("partner_check", monthStart))) {
    const { nextWorkingDay } = await import("@/server/services/workplan");
    if ((await nextWorkingDay(monthStart)) === day) {
      await enqueue("partner_report_check", { day }, { dedupeKey: `partner_report_check:${day.slice(0, 7)}` });
      queued.push("partner_report_check");
    }
  }

  // Monday morning: preparation ideas for activities that start in the next six weeks.
  if (dow === 1 && workday && minutes >= 9 * 60) {
    const key = `workplan_prep:${day}`;
    const ran = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, key)).limit(1);
    if (!ran.length) {
      await enqueue("workplan_prep", { day }, { dedupeKey: key, maxAttempts: 1 });
      queued.push("workplan_prep");
    }
  }

  const { scheduledRecipesDue } = await import("@/server/ai/helpers");
  const slots: ("daily_0800" | "friday_1600" | "monthly_first_workday")[] = [];
  if (workday && minutes >= 8 * 60) slots.push("daily_0800");
  if (dow === 5 && minutes >= 16 * 60) slots.push("friday_1600");
  if (workday && minutes >= 9 * 60) {
    const { nextWorkingDay } = await import("@/server/services/workplan");
    if ((await nextWorkingDay(monthStart)) === day) slots.push("monthly_first_workday");
  }
  for (const slot of slots) {
    for (const r of await scheduledRecipesDue(slot)) {
      await enqueue("run_recipe", { recipeId: r.id }, { dedupeKey: `recipe:${r.id}:${day}`, maxAttempts: 1 });
      queued.push(`recipe:${r.id}`);
    }
  }

  await enqueue("send_reminders", {}, { dedupeKey: "send_reminders", maxAttempts: 1 });
  const { embeddingsConfigured } = await import("@/server/search/embeddings");
  if (embeddingsConfigured()) await enqueue("embed_pending", {}, { dedupeKey: "embed_pending" });
  return queued;
}

/** Nightly: empty the 30-day trash and drop old housekeeping rows. A closed project keeps its trash as it was. */
export async function nightly() {
  const db = await getDb();
  const { purgeExpired } = await import("@/server/services/trash");
  const { projectClosed } = await import("@/server/services/closure");
  const purged = (await projectClosed()) ? 0 : await purgeExpired();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  await db.delete(jobs).where(and(eq(jobs.status, "done"), lt(jobs.updatedAt, monthAgo)));
  await db.delete(sentNotifications).where(lt(sentNotifications.sentAt, new Date(Date.now() - 90 * 86_400_000)));
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date(Date.now() - 86_400_000)));
  return { purged };
}
