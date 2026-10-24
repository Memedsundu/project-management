import "server-only";
import ExcelJS from "exceljs";
import type { BackupRow } from "@/lib/backup-format";
import { ensureProjectPeriods, ipttTable, listIndicators, listLogframeFlat, listValues } from "@/server/services/indicators";
import { loadDecisionsScreen } from "@/server/views/meetings";
import { loadWorkplan } from "@/server/views/workplan";
import trMeetings from "../../../messages/tr/meetings.json";
import enMeetings from "../../../messages/en/meetings.json";
import trPartners from "../../../messages/tr/partners.json";
import enPartners from "../../../messages/en/partners.json";
import trTasks from "../../../messages/tr/tasks.json";
import enTasks from "../../../messages/en/tasks.json";

/**
 * The workbooks the app hands out: the IPTT, the workplan, the decisions log,
 * and for the full export every task and every partner with their contacts.
 * Each returns the file's bytes; the routes and the ZIP export share them.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const INK = "FF111111";
const PANEL = "FFF2F2EE";
const AMBER_SOFT = "FFFDF3E1";
const AMBER_INK = "FF8A4B08";

const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function bytes(wb: ExcelJS.Workbook) {
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function workbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "[uygulama]";
  wb.created = new Date();
  return wb;
}

/**
 * The IPTT as donors expect it: one row per indicator under its logframe
 * item, target / actual / % per period, then the totals so far. A second
 * sheet lists every value with its source page, a third the definitions.
 */
export async function ipttWorkbook(en: boolean) {
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

  const wb = workbook();

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

  return bytes(wb);
}

/**
 * The workplan as the Excel donors expect: one row per activity under its
 * output, then a Gantt grid of months with the active months filled.
 */
export async function workplanWorkbook(sp: Record<string, string>, en: boolean) {
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
  const wb = workbook();
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
  return bytes(wb);
}

/** The decisions log, with the same filters as the screen. */
export async function decisionsWorkbook(sp: Record<string, string>, en: boolean, limit = 500) {
  const data = await loadDecisionsScreen(sp, { limit });
  const org = (id: string) => data.orgs.find((o) => o.id === id);
  const wb = workbook();
  const ws = wb.addWorksheet(en ? "Decisions" : "Kararlar", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: en ? "Date" : "Tarih", key: "date", width: 12 },
    { header: en ? "Decision" : "Karar", key: "text", width: 80 },
    { header: en ? "Meeting" : "Toplantı", key: "meeting", width: 40 },
    { header: en ? "Partner" : "Ortak", key: "partner", width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const d of data.rows) {
    const row = ws.addRow({
      date: new Date(`${d.decidedOn}T00:00:00Z`),
      text: d.text,
      meeting: d.meetingTitle ?? "",
      partner: d.orgIds.map((id) => org(id)?.shortName || org(id)?.name || "").filter(Boolean).join(", "),
    });
    row.getCell("date").numFmt = "dd.mm.yyyy";
  }
  ws.getColumn("text").alignment = { wrapText: true, vertical: "top" };
  if (data.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };
  return bytes(wb);
}

type Tables = Record<string, BackupRow[]>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null);
const istanbulDay = (v: unknown) => (typeof v === "string" && v ? new Date(`${new Date(v).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })}T00:00:00Z`) : null);

function header(ws: ExcelJS.Worksheet, count: number, rows: number) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: INK } };
  h.alignment = { vertical: "middle" };
  h.height = 22;
  if (rows) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: count } };
}

/** Every task that is not in the trash, subtasks under their parent's title. Built from the export's own rows. */
export function tasksWorkbook(tables: Tables, en: boolean) {
  const L = en ? enTasks : trTasks;
  const orgs = new Map((tables.organisations ?? []).map((o) => [str(o.id), str(o.short_name) || str(o.name)]));
  const people = new Map((tables.contacts ?? []).map((c) => [str(c.id), str(c.name)]));
  const tagName = new Map((tables.tags ?? []).map((t) => [str(t.id), str(t.name)]));
  const tagsOf = new Map<string, string[]>();
  for (const tg of tables.taggings ?? []) {
    if (tg.entity_type !== "task") continue;
    const name = tagName.get(str(tg.tag_id));
    if (name) tagsOf.set(str(tg.entity_id), [...(tagsOf.get(str(tg.entity_id)) ?? []), `#${name}`]);
  }
  const all = tables.tasks ?? [];
  const title = new Map(all.map((t) => [str(t.id), str(t.title)]));
  const owner = (t: BackupRow) =>
    t.owner_kind === "organisation" ? (orgs.get(str(t.owner_org_id)) ?? "") : t.owner_kind === "contact" ? (people.get(str(t.owner_contact_id)) ?? "") : t.owner_kind === "person" ? str(t.owner_name) : en ? "Me" : "Ben";
  const status = L.status as Record<string, string>;
  const priority = L.priority as Record<string, string>;
  const wb = workbook();
  const ws = wb.addWorksheet(en ? "Tasks" : "Görevler", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: en ? "Task" : "Görev", key: "title", width: 50 },
    { header: en ? "Status" : "Durum", key: "status", width: 13 },
    { header: en ? "Priority" : "Öncelik", key: "priority", width: 20 },
    { header: en ? "Start" : "Başlangıç", key: "start", width: 12 },
    { header: en ? "Due" : "Son tarih", key: "due", width: 12 },
    { header: en ? "Owner" : "Sorumlu", key: "owner", width: 22 },
    { header: en ? "Part of" : "Üst görev", key: "parent", width: 30 },
    { header: en ? "Repeats" : "Tekrar", key: "repeat", width: 18 },
    { header: en ? "Tags" : "Etiketler", key: "tags", width: 22 },
    { header: en ? "Notes" : "Notlar", key: "notes", width: 50 },
    { header: en ? "Completed" : "Tamamlandı", key: "completed", width: 12 },
    { header: en ? "Added" : "Eklendi", key: "created", width: 12 },
  ];
  const sorted = [...all].sort((a, b) => (str(a.due_date) || "9999").localeCompare(str(b.due_date) || "9999") || str(a.title).localeCompare(str(b.title), "tr"));
  for (const t of sorted) {
    const row = ws.addRow({
      title: str(t.title),
      status: status[str(t.status)] ?? str(t.status),
      priority: priority[str(t.priority)] ?? str(t.priority),
      start: day(t.start_date),
      due: day(t.due_date),
      owner: owner(t),
      parent: t.parent_id ? (title.get(str(t.parent_id)) ?? "") : "",
      repeat: str(t.recurrence_label),
      tags: (tagsOf.get(str(t.id)) ?? []).join(" "),
      notes: str(t.notes),
      completed: istanbulDay(t.completed_at),
      created: istanbulDay(t.created_at),
    });
    for (const k of ["start", "due", "completed", "created"]) row.getCell(k).numFmt = "dd.mm.yyyy";
  }
  for (const k of ["title", "notes", "parent"]) ws.getColumn(k).alignment = { wrapText: true, vertical: "top" };
  header(ws, 12, sorted.length);
  return bytes(wb);
}

