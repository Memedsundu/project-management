import "server-only";
import ExcelJS from "exceljs";

export type SheetSpec = {
  name: string;
  columns: { header: string; key: string; width?: number; numFmt?: string }[];
  rows: Record<string, unknown>[];
};

/** A plain, readable workbook: bold frozen header, filters on, sensible widths. */
export async function buildXlsx(sheets: SheetSpec[], meta: { title?: string } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "[uygulama]";
  wb.created = new Date();
  if (meta.title) wb.title = meta.title;
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet");
    ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4) }));
    for (const row of spec.rows) ws.addRow(row);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    header.height = 22;
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (spec.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
    spec.columns.forEach((c, i) => {
      if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
      ws.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
