import { istanbulInstant, todayStr } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { listMeetings, meetingsToIcs } from "@/server/services/meetings";

export const dynamic = "force-dynamic";

/** Upcoming meetings as one .ics file for Outlook or Google Calendar. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const org = new URL(req.url).searchParams.get("org");
  const list = await listMeetings({
    from: istanbulInstant(todayStr(), "00:00"),
    orgId: org && /^[0-9a-f-]{36}$/i.test(org) ? org : undefined,
    order: "asc",
    limit: 300,
  });
  const ics = meetingsToIcs(list.filter((m) => m.status !== "canceled"));
  return new Response(ics, { headers: attachmentHeaders("toplantilar.ics", "text/calendar; charset=utf-8") });
}
