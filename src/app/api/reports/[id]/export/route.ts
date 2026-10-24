import { formatDay } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders, buildReportDocx, safeFileName } from "@/server/export/docx";
import { exportWords, reportForExport } from "@/server/views/report-export";

export const dynamic = "force-dynamic";

/** A report as Word, with citations as superscripts and the sources at the end; `?clean=1` leaves both out. PDF goes through the print view. */
export async function GET(req: Request, ctx: RouteContext<"/api/reports/[id]/export">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const rep = await reportForExport(id, { clean: url.searchParams.get("clean") === "1" });
  if (!rep) return new Response("Not found", { status: 404 });
  const w = exportWords(rep.language);
  const subtitle = [rep.periodLabel, rep.audience, rep.dueDate ? `${w.due}: ${formatDay(rep.dueDate, rep.language === "tr" ? "tr" : "en", true)}` : null, rep.status === "draft" ? w.draft : null].filter(Boolean).join(" · ");
  const buf = await buildReportDocx({ title: rep.title, subtitle: subtitle || null, sections: rep.sections, sources: rep.sources, words: w, origin: url.origin });
  return new Response(new Uint8Array(buf), {
    headers: attachmentHeaders(safeFileName(rep.title, "docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  });
}
