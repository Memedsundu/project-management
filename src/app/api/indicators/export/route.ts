import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { ipttWorkbook, XLSX_MIME } from "@/server/export/workbooks";

export const dynamic = "force-dynamic";

/** The IPTT as an Excel file: targets, actuals and % per period, the values with their sources, the definitions. */
export async function GET() {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const en = (await getLocale()) === "en";
  const buf = await ipttWorkbook(en);
  return new Response(new Uint8Array(buf), { headers: attachmentHeaders(en ? "indicators-iptt.xlsx" : "gostergeler-iptt.xlsx", XLSX_MIME) });
}
