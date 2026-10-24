import "server-only";
import type ExcelJS from "exceljs";
import { isNull } from "drizzle-orm";
import { z } from "zod";
import { foldText } from "@/lib/fold";
import {
  buildSheet,
  guessMapping,
  headerSignature,
  IMPORT_FIELDS,
  matchOrgs,
  matchProvinces,
  outputCode,
  rebaseSheet,
  rowsToActivities,
  type GridCell,
  type ImportMapping,
  type ImportSheet,
} from "@/lib/workplan-import";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { organisations } from "@/server/db/schema";
import { checkForChildData, reasonText } from "@/server/files/child-guard";
import { createLogframeNode, listLogframeFlat } from "./indicators";
import { getSetting, setSetting } from "./settings";
import { addDependency, createActivity, listActivities, updateActivity } from "./workplan";

const pad = (n: number) => String(n).padStart(2, "0");

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "object") {
    if ("result" in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      if (r instanceof Date) return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
      return r === undefined || r === null || typeof r === "object" ? "" : String(r);
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? "");
    return "";
  }
  if (typeof v === "boolean") return v ? "x" : "";
  return String(v);
}

function isFilled(cell: ExcelJS.Cell) {
  const f = cell.fill as ExcelJS.FillPattern | undefined;
  if (!f || f.type !== "pattern" || !f.pattern || f.pattern === "none") return false;
  const c = (f.fgColor ?? f.bgColor) as { argb?: string; theme?: number; indexed?: number } | undefined;
  if (!c) return true;
  if (c.argb) return !/^(FF|00)?FFFFFF$/i.test(c.argb) && c.argb !== "00000000";
  if (typeof c.theme === "number") return c.theme !== 0;
  if (typeof c.indexed === "number") return c.indexed !== 9 && c.indexed !== 64;
  return true;
}

function parseCsv(text: string): GridCell[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const rows: GridCell[][] = [];
  let row: GridCell[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push({ text: cell });
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push({ text: cell });
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push({ text: cell });
    rows.push(row);
  }
  return rows;
}

async function readGrids(buf: Buffer, filename: string): Promise<{ name: string; grid: GridCell[][] }[]> {
  if (/\.(csv|tsv|txt)$/i.test(filename)) return [{ name: filename.replace(/\.[^.]+$/, ""), grid: parseCsv(buf.toString("utf8").replace(/^﻿/, "")) }];
  if (!/\.xlsx$/i.test(filename)) throw new UserError("Excel (.xlsx) ya da CSV dosyası seç. Eski .xls dosyasını Excel'de .xlsx olarak kaydedebilirsin.");
  const ExcelJSmod = (await import("exceljs")).default;
  const wb = new ExcelJSmod.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UserError("Dosya okunamadı. Excel'de açıp yeniden .xlsx olarak kaydetmeyi dener misin?");
  }
  const out: { name: string; grid: GridCell[][] }[] = [];
  wb.eachSheet((ws) => {
    if (out.length >= 12 || ws.state === "hidden" || ws.state === "veryHidden") return;
    const rows = Math.min(ws.rowCount, 1600);
    const cols = Math.min(ws.columnCount, 150);
    const grid: GridCell[][] = [];
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r);
      const cells: GridCell[] = [];
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        cells.push({ text: cellText(cell).replace(/\s+/g, " ").trim(), filled: isFilled(cell) });
      }
      grid.push(cells);
    }
    out.push({ name: ws.name, grid });
  });
  return out;
}

function baseOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { year: y!, month: m! };
}

