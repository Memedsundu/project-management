import ExcelJS from "exceljs";
import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { attachmentHeaders } from "@/server/export/docx";
import { ensureProjectPeriods, ipttTable, listIndicators, listLogframeFlat, listValues } from "@/server/services/indicators";

export const dynamic = "force-dynamic";

const INK = "FF111111";
const PANEL = "FFF2F2EE";
const AMBER_SOFT = "FFFDF3E1";
const AMBER_INK = "FF8A4B08";

/**
 * The IPTT as donors expect it: one row per indicator under its logframe
 * item, target / actual / % per period, then the totals so far. A second
 * sheet lists every value with its source page, a third the definitions.
 */
export async function GET() {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const en = (await getLocale()) === "en";
  await ensureProjectPeriods();
  const [{ periods, rows }, list, nodes, values] = await Promise.all([ipttTable(), listIndicators(), listLogframeFlat(), listValues()]);
  const L = en
    ? { iptt: "IPTT", values: "Values", defs: "Definitions", code: "Code", name: "Indicator", unit: "Unit", baseline: "Baseline", lop: "LoP target", target: "Target", actual: "Actual", pct: "%", toDate: "Actual to date", targetToDate: "Target to date", pctToDate: "% of target to date", pctLop: "% of LoP", status: "Status", none: "Not linked to the logframe", period: "Period", value: "Value", groups: "Group", partner: "Partner", source: "Source file", page: "Page", note: "Note", state: "State", entered: "Entered", definition: "Definition", disaggregation: "Disaggregation", dataSource: "Data source", frequency: "Frequency", mov: "Means of verification", cumulative: "Cumulative", direction: "Direction", yes: "Yes", no: "No", up: "Higher is better", down: "Lower is better", total: "Total", approved: "Approved", proposed: "Proposed" }
    : { iptt: "IPTT", values: "Değerler", defs: "Tanımlar", code: "Kod", name: "Gösterge", unit: "Birim", baseline: "Başlangıç", lop: "Proje hedefi", target: "Hedef", actual: "Gerçekleşen", pct: "%", toDate: "Bugüne kadar", targetToDate: "Bugünkü hedef", pctToDate: "Bugünkü hedefe göre %", pctLop: "Proje hedefine göre %", status: "Durum", none: "Mantıksal çerçeveye bağlı değil", period: "Dönem", value: "Değer", groups: "Grup", partner: "Ortak", source: "Kaynak dosya", page: "Sayfa", note: "Not", state: "Durum", entered: "Girildiği tarih", definition: "Tanım", disaggregation: "Ayrıştırma", dataSource: "Veri kaynağı", frequency: "Sıklık", mov: "Doğrulama kaynağı", cumulative: "Kümülatif", direction: "Yön", yes: "Evet", no: "Hayır", up: "Yüksek olması iyi", down: "Düşük olması iyi", total: "Toplam", approved: "Onaylı", proposed: "Önerilen" };
  const unitText: Record<string, string> = en ? { number: "Number", percent: "Percent", text: "Text" } : { number: "Sayı", percent: "Yüzde", text: "Metin" };
  const statusText: Record<string, string> = en ? { on_track: "On track", behind: "Behind", ahead: "Ahead", no_data: "No data" } : { on_track: "Yolunda", behind: "Geride", ahead: "Önde", no_data: "Veri yok" };
  const freqText: Record<string, string> = en
    ? { monthly: "Monthly", quarterly: "Quarterly", semiannual: "Every six months", annual: "Annually", endline: "At endline" }
    : { monthly: "Aylık", quarterly: "Üç ayda bir", semiannual: "Altı ayda bir", annual: "Yılda bir", endline: "Proje sonunda" };
  const levelText: Record<string, string> = en ? { goal: "Goal", outcome: "Outcome", output: "Output" } : { goal: "Amaç", outcome: "Sonuç", output: "Çıktı" };

  const wb = new ExcelJS.Workbook();
  wb.creator = "[uygulama]";

  /* IPTT */
  const ws = wb.addWorksheet(L.iptt, { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  const fixed = [
    { key: "code", width: 9, label: L.code },
    { key: "name", width: 46, label: L.name },
    { key: "unit", width: 9, label: L.unit },
    { key: "baseline", width: 11, label: L.baseline },
    { key: "lop", width: 12, label: L.lop },
  ];
  const tail = [
    { key: "toDate", width: 13, label: L.toDate },
    { key: "targetToDate", width: 13, label: L.targetToDate },
    { key: "pctToDate", width: 13, label: L.pctToDate },
    { key: "pctLop", width: 13, label: L.pctLop },
    { key: "status", width: 11, label: L.status },
  ];
  ws.columns = [...fixed.map((c) => ({ key: c.key, width: c.width })), ...periods.flatMap((p) => [{ key: `t_${p.id}`, width: 9 }, { key: `a_${p.id}`, width: 10 }, { key: `p_${p.id}`, width: 7 }]), ...tail.map((c) => ({ key: c.key, width: c.width }))];
  const top = ws.getRow(1);
  const sub = ws.getRow(2);
  fixed.forEach((c, i) => {
    top.getCell(i + 1).value = c.label;
    ws.mergeCells(1, i + 1, 2, i + 1);
  });
  periods.forEach((p, i) => {
    const col = fixed.length + i * 3 + 1;
    top.getCell(col).value = p.label;
    ws.mergeCells(1, col, 1, col + 2);
    sub.getCell(col).value = L.target;
    sub.getCell(col + 1).value = L.actual;
    sub.getCell(col + 2).value = L.pct;
  });
  tail.forEach((c, i) => {
    const col = fixed.length + periods.length * 3 + i + 1;
    top.getCell(col).value = c.label;
    ws.mergeCells(1, col, 2, col);
  });
  for (const r of [top, sub]) {
    r.font = { bold: true };
    r.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  top.height = 30;

  const asNumber = (v: number | null, unit: string) => (v === null ? null : unit === "percent" ? v / 100 : v);
  const valueFmt = (unit: string) => (unit === "percent" ? "0.0%" : "#,##0.##");
  const known = new Set(nodes.map((n) => n.id));
  const groups = [...nodes.map((n) => ({ label: `${levelText[n.level] ?? n.level} ${n.code} · ${n.title}`, items: rows.filter((r) => r.nodeId === n.id) })), { label: L.none, items: rows.filter((r) => !r.nodeId || !known.has(r.nodeId)) }].filter((g) => g.items.length);
  for (const g of groups) {
    const head = ws.addRow({ code: "", name: g.label });
    head.font = { bold: true };
    head.eachCell({ includeEmpty: true }, (cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } }));
    for (const r of g.items) {
      const data: Record<string, unknown> = {
        code: r.code,
        name: r.name,
        unit: unitText[r.unit] ?? r.unit,
        baseline: asNumber(r.baseline, r.unit),
        lop: asNumber(r.lopTarget, r.unit),
        toDate: asNumber(r.toDateActual, r.unit),
        targetToDate: asNumber(r.toDateTarget, r.unit),
        pctToDate: r.percentToDate,
        pctLop: r.percentOfLop,
        status: statusText[r.status],
      };
      for (const c of r.cells) {
        data[`t_${c.periodId}`] = asNumber(c.target, r.unit);
        data[`a_${c.periodId}`] = asNumber(c.actual, r.unit);
        data[`p_${c.periodId}`] = c.percent;
      }
      const row = ws.addRow(data);
      for (const k of ["baseline", "lop", "toDate", "targetToDate", ...periods.flatMap((p) => [`t_${p.id}`, `a_${p.id}`])]) row.getCell(k).numFmt = valueFmt(r.unit);
      for (const k of ["pctToDate", "pctLop", ...periods.map((p) => `p_${p.id}`)]) row.getCell(k).numFmt = "0%";
      for (const p of periods) row.getCell(`a_${p.id}`).font = { bold: true };
      row.getCell("toDate").font = { bold: true };
      if (r.status === "behind") {
        for (const k of ["pctToDate", "status"]) {
          row.getCell(k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_SOFT } };
          row.getCell(k).font = { bold: true, color: { argb: AMBER_INK } };
        }
      }
    }
  }
  ws.getColumn("name").alignment = { wrapText: true, vertical: "top" };

  /* Values, each with its source */
  const codeOf = new Map(list.map((x) => [x.i.id, x.i]));
  const vs = wb.addWorksheet(L.values, { views: [{ state: "frozen", ySplit: 1 }] });
  vs.columns = [
    { header: L.period, key: "period", width: 11 },
    { header: L.code, key: "code", width: 9 },
    { header: L.name, key: "name", width: 40 },
    { header: L.value, key: "value", width: 11 },
    { header: L.groups, key: "groups", width: 22 },
    { header: L.partner, key: "partner", width: 22 },
    { header: L.source, key: "source", width: 36 },
    { header: L.page, key: "page", width: 7 },
    { header: L.note, key: "note", width: 40 },
    { header: L.state, key: "state", width: 11 },
    { header: L.entered, key: "entered", width: 12 },
  ];
  vs.getRow(1).font = { bold: true };
  for (const v of values) {
    const ind = codeOf.get(v.indicatorId);
    if (!ind) continue;
    const row = vs.addRow({
      period: v.periodLabel,
      code: ind.code,
      name: ind.name,
      value: asNumber(Number(v.value), ind.unit),
      groups: v.disaggregation && Object.keys(v.disaggregation).length ? Object.entries(v.disaggregation).map(([k, g]) => `${k}: ${g}`).join(", ") : L.total,
      partner: v.orgName ?? "",
      source: v.sourceTitle ?? "",
      page: v.sourcePage,
      note: v.sourceNote ?? "",
      state: v.status === "proposed" ? L.proposed : L.approved,
      entered: v.createdAt,
    });
    row.getCell("value").numFmt = valueFmt(ind.unit);
    row.getCell("entered").numFmt = "dd.mm.yyyy";
  }
  vs.getColumn("name").alignment = { wrapText: true, vertical: "top" };
  vs.getColumn("note").alignment = { wrapText: true, vertical: "top" };

  /* Definitions (PIRS) */
  const ds = wb.addWorksheet(L.defs, { views: [{ state: "frozen", ySplit: 1 }] });
  ds.columns = [
    { header: L.code, key: "code", width: 9 },
    { header: L.name, key: "name", width: 40 },
    { header: L.definition, key: "definition", width: 50 },
    { header: L.unit, key: "unit", width: 9 },
    { header: L.cumulative, key: "cumulative", width: 11 },
    { header: L.direction, key: "direction", width: 16 },
    { header: L.disaggregation, key: "dis", width: 22 },
    { header: L.dataSource, key: "dataSource", width: 30 },
    { header: L.frequency, key: "frequency", width: 12 },
    { header: L.mov, key: "mov", width: 36 },
  ];
  ds.getRow(1).font = { bold: true };
  for (const { i } of list) {
    ds.addRow({
      code: i.code,
      name: i.name,
      definition: i.definition ?? "",
      unit: unitText[i.unit] ?? i.unit,
      cumulative: i.cumulative ? L.yes : L.no,
      direction: i.direction === "decrease" ? L.down : L.up,
      dis: i.disaggregation.join(", "),
      dataSource: i.dataSource ?? "",
      frequency: i.frequency ? (freqText[i.frequency] ?? i.frequency) : "",
      mov: i.meansOfVerification ?? "",
    });
  }
  for (const k of ["name", "definition", "dataSource", "mov"]) ds.getColumn(k).alignment = { wrapText: true, vertical: "top" };
  for (const sheet of [ws, vs, ds]) sheet.getRow(1).getCell(1).font = { bold: true, color: { argb: INK } };

  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: attachmentHeaders(en ? "indicators-iptt.xlsx" : "gostergeler-iptt.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  });
}
