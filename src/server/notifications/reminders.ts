import "server-only";
import { and, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { formatTime } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { meetings, tasks } from "@/server/db/schema";
import { getSetting } from "@/server/services/settings";
import { sendPush } from "./push";

/**
 * Runs on every cron tick (every 15 minutes in working hours). Each
 * notification has a key, so a reminder is never sent twice.
 */
export async function sendRemindersJob() {
  const settings = await getSetting("notifications");
  const db = await getDb();
  const now = new Date();

  if (settings.taskReminders) {
    // Reminders she set herself go out even in quiet hours; she chose the time.
    const due = await db
      .select({ id: tasks.id, title: tasks.title, reminderAt: tasks.reminderAt })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          inArray(tasks.status, ["todo", "doing", "waiting"]),
          isNotNull(tasks.reminderAt),
          lte(tasks.reminderAt, now),
          gte(tasks.reminderAt, new Date(now.getTime() - 6 * 60 * 60 * 1000)),
        ),
      )
      .limit(50);
    for (const t of due) {
      await sendPush(`task:${t.id}:${t.reminderAt!.toISOString()}`, (tr) => ({ title: tr("taskTitle"), body: t.title, url: `/tasks?open=${t.id}`, tag: `task-${t.id}` }), { ignoreQuiet: true });
    }
  }

  if (settings.meetingReminders) {
    const soon = await db
      .select({ id: meetings.id, title: meetings.title, startsAt: meetings.startsAt, location: meetings.location })
      .from(meetings)
      .where(and(isNull(meetings.deletedAt), inArray(meetings.status, ["planned"]), gte(meetings.startsAt, now), lte(meetings.startsAt, new Date(now.getTime() + 20 * 60 * 1000))))
      .limit(10);
    for (const m of soon) {
      await sendPush(`meeting:${m.id}:${m.startsAt.toISOString()}`, (tr) => ({
        title: tr("meetingTitle", { time: formatTime(m.startsAt), title: m.title }),
        body: m.location ? tr("meetingSoonAt", { location: m.location }) : tr("meetingSoon"),
        url: `/meetings/${m.id}`,
        tag: `meeting-${m.id}`,
      }));
    }
  }

  if (settings.lateReports) {
    const { latePartnerReports } = await import("@/server/services/today");
    const late = await latePartnerReports();
    for (const r of late.filter((x) => x.daysLate >= 1)) {
      await sendPush(`late:${r.orgId}:${r.label}`, (tr) => ({
        title: tr("lateTitle", { org: r.orgName }),
        body: tr("lateBody", { label: r.label, days: r.daysLate }),
        url: `/partners/${r.orgId}`,
        tag: `late-${r.orgId}`,
      }));
    }
  }
}
