import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { DailyEmpty } from "@/components/notes/daily-empty";
import { addDaysStr, formatLongDay, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { notes } from "@/server/db/schema";
import { getOrCreateDailyNote } from "@/server/services/notes";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("notes.tree");
  return { title: t("daily") };
}

/** "Günlük not": today's page is made on first open; other days only when she asks. */
export default async function DailyRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const today = todayStr();
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const db = await getDb();
  const [found] = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.dailyDate, day), isNull(notes.deletedAt)))
    .limit(1);
  if (found) redirect(`/notes/${found.id}`);
  if (day === today) {
    const note = await getOrCreateDailyNote(day);
    redirect(`/notes/${note.id}`);
  }
  const locale = await getLocale();
  return <DailyEmpty day={day} label={formatLongDay(day, locale)} prev={addDaysStr(day, -1)} next={addDaysStr(day, 1)} />;
}
