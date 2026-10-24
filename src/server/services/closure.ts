import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { documents, tasks } from "@/server/db/schema";
import { getSetting, setSetting } from "./settings";
import { inboxCount } from "./shell";

/**
 * Closing the project at its end: what is still open (so she can tidy up
 * first), then a read-only workspace. Reminders and scheduled helpers stop;
 * reading, searching, asking and exporting go on. She can reopen it.
 */
export async function closureSummary() {
  const db = await getDb();
  const [[open], inbox, [review], [held]] = await Promise.all([
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), inArray(tasks.status, ["todo", "doing", "waiting"]))),
    inboxCount(),
    db
      .select({ n: count() })
      .from(documents)
      .where(and(isNull(documents.deletedAt), eq(documents.classificationStatus, "suggested"))),
    db
      .select({ n: count() })
      .from(documents)
      .where(and(isNull(documents.deletedAt), eq(documents.childDataFlag, true))),
  ]);
  return { openTasks: Number(open?.n ?? 0), inbox, filesToReview: Number(review?.n ?? 0), heldFiles: Number(held?.n ?? 0) };
}

export async function closeProject() {
  const current = await getSetting("archive");
  if (current.readOnly) return current;
  return setSetting("archive", { readOnly: true, archivedAt: new Date().toISOString() });
}

export async function reopenProject() {
  return setSetting("archive", { readOnly: false, archivedAt: null });
}

/** Closed projects run no scheduled work: no briefs, no reminders, no emptying of the trash. */
export async function projectClosed() {
  return (await getSetting("archive")).readOnly;
}
