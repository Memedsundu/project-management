import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders, safeFileName } from "@/server/export/docx";
import { getMeeting, meetingsToIcs } from "@/server/services/meetings";

export const dynamic = "force-dynamic";

/** One meeting as an .ics file: "Takvime ekle". */
export async function GET(_req: Request, ctx: RouteContext<"/api/meetings/[id]/ics">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const m = await getMeeting(id);
  if (!m || m.deletedAt) return new Response("Not found", { status: 404 });
  const agenda = (m.agenda ?? []).map((a) => `- ${a.text}`).join("\n");
  const ics = meetingsToIcs([{ id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, location: m.location, onlineUrl: m.onlineUrl, description: agenda || undefined }]);
  return new Response(ics, { headers: attachmentHeaders(safeFileName(m.title, "ics"), "text/calendar; charset=utf-8") });
}