/** Partners and every other organisation, then the people: adults' work contacts only. */
export function partnersWorkbook(tables: Tables, en: boolean) {
  const L = en ? enPartners : trPartners;
  const kinds = L.kinds as Record<string, string>;
  const rhythms = L.rhythms as Record<string, string>;
  const orgRows = [...(tables.organisations ?? [])].sort((a, b) => str(a.kind).localeCompare(str(b.kind)) || str(a.name).localeCompare(str(b.name), "tr"));
  const people = tables.contacts ?? [];
  const orgName = new Map(orgRows.map((o) => [str(o.id), str(o.short_name) || str(o.name)]));
  const personName = new Map(people.map((c) => [str(c.id), str(c.name)]));
  const wb = workbook();
  const os = wb.addWorksheet(en ? "Organisations" : "Kurumlar", { views: [{ state: "frozen", ySplit: 1 }] });
  os.columns = [
    { header: en ? "Name" : "Ad", key: "name", width: 40 },
    { header: en ? "Short name" : "Kısa ad", key: "short", width: 12 },
    { header: en ? "Kind" : "Tür", key: "kind", width: 16 },
    { header: en ? "Provinces" : "İller", key: "provinces", width: 20 },
    { header: en ? "Agreement starts" : "Sözleşme başlangıcı", key: "start", width: 14 },
    { header: en ? "Agreement ends" : "Sözleşme bitişi", key: "end", width: 14 },
    { header: en ? "Reports" : "Raporlama", key: "rhythm", width: 18 },
    { header: en ? "Focal person" : "Odak kişi", key: "focal", width: 22 },
    { header: en ? "Status" : "Durum", key: "statusLine", width: 36 },
    { header: en ? "Website" : "Web sitesi", key: "website", width: 26 },
    { header: en ? "Notes" : "Notlar", key: "notes", width: 50 },
  ];
  for (const o of orgRows) {
    const row = os.addRow({
      name: str(o.name),
      short: str(o.short_name),
      kind: kinds[str(o.kind)] ?? str(o.kind),
      provinces: Array.isArray(o.provinces) ? o.provinces.join(", ") : "",
      start: day(o.agreement_start),
      end: day(o.agreement_end),
      rhythm: rhythms[str(o.reporting_rhythm)] ?? str(o.reporting_rhythm),
      focal: personName.get(str(o.focal_contact_id)) ?? "",
      statusLine: str(o.status_line),
      website: str(o.website),
      notes: str(o.notes),
    });
    row.getCell("start").numFmt = "dd.mm.yyyy";
    row.getCell("end").numFmt = "dd.mm.yyyy";
  }
  for (const k of ["name", "statusLine", "notes"]) os.getColumn(k).alignment = { wrapText: true, vertical: "top" };
  header(os, 11, orgRows.length);

  const cs = wb.addWorksheet(en ? "Contacts" : "Kişiler", { views: [{ state: "frozen", ySplit: 1 }] });
  cs.columns = [
    { header: en ? "Name" : "Ad", key: "name", width: 26 },
    { header: en ? "Organisation" : "Kurum", key: "org", width: 22 },
    { header: en ? "Role" : "Görev", key: "role", width: 24 },
    { header: en ? "Email" : "E-posta", key: "email", width: 30 },
    { header: en ? "Phone" : "Telefon", key: "phone", width: 18 },
    { header: en ? "Notes" : "Notlar", key: "notes", width: 44 },
  ];
  const sortedPeople = [...people].sort((a, b) => (orgName.get(str(a.organisation_id)) ?? "~").localeCompare(orgName.get(str(b.organisation_id)) ?? "~", "tr") || str(a.name).localeCompare(str(b.name), "tr"));
  for (const c of sortedPeople) {
    cs.addRow({ name: str(c.name), org: orgName.get(str(c.organisation_id)) ?? "", role: str(c.role), email: str(c.email), phone: str(c.phone), notes: str(c.notes) });
  }
  cs.getColumn("notes").alignment = { wrapText: true, vertical: "top" };
  header(cs, 6, sortedPeople.length);
  return bytes(wb);
}

/** Meeting kinds and states, for the Markdown and Word copies of meetings. */
export function meetingWords(en: boolean) {
  const L = en ? enMeetings : trMeetings;
  return { kinds: L.kinds as Record<string, string>, statuses: L.statuses as Record<string, string> };
}
