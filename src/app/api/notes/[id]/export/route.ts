import { formatLongDay } from "@/lib/dates";
import { blocksToMarkdown, type Block } from "@/lib/blocks";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders, buildDocx, safeFileName } from "@/server/export/docx";
import { getNote } from "@/server/services/notes";

export const dynamic = "force-dynamic";

/** A page as Word or Markdown. PDF goes through the print view. */
export async function GET(req: Request, ctx: RouteContext<"/api/notes/[id]/export">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const note = await getNote(id);
  if (!note || note.deletedAt) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const title = note.title || (note.dailyDate ? formatLongDay(note.dailyDate, "tr") : "Adsız sayfa");
  const blocks = note.content as Block[];
  if (url.searchParams.get("format") === "md") {
    const md = `# ${title}\n\n${blocksToMarkdown(blocks).replace(/\[([^\]]*)\]\(app:\/\/[a-z]+\/[0-9a-f-]+\)/g, "$1")}\n`;
    return new Response(md, { headers: attachmentHeaders(safeFileName(title, "md"), "text/markdown; charset=utf-8") });
  }
  const buf = await buildDocx({ title, blocks, origin: url.origin });
  return new Response(new Uint8Array(buf), {
    headers: attachmentHeaders(safeFileName(title, "docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  });
}
