import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { blocksToMarkdown, type Block } from "@/lib/blocks";
import { formatLongDay } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { markdownToSafeHtml } from "@/server/export/html";
import { getNote } from "@/server/services/notes";
import { PrintOnLoad } from "../../print-on-load";

export const dynamic = "force-dynamic";

/** Print view: the browser's "Save as PDF" turns this into the PDF export. */
export default async function PrintNote({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const note = await getNote(id);
  if (!note || note.deletedAt) notFound();
  const locale = await getLocale();
  const title = note.title || (note.dailyDate ? formatLongDay(note.dailyDate, locale) : "—");
  const html = markdownToSafeHtml(blocksToMarkdown(note.content as Block[]));
  return (
    <main className="print-page mx-auto max-w-[760px] px-8 py-10">
      <h1 className="font-display text-[40px] leading-tight">{title}</h1>
      <div className="prose-app mt-6" dangerouslySetInnerHTML={{ __html: html }} />
      <PrintOnLoad />
    </main>
  );
}
