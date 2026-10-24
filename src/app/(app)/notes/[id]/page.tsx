import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NotePage } from "@/components/notes/note-page";
import { formatLongDay } from "@/lib/dates";
import { getNote } from "@/server/services/notes";
import { loadNotePage } from "@/server/views/note-page";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("notes");
  const note = UUID.test(id) ? await getNote(id) : null;
  return { title: note ? note.title || (note.dailyDate ? formatLongDay(note.dailyDate, "tr") : t("page.untitled")) : t("title") };
}

export default async function NoteRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadNotePage(id);
  if (!data) notFound();
  // A new key per page so the editor never carries one page's blocks into another.
  return <NotePage key={data.note.id} data={data} />;
}
