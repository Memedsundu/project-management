import ExcelJS from "exceljs";
import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { loadWorkplan } from "@/server/views/workplan";

export const dynamic = "force-dynamic";

const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The workplan as the Excel donors expect: one row per activity under its
 * output, then a Gantt grid of months with the active months filled.
 */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const en = (await getLocale()) === "en";
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const data = await loadWorkplan({ ...sp, view: "table", group: "output" }, en ? "en" : "tr");
  const org = (id: string) => data.orgs.find((o) => o.id === id);
  const status = en
    ? { planned: "Planned", ongoing: "Ongoing", done: "Done", delayed: "Delayed", canceled: "Canceled" }
    : { planned: "Planlandı", ongoing: "Devam ediyor", done: "Tamamlandı", delayed: "Gecikti", canceled: "İptal" };
  const months: { key: string; label: string }[] = [];
  for (let y = Number(data.range.from.slice(0, 4)); y <= Number(data.range.to.slice(0, 4)); y++) {
    for (let m = 1; m <= 12; m++) months.push({ key: `${y}-${String(m).padStart(2, "0")}`, label: `${(en ? MONTHS_EN : MONTHS_TR)[m - 1]} ${String(y).slice(2)}` });
  }
  const codeOf = new Map(data.activities.map((a) => [a.id, a.code]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "[uygulama]";
  const ws = wb.addWorksheet(en ? "Workplan" : "İş planı", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const fixed = [
    { header: en ? "Code" : "Kod", key: "code", width: 9 },
    { header: en ? "Activity" : "Faaliyet", key: "title", width: 48 },
    { header: en ? "Partners" : "Ortaklar", key: "partners", width: 18 },
    { header: en ? "Provinces" : "İller", key: "provinces", width: 18 },
    { header: en ? "Start" : "Başlangıç", key: "start", width: 12 },
    { header: en ? "End" : "Bitiş", key: "end", width: 12 },
    { header: en ? "Status" : "Durum", key: "status", width: 14 },
    { header: en ? "Progress" : "İlerleme", key: "progress", width: 10 },
    { header: en ? "Depends on" : "Bağlı olduğu", key: "depends", width: 14 },
  ];
  ws.columns = [...fixed, ...months.map((m) => ({ header: m.label, key: m.key, width: 5.5 }))];
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", textRotation: 0 };
  header.height = 22;
  const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
  const groups = [...data.outputs.map((o) => ({ label: `${o.code} ${o.title}`, items: data.activities.filter((a) => a.logframeNodeId === o.id) })), { label: en ? "No output" : "Çıktısı belirtilmemiş", items: data.activities.filter((a) => !a.logframeNodeId || !data.outputs.some((o) => o.id === a.logframeNodeId)) }].filter((g) => g.items.length);
  for (const g of groups) {
    const row = ws.addRow({ code: "", title: g.label });
    row.font = { bold: true };
    row.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2EE" } };
    for (const a of g.items) {
      const r = ws.addRow({
        code: a.code,
        title: a.title,
        partners: a.orgIds.map((id) => org(id)?.shortName || org(id)?.name || "").filter(Boolean).join(", "),
        provinces: a.provinces.join(", "),
        start: toDate(a.startDate),
        end: toDate(a.endDate),
        status: status[a.status],
        progress: a.progress / 100,
        depends: a.dependsOn.map((id) => codeOf.get(id) ?? "").filter(Boolean).join(", "),
      });
      r.getCell("start").numFmt = "dd.mm.yyyy";
      r.getCell("end").numFmt = "dd.mm.yyyy";
      r.getCell("progress").numFmt = "0%";
      if (!a.startDate) continue;
      const from = a.startDate.slice(0, 7);
      const to = (a.endDate ?? a.startDate).slice(0, 7);
      months.forEach((m, i) => {
        if (m.key < from || m.key > to) return;
        const cell = r.getCell(fixed.length + i + 1);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: a.late ? "FFB45309" : a.status === "done" ? "FF8A8A85" : "FF111111" } };
        if (a.isMilestone) cell.value = "◆";
      });
    }
  }
  ws.getColumn("title").alignment = { wrapText: true, vertical: "top" };
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: attachmentHeaders(en ? "workplan.xlsx" : "is-plani.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  });
}
