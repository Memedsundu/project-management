import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { workplanWorkbook, XLSX_MIME } from "@/server/export/workbooks";

export const dynamic = "force-dynamic";

/** The workplan as an Excel file with a Gantt grid of months, with the screen's filters. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const en = (await getLocale()) === "en";
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const buf = await workplanWorkbook(sp, en);
  return new Response(new Uint8Array(buf), { headers: attachmentHeaders(en ? "workplan.xlsx" : "is-plani.xlsx", XLSX_MIME) });
}
