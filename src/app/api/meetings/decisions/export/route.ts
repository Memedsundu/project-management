import ExcelJS from "exceljs";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { loadDecisionsScreen } from "@/server/views/meetings";

export const dynamic = "force-dynamic";

/** The decisions log as an Excel file, with the same filters as the screen. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const data = await loadDecisionsScreen(sp);
  const name = (id: string) => data.orgs.find((o) => o.id === id)?.shortName || data.orgs.find((o) => o.id === id)?.name || "";
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kararlar");
  ws.columns = [
    { header: "Tarih", key: "date", width: 12 },
    { header: "Karar", key: "text", width: 80 },
    { header: "Toplantı", key: "meeting", width: 40 },
    { header: "Ortak", key: "partner", width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const d of data.rows) ws.addRow({ date: d.decidedOn, text: d.text, meeting: d.meetingTitle ?? "", partner: d.orgIds.map(name).filter(Boolean).join(", ") });
  ws.getColumn("text").alignment = { wrapText: true, vertical: "top" };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: attachmentHeaders("kararlar.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  });
}
