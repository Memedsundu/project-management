import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { NotesHome } from "@/components/notes/notes-home";
import { dayOf, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { notes } from "@/server/db/schema";
import { listTemplates } from "@/server/services/templates";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("notes");
  return { title: t("title") };
}

export default async function NotesRoute() {
  const db = await getDb();
  const preview = sql<string>`left(regexp_replace(${notes.plainText}, '\\s+', ' ', 'g'), 160)`;
  const [recent, daily, templates] = await Promise.all([
    db
      .select({ id: notes.id, title: notes.title, icon: notes.icon, preview, updatedAt: notes.updatedAt })
      .from(notes)
      .where(and(isNull(notes.deletedAt), eq(notes.kind, "page"), eq(notes.inbox, false)))
      .orderBy(desc(notes.updatedAt))
      .limit(9),
    db
      .select({ id: notes.id, day: notes.dailyDate, preview })
      .from(notes)
      .where(and(isNull(notes.deletedAt), eq(notes.kind, "daily")))
      .orderBy(desc(notes.dailyDate))
      .limit(10),
    listTemplates("note"),
  ]);
  return (
    <NotesHome
      today={todayStr()}
      recent={recent.map((r) => ({ id: r.id, title: r.title, icon: r.icon, preview: r.preview ?? "", updatedDay: dayOf(r.updatedAt) }))}
      daily={daily.filter((d) => d.day).map((d) => ({ id: d.id, day: d.day!, preview: d.preview ?? "" }))}
      templates={templates.map((x) => ({ id: x.id, name: x.name, description: x.description, builtin: x.builtin }))}
    />
  );
}
