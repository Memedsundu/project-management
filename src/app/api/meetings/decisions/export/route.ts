import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { decisionsWorkbook, XLSX_MIME } from "@/server/export/workbooks";

export const dynamic = "force-dynamic";

/** The decisions log as an Excel file, with the same filters as the screen. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const en = (await getLocale()) === "en";
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const buf = await decisionsWorkbook(sp, en);
  return new Response(new Uint8Array(buf), { headers: attachmentHeaders(en ? "decisions.xlsx" : "kararlar.xlsx", XLSX_MIME) });
}