/** Read a workplan file: every sheet with its header row, columns and a first mapping. */
export async function parseImportFile(file: File, locale: "tr" | "en" = "tr") {
  if (file.size > 8 * 1024 * 1024) throw new UserError("Dosya 8 MB'tan büyük.");
  const profile = await getSetting("profile");
  const baseMonth = `${profile.startYear}-01`;
  const grids = await readGrids(Buffer.from(await file.arrayBuffer()), file.name);
  const sheets = grids
    .map((g) => buildSheet(g.name, g.grid, baseOf(baseMonth)))
    .filter((s): s is ImportSheet => Boolean(s && s.rows.length))
    .sort((a, b) => b.rows.length - a.rows.length);
  if (!sheets.length) throw new UserError("Dosyada faaliyet satırı bulunamadı.");
  const guard = checkForChildData({
    text: sheets.flatMap((s) => [s.columns.map((c) => c.header).join(" | "), ...s.rows.map((r) => r.cells.join(" | "))]).join("\n"),
    headers: sheets.map((s) => s.columns.map((c) => c.header)),
  });
  if (guard.flag) {
    throw new UserError(
      locale === "en"
        ? `This file looks like it holds personal data about children (${reasonText(guard.reasons, "en")}), so it was not read. The workspace keeps totals only.`
        : `Bu dosya çocuklara ait kişisel bilgi içeriyor gibi görünüyor (${reasonText(guard.reasons, "tr")}), bu yüzden okunmadı. Çalışma alanı yalnızca toplamları tutar.`,
      "child_data",
    );
  }
  const saved = (await getSetting("workplanImport")).mappings;
  return {
    filename: file.name,
    baseMonth,
    sheets: sheets.map((s) => {
      const remembered = saved[headerSignature(s)];
      const mapping: ImportMapping = remembered ? Object.fromEntries(Object.entries(remembered).map(([k, v]) => [Number(k), v as ImportMapping[number]])) : guessMapping(s);
      return { sheet: s, mapping, remembered: Boolean(remembered) };
    }),
  };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const importSheetSchema = z.object({
  name: z.string().max(200),
  headerRow: z.number().int().min(1),
  preamble: z.array(z.string().max(1000)).max(5),
  columns: z
    .array(
      z.object({
        index: z.number().int().min(0).max(200),
        header: z.string().max(500),
        samples: z.array(z.string().max(5000)).max(5),
        period: z.object({ from: day, to: day, relative: z.boolean() }).nullable(),
        year: z.number().int().nullable(),
      }),
    )
    .max(200),
  rows: z.array(z.object({ cells: z.array(z.string().max(5000)).max(200), marked: z.array(z.number().int()).max(200) })).max(1500),
});

export const commitImportSchema = z.object({
  sheet: importSheetSchema,
  mapping: z.record(z.string(), z.enum(IMPORT_FIELDS)),
  baseMonth: z.string().regex(/^\d{4}-\d{2}$/),
  createOutputs: z.boolean().default(true),
  updateExisting: z.boolean().default(true),
});

const MILESTONE = /(milestone|kilometre ta[sş][iı])/i;

/** Create (or update, by code) the activities of one sheet, then their outputs and dependencies. */
export async function commitImport(raw: z.input<typeof commitImportSchema>) {
  const input = commitImportSchema.parse(raw);
  const base = baseOf(input.baseMonth);
  const sheet = rebaseSheet(input.sheet, base);
  const mapping: ImportMapping = Object.fromEntries(Object.entries(input.mapping).map(([k, v]) => [Number(k), v]));
  if (!Object.values(mapping).includes("title") && !Object.values(mapping).includes("code")) throw new UserError("En az faaliyet adı sütununu seç.");
  const guard = checkForChildData({ text: sheet.rows.map((r) => r.cells.join(" | ")).join("\n"), headers: [sheet.columns.map((c) => c.header)] });
  if (guard.flag) throw new UserError("Bu dosya çocuklara ait kişisel bilgi içeriyor gibi görünüyor.", "child_data");
  const { outputs, activities: rows } = rowsToActivities(sheet, mapping, base);
  if (!rows.length) throw new UserError("Bu eşlemeyle faaliyet bulunamadı.");

  const db = await getDb();
  const [existing, nodes, orgs] = await Promise.all([
    listActivities(),
    listLogframeFlat(),
    db.select({ id: organisations.id, name: organisations.name, shortName: organisations.shortName }).from(organisations).where(isNull(organisations.deletedAt)),
  ]);
  const nodeBy = new Map(nodes.map((n) => [`${n.level}:${n.code}`, n.id]));
  let outputsCreated = 0;
  const ensureNode = async (level: "outcome" | "output", code: string, title: string, parent: string | null) => {
    const key = `${level}:${code}`;
    if (nodeBy.has(key)) return nodeBy.get(key)!;
    if (!input.createOutputs) return null;
    const row = await createLogframeNode({ level, code, title: title || code, parentId: parent ? (nodeBy.get(`outcome:${parent}`) ?? null) : null });
    nodeBy.set(key, row.id);
    outputsCreated++;
    return row.id;
  };
  for (const o of outputs) await ensureNode(o.level, o.code, o.title, o.parent);

  const outputFor = async (a: (typeof rows)[number]) => {
    if (a.output) {
      const code = outputCode(a.output);
      if (code && nodeBy.has(`output:${code}`)) return nodeBy.get(`output:${code}`)!;
      const byTitle = nodes.find((n) => n.level === "output" && foldText(n.title) === foldText(a.output));
      if (byTitle) return byTitle.id;
      if (code) return ensureNode("output", code, a.output.replace(/^\s*(output|çıktı|cikti)\s*\d+(?:\.\d+)*\s*[:.\-–]?\s*/i, "").trim(), null);
    }
    if (a.section && nodeBy.has(`output:${a.section}`)) return nodeBy.get(`output:${a.section}`)!;
    const parts = a.code.split(".");
    for (let i = parts.length - 1; i >= 1; i--) {
      const id = nodeBy.get(`output:${parts.slice(0, i).join(".")}`);
      if (id) return id;
    }
    return null;
  };

  const byCode = new Map(existing.map((a) => [foldText(a.code), a.id]));
  const unmatched = new Set<string>();
  const warnings: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const a of rows) {
    const orgMatch = matchOrgs(a.partners, orgs);
    orgMatch.unmatched.forEach((u) => unmatched.add(u));
    const provinces = matchProvinces(a.provinces);
    const logframeNodeId = await outputFor(a);
    const id = byCode.get(foldText(a.code));
    try {
      if (id) {
        if (!input.updateExisting) {
          skipped++;
          continue;
        }
        await updateActivity(id, {
          title: a.title,
          ...(a.description ? { description: a.description } : {}),
          ...(logframeNodeId ? { logframeNodeId } : {}),
          ...(a.start ? { startDate: a.start } : {}),
          ...(a.end ? { endDate: a.end } : {}),
          ...(a.status ? { status: a.status } : {}),
          ...(a.progress !== null ? { progress: a.progress } : {}),
          ...(provinces.length ? { provinces } : {}),
          ...(orgMatch.ids.length ? { orgIds: orgMatch.ids } : {}),
        });
        updated++;
      } else {
        const row = await createActivity({
          code: a.code,
          title: a.title,
          description: a.description,
          logframeNodeId,
          startDate: a.start,
          endDate: a.end,
          status: a.status ?? (a.progress === 100 ? "done" : "planned"),
          progress: a.progress ?? 0,
          provinces,
          orgIds: orgMatch.ids,
          isMilestone: MILESTONE.test(a.title),
        });
        byCode.set(foldText(a.code), row.id);
        created++;
      }
    } catch (err) {
      warnings.push(`${a.row}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const a of rows) {
    const self = byCode.get(foldText(a.code));
    if (!self) continue;
    for (const d of a.depends) {
      const target = byCode.get(foldText(d));
      if (!target || target === self) continue;
      try {
        await addDependency(self, target);
      } catch (err) {
        warnings.push(`${a.code} → ${d}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  // Remember the mapping for the next file with the same columns.
  const settings = await getSetting("workplanImport");
  const entries = Object.entries({ ...settings.mappings, [headerSignature(sheet)]: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [String(k), v])) }).slice(-20);
  await setSetting("workplanImport", { mappings: Object.fromEntries(entries) });
  return { created, updated, skipped, outputsCreated, unmatched: [...unmatched].slice(0, 12), warnings: warnings.slice(0, 12) };
}
