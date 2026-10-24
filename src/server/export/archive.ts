import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { blocksToMarkdown, markdownToBlocks, type Block, type Inline, type InlineLink, type InlineMention } from "@/lib/blocks";
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup, type BackupFile, type BackupRow } from "@/lib/backup-format";
import { dayOf, formatDateTime, formatDay, formatLongDay, formatTime } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { getSettings } from "@/server/services/settings";
import { getObjectBuffer } from "@/server/storage";
import { CITE_TOKEN, exportWords, reportForExport } from "@/server/views/report-export";
import { collectTables, SCHEMA_TAG, type CollectedTables } from "./backup";
import { buildDocx, buildReportDocx } from "./docx";
import { decisionsWorkbook, ipttWorkbook, meetingWords, partnersWorkbook, tasksWorkbook, workplanWorkbook } from "./workbooks";
import { archiveWords, type ArchiveWords } from "./words";
import type { ZipSource } from "./zip";

/**
 * The full export (Google Takeout, Notion's "Export all"): one ZIP she can
 * open without the app. Files sit in their folders, pages and meetings are
 * Markdown and Word with links that work between them, the tables are
 * Excel, an index page links everything, and a data file lets the app
 * restore the project. A big project is split into parts of about 1 GB so
 * each download finishes well inside the server's time limit.
 */

export const PART_BYTES = 1024 ** 3;

/** Browser tests split small projects into parts too; a deployment always uses PART_BYTES. */
function partSize() {
  const test = process.env.NODE_ENV !== "production" && process.env.E2E_LOGIN === "1" ? Number(process.env.EXPORT_PART_BYTES) : 0;
  return test > 0 ? test : PART_BYTES;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A file or folder name every system accepts (Windows is the strictest). */
export function safeSegment(name: string, max = 80) {
  let s = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = s.slice(0, max).trim();
  s = s.replace(/[. ]+$/, "");
  if (!s) s = "_";
  if (RESERVED.test(s)) s = `${s}_`;
  return s;
}

export function splitExt(filename: string) {
  const m = /^(.+?)(\.[A-Za-z0-9]{1,8})$/.exec(filename);
  return m ? { base: m[1]!, ext: m[2]! } : { base: filename, ext: "" };
}

/** Hands out paths that differ even where the file system ignores case: "Rapor.pdf", "Rapor (2).pdf". */
export class Namer {
  private used = new Set<string>();
  take(dir: string, base: string, ext = "") {
    const b = safeSegment(base);
    const e = ext.replace(/[^.A-Za-z0-9]/g, "").slice(0, 9);
    for (let n = 1; ; n++) {
      const name = n === 1 ? `${b}${e}` : `${b} (${n})${e}`;
      const full = dir ? `${dir}/${name}` : name;
      if (!this.used.has(full.toLowerCase())) {
        this.used.add(full.toLowerCase());
        return full;
      }
    }
  }
}

/** A link from one file in the ZIP to another, as Markdown, Word and browsers read it: "../Belgeler/Rapor%20Q3.pdf". */
export function relativeHref(fromFile: string, toPath: string) {
  const from = fromFile.split("/").slice(0, -1);
  const to = toPath.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const parts = [...Array<string>(from.length - i).fill(".."), ...to.slice(i).map((p) => encodeURIComponent(p))];
  const rel = parts.join("/");
  return rel.startsWith("../") ? rel : `./${rel}`;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export type ArchiveFile = BackupFile & { versionId: string; documentId: string; key: string; current: boolean; modified: Date };

export type Layout = {
  folders: Map<string, string>;
  documents: Map<string, string>;
  files: ArchiveFile[];
  notes: Map<string, string>;
  meetings: Map<string, string>;
  reports: Map<string, string>;
  briefs: Map<string, string>;
  parts: number;
};

/**
 * Where everything goes in the ZIP. Pure: the settings page uses it to tell
 * her how big the export is and how many parts it needs.
 */
export function layoutArchive(tables: Record<string, BackupRow[]>, w: ArchiveWords, opts: { files: boolean; partBytes?: number }): Layout {
  const namer = new Namer();
  const root = w.dirs.files;

  const folders = new Map<string, string>();
  const folderRows = tables.folders ?? [];
  const byId = new Map(folderRows.map((f) => [str(f.id), f]));
  const pathOf = (id: string, seen = new Set<string>()): string => {
    const known = folders.get(id);
    if (known) return known;
    const f = byId.get(id)!;
    const parent = f.parent_id && byId.has(str(f.parent_id)) && !seen.has(id) ? pathOf(str(f.parent_id), seen.add(id)) : root;
    const p = namer.take(parent, str(f.name));
    folders.set(id, p);
    return p;
  };
  for (const f of folderRows) pathOf(str(f.id));

  const versions = tables.document_versions ?? [];
  const versionsOf = new Map<string, BackupRow[]>();
  for (const v of versions) versionsOf.set(str(v.document_id), [...(versionsOf.get(str(v.document_id)) ?? []), v]);
  const docs = [...(tables.documents ?? [])].map((d) => ({ d, dir: (d.folder_id ? folders.get(str(d.folder_id)) : undefined) ?? root }));
  docs.sort((a, b) => a.dir.localeCompare(b.dir, "tr") || str(a.d.filename).localeCompare(str(b.d.filename), "tr"));

  const documents = new Map<string, string>();
  const current: ArchiveFile[] = [];
  const older: ArchiveFile[] = [];
  const file = (v: BackupRow, path: string, isCurrent: boolean): ArchiveFile => ({
    versionId: str(v.id),
    documentId: str(v.document_id),
    key: str(v.storage_key),
    path,
    part: 1,
    size: Number(v.size ?? 0),
    sha256: str(v.sha256),
    current: isCurrent,
    modified: new Date(str(v.created_at) || Date.now()),
  });
  if (opts.files) {
    for (const { d, dir } of docs) {
      const list = (versionsOf.get(str(d.id)) ?? []).sort((a, b) => Number(a.version) - Number(b.version));
      const cur = list.find((v) => str(v.id) === str(d.current_version_id)) ?? list.at(-1);
      if (!cur) continue;
      const { base, ext } = splitExt(str(d.filename) || str(cur.filename));
      const path = namer.take(dir, base, ext);
      documents.set(str(d.id), path);
      current.push(file(cur, path, true));
      const olderDir = `${root}/${w.dirs.olderVersions}${dir === root ? "" : dir.slice(root.length)}`;
      for (const v of list) {
        if (v === cur) continue;
        const parts = splitExt(str(v.filename) || str(d.filename));
        older.push(file(v, namer.take(olderDir, `${parts.base} (${w.version(Number(v.version))})`, parts.ext), false));
      }
    }
  }
  // Current files first, so part 1 holds as much of what she uses as fits.
  const files = [...current, ...older];
  let part = 1;
  let used = 0;
  for (const f of files) {
    if (used > 0 && used + f.size > (opts.partBytes ?? PART_BYTES)) {
      part++;
      used = 0;
    }
    f.part = part;
    used += f.size;
  }

  const notes = new Map<string, string>();
  const noteRows = tables.notes ?? [];
  const noteById = new Map(noteRows.map((n) => [str(n.id), n]));
  const noteTitle = (n: BackupRow) => str(n.title).trim() || (n.daily_date ? str(n.daily_date) : w.untitled);
  const stemOf = (id: string, seen = new Set<string>()): string => {
    const known = notes.get(id);
    if (known) return known;
    const n = noteById.get(id)!;
    let dir = w.dirs.notes;
    if (n.parent_id && noteById.has(str(n.parent_id)) && !seen.has(id)) dir = stemOf(str(n.parent_id), seen.add(id));
    else if (n.kind === "daily") dir = `${w.dirs.notes}/${w.dirs.daily}`;
    const stem = namer.take(dir, n.kind === "daily" && n.daily_date ? str(n.daily_date) : noteTitle(n));
    notes.set(id, stem);
    return stem;
  };
  for (const n of noteRows) stemOf(str(n.id));

  const meetings = new Map<string, string>();
  for (const m of [...(tables.meetings ?? [])].sort((a, b) => str(a.starts_at).localeCompare(str(b.starts_at)))) {
    meetings.set(str(m.id), namer.take(w.dirs.meetings, `${dayOf(str(m.starts_at))} ${str(m.title)}`));
  }
  const reports = new Map<string, string>();
  for (const r of tables.reports ?? []) reports.set(str(r.id), namer.take(w.dirs.reports, str(r.title) || w.untitled));
  const briefs = new Map<string, string>();
  for (const b of [...(tables.briefs ?? [])].sort((a, b) => str(a.day).localeCompare(str(b.day)))) {
    briefs.set(str(b.id), namer.take(w.dirs.briefs, `${str(b.day)} ${str(b.title)}`, ".md"));
  }
  return { folders, documents, files, notes, meetings, reports, briefs, parts: files.length ? part : 1 };
}

/* ------------------------------ Links between files ------------------------------ */

type Resolver = (kind: string, id: string, as: "md" | "docx") => string | null;

function makeResolver(layout: Layout): Resolver {
  return (kind, id, as) => {
    if (kind === "note") return layout.notes.has(id) ? `${layout.notes.get(id)}.${as}` : null;
    if (kind === "meeting") return layout.meetings.has(id) ? `${layout.meetings.get(id)}.${as}` : null;
    if (kind === "report") return layout.reports.has(id) ? `${layout.reports.get(id)}.${as}` : null;
    if (kind === "document") return layout.documents.get(id) ?? null;
    if (kind === "folder") return layout.folders.get(id) ?? null;
    return null;
  };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const APP_PAGES: [RegExp, string][] = [
  [new RegExp(`^app://(\\w+)/(${UUID})$`, "i"), ""],
  [new RegExp(`^/api/files/(${UUID})/content`, "i"), "document"],
  [new RegExp(`^/notes/(${UUID})(?:[?#].*)?$`, "i"), "note"],
  [new RegExp(`^/meetings/(${UUID})(?:[?#].*)?$`, "i"), "meeting"],
  [new RegExp(`^/reports/(${UUID})(?:[?#].*)?$`, "i"), "report"],
  [new RegExp(`^/files/d/(${UUID})`, "i"), "document"],
  [new RegExp(`^/files/f/(${UUID})`, "i"), "folder"],
];

/** The record an app link points at: "app://note/…", "/api/files/…/content", "/meetings/…". */
export function appTarget(url: string): { kind: string; id: string } | null {
  for (const [re, kind] of APP_PAGES) {
    const m = re.exec(url);
    if (m) return kind ? { kind, id: m[1]!.toLowerCase() } : { kind: m[1]!, id: m[2]!.toLowerCase() };
  }
  return null;
}

/** Links in a Markdown text, pointed at the files beside it; links to things not in the ZIP keep only their words. */
export function relinkMarkdown(md: string, fromFile: string, resolve: Resolver, origin: string) {
  return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, text: string, url: string) => {
    const t = appTarget(url);
    if (t) {
      const target = resolve(t.kind, t.id, "md");
      if (target) return `${bang}[${text}](${relativeHref(fromFile, target)})`;
      return bang ? `[${text || "…"}]` : text;
    }
    if (url.startsWith("/") && origin) return `${bang}[${text}](${origin}${url})`;
    return whole;
  });
}

function relinkInline(content: Inline[], fromFile: string, resolve: Resolver): Inline[] {
  return content.map((c) => {
    if (c.type === "mention") {
      const m = c as InlineMention;
      const target = resolve(m.props.kind, m.props.id, "docx");
      return target ? ({ type: "link", href: relativeHref(fromFile, target), content: [{ type: "text", text: m.props.title, styles: {} }] } as InlineLink) : c;
    }
    if (c.type === "link") {
      const l = c as InlineLink;
      const t = appTarget(l.href);
      if (!t) return c;
      const target = resolve(t.kind, t.id, "docx");
      return target ? { ...l, href: relativeHref(fromFile, target) } : { ...l, href: "" };
    }
    return c;
  });
}

/** Blocks for a Word file in the ZIP: @mentions and app links become links to the files beside it. */
export function relinkBlocks(blocks: Block[], fromFile: string, resolve: Resolver): Block[] {
  return blocks.map((b) => {
    const out: Block = { ...b };
    if (Array.isArray(b.content)) out.content = relinkInline(b.content as Inline[], fromFile, resolve);
    else if (b.content && typeof b.content === "object" && "rows" in b.content) {
      const tc = b.content as { rows: { cells: (Inline[] | { type: "tableCell"; content: Inline[] })[] }[] };
      out.content = {
        ...tc,
        rows: tc.rows.map((r) => ({ ...r, cells: r.cells.map((cell) => (Array.isArray(cell) ? relinkInline(cell, fromFile, resolve) : { ...cell, content: relinkInline(cell.content, fromFile, resolve) })) })),
      } as Block["content"];
    }
    if (b.type === "image" || b.type === "file") {
      const t = appTarget(str(b.props?.url));
      const target = t ? resolve(t.kind, t.id, "docx") : null;
      out.props = { ...b.props, url: target ? relativeHref(fromFile, target) : "" };
    }
    if (b.type === "entityCard" && b.props?.id) {
      const target = resolve(str(b.props.kind), str(b.props.id), "docx");
      if (target) {
        return { type: "paragraph", content: [{ type: "link", href: relativeHref(fromFile, target), content: [{ type: "text", text: `↗ ${str(b.props.title)}`, styles: { italic: true } }] }] };
      }
    }
    if (b.children?.length) out.children = relinkBlocks(b.children, fromFile, resolve);
    return out;
  });
}

/* ------------------------------ Pages and meetings ------------------------------ */

type Ctx = {
  en: boolean;
  w: ArchiveWords;
  tables: Record<string, BackupRow[]>;
  layout: Layout;
  resolve: Resolver;
  origin: string;
  linksFrom: Map<string, BackupRow[]>;
  decisionsOf: Map<string, BackupRow[]>;
};

function groupBy(rows: BackupRow[] | undefined, key: string) {
  const out = new Map<string, BackupRow[]>();
  for (const r of rows ?? []) {
    const k = str(r[key]);
    if (k) out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
}

export function makeCtx(tables: Record<string, BackupRow[]>, layout: Layout, w: ArchiveWords, en: boolean, origin: string): Ctx {
  return { en, w, tables, layout, resolve: makeResolver(layout), origin, linksFrom: groupBy(tables.links, "from_id"), decisionsOf: groupBy(tables.decisions, "meeting_id") };
}

/** Office files, PDFs and pictures are compressed already; storing them keeps the export fast. */
const STORED = { compress: false } as const;
const TEXT = { compress: true } as const;

async function* noteEntries(ctx: Ctx): AsyncGenerator<ZipSource> {
  for (const n of ctx.tables.notes ?? []) {
    const stem = ctx.layout.notes.get(str(n.id));
    if (!stem) continue;
    const title = str(n.title).trim() || (n.daily_date ? formatLongDay(str(n.daily_date), ctx.en ? "en" : "tr") : ctx.w.untitled);
    const blocks = (Array.isArray(n.content) ? n.content : []) as Block[];
    const modified = new Date(str(n.updated_at) || Date.now());
    const md = `# ${title}\n\n${relinkMarkdown(blocksToMarkdown(blocks), `${stem}.md`, ctx.resolve, ctx.origin)}\n`;
    yield { name: `${stem}.md`, data: md, modified, ...TEXT };
    yield { name: `${stem}.docx`, load: async () => buildDocx({ title, blocks: relinkBlocks(blocks, `${stem}.docx`, ctx.resolve), origin: ctx.origin }), modified, ...STORED };
  }
}

type Agenda = { text?: string; done?: boolean; notes?: string }[];
type Recap = { summary?: string; decisions?: string[]; actions?: { title: string; owner?: string | null; dueDate?: string | null }[]; openQuestions?: string[]; nextSteps?: string[] } | null;

/** One meeting as Markdown: the facts on top, then agenda, notes, summary, decisions and the rest. Notes stay blocks for Word. */
export function meetingParts(m: BackupRow, ctx: Ctx) {
  const L = ctx.w.meeting;
  const words = meetingWords(ctx.en);
  const locale = ctx.en ? "en" : "tr";
  const id = str(m.id);
  const orgName = new Map((ctx.tables.organisations ?? []).map((o) => [str(o.id), str(o.short_name) || str(o.name)]));
  const contact = new Map((ctx.tables.contacts ?? []).map((c) => [str(c.id), c]));
  const linked = (ctx.linksFrom.get(id) ?? []).filter((l) => l.from_type === "meeting");
  const partners = linked.filter((l) => l.to_type === "organisation" && l.kind === "partner").map((l) => orgName.get(str(l.to_id))).filter(Boolean);
  const attendees = linked
    .filter((l) => l.to_type === "contact" && l.kind === "attendee")
    .map((l) => contact.get(str(l.to_id)))
    .filter(Boolean)
    .map((c) => (c!.organisation_id && orgName.get(str(c!.organisation_id)) ? `${str(c!.name)} (${orgName.get(str(c!.organisation_id))})` : str(c!.name)));
  const starts = str(m.starts_at);
  const when = `${formatLongDay(dayOf(starts), locale)} ${dayOf(starts).slice(0, 4)}, ${formatTime(starts)}${m.ends_at ? `–${formatTime(str(m.ends_at))}` : ""}`;
  const facts = [
    `**${L.when}:** ${when} · ${words.kinds[str(m.kind)] ?? str(m.kind)} · ${words.statuses[str(m.status)] ?? str(m.status)}`,
    m.location || m.online_url ? [m.location ? `**${L.where}:** ${str(m.location)}` : "", m.online_url ? `**${L.online}:** ${str(m.online_url)}` : ""].filter(Boolean).join(" · ") : "",
    partners.length ? `**${L.partners}:** ${partners.join(", ")}` : "",
    attendees.length ? `**${L.attendees}:** ${attendees.join(", ")}` : "",
  ].filter(Boolean);
  const head: string[] = [facts.join("  \n"), ""];
  const agenda = (Array.isArray(m.agenda) ? m.agenda : []) as Agenda;
  if (agenda.length) {
    head.push(`## ${L.agenda}`, "");
    for (const a of agenda) head.push(`- [${a.done ? "x" : " "}] ${str(a.text)}${a.notes ? ` · ${a.notes}` : ""}`);
    head.push("");
  }
  const notes = (Array.isArray(m.notes_content) ? m.notes_content : []) as Block[];

  const tail: string[] = [];
  const recap = m.recap as Recap;
  const rows = ctx.decisionsOf.get(id) ?? [];
  if (recap?.summary || recap?.actions?.length || recap?.openQuestions?.length || recap?.nextSteps?.length) {
    tail.push(`## ${L.recap}`, "");
    if (recap.summary) tail.push(recap.summary, "");
    if (!rows.length && recap.decisions?.length) tail.push(`### ${L.decisions}`, "", ...recap.decisions.map((d) => `- ${d}`), "");
    const due = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? formatDay(d, locale, true) : d);
    if (recap.actions?.length) tail.push(`### ${L.actions}`, "", ...recap.actions.map((a) => `- ${a.title}${a.owner ? ` (${a.owner})` : ""}${a.dueDate ? `, ${L.due} ${due(a.dueDate)}` : ""}`), "");
    if (recap.openQuestions?.length) tail.push(`### ${L.questions}`, "", ...recap.openQuestions.map((q) => `- ${q}`), "");
    if (recap.nextSteps?.length) tail.push(`### ${L.nextSteps}`, "", ...recap.nextSteps.map((q) => `- ${q}`), "");
  }
  if (rows.length) tail.push(`## ${L.decisions}`, "", ...rows.map((d) => `- ${str(d.text)}`), "");
  if (m.prep_brief) tail.push(`## ${L.prep}`, "", str(m.prep_brief), "");
  if (m.followup_email) tail.push(`## ${L.followup}`, "", str(m.followup_email), "");
  if (m.transcript) tail.push(`## ${L.transcript}`, "", str(m.transcript), "");
  return { title: str(m.title), head: head.join("\n"), notes, tail: tail.join("\n") };
}

async function* meetingEntries(ctx: Ctx): AsyncGenerator<ZipSource> {
  for (const m of ctx.tables.meetings ?? []) {
    const stem = ctx.layout.meetings.get(str(m.id));
    if (!stem) continue;
    const p = meetingParts(m, ctx);
    const modified = new Date(str(m.updated_at) || Date.now());
    const notesMd = p.notes.length ? `## ${ctx.w.meeting.notes}\n\n${blocksToMarkdown(p.notes)}\n\n` : "";
    const md = relinkMarkdown(`# ${p.title}\n\n${p.head}\n${notesMd}${p.tail}`.replace(/\n{3,}/g, "\n\n").trim() + "\n", `${stem}.md`, ctx.resolve, ctx.origin);
    yield { name: `${stem}.md`, data: md, modified, ...TEXT };
    yield {
      name: `${stem}.docx`,
      load: async () => {
        const blocks = [
          ...markdownToBlocks(p.head),
          ...(p.notes.length ? [{ type: "heading", props: { level: 2 }, content: [{ type: "text", text: ctx.w.meeting.notes, styles: {} }] } as Block, ...p.notes] : []),
          ...markdownToBlocks(p.tail),
        ];
        return buildDocx({ title: p.title, blocks: relinkBlocks(blocks, `${stem}.docx`, ctx.resolve), origin: ctx.origin });
      },
      modified,
      ...STORED,
    };
  }
}

async function* reportEntries(ctx: Ctx): AsyncGenerator<ZipSource> {
  for (const r of ctx.tables.reports ?? []) {
    const stem = ctx.layout.reports.get(str(r.id));
    if (!stem) continue;
    const rep = await reportForExport(str(r.id));
    if (!rep) continue;
    const w = exportWords(rep.language);
    const subtitle = [rep.periodLabel, rep.audience, rep.status === "draft" ? w.draft : null].filter(Boolean).join(" · ") || null;
    const modified = new Date(str(r.updated_at) || Date.now());
    const sections = rep.sections.map((s) => ({ ...s, content: relinkMarkdown(s.content, `${stem}.docx`, (k, i) => ctx.resolve(k, i, "docx"), ctx.origin) }));
    yield { name: `${stem}.docx`, load: async () => buildReportDocx({ title: rep.title, subtitle, sections, sources: rep.sources, words: w, origin: ctx.origin }), modified, ...STORED };
    const md = [
      `# ${rep.title}`,
      subtitle ? `_${subtitle}_` : "",
      ...rep.sections.map((s) => `## ${s.heading}\n\n${s.content.trim() ? relinkMarkdown(s.content, `${stem}.md`, ctx.resolve, ctx.origin).replace(CITE_TOKEN, (_, ns: string) => ` [${ns.split(",").join(", ")}]`) : w.empty}`),
      rep.sources.length ? `## ${w.sources}\n\n${rep.sources.map((s) => `${s.n}. ${s.title}${s.page ? `, ${w.page(s.page)}` : ""}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    yield { name: `${stem}.md`, data: `${md}\n`, modified, ...TEXT };
  }
}

function* briefEntries(ctx: Ctx): Generator<ZipSource> {
  for (const b of ctx.tables.briefs ?? []) {
    const path = ctx.layout.briefs.get(str(b.id));
    if (!path) continue;
    const content = str(b.content).trim();
    const md = `${/^#\s/.test(content) ? "" : `# ${str(b.title)}\n\n`}${relinkMarkdown(content, path, ctx.resolve, ctx.origin)}\n`;
    yield { name: path, data: md, modified: new Date(str(b.created_at) || Date.now()), ...TEXT };
  }
}

/* ------------------------------ The index page ------------------------------ */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function size(bytes: number, en: boolean) {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1).replace(".", en ? "." : ",")} ${units[i]}`;
}

export function indexHtml(ctx: Ctx, meta: { appName: string; projectName: string; when: string; counts: Record<string, number>; held: { title: string }[]; files: boolean }) {
  const t = ctx.w.index;
  const indexFile = ctx.w.indexFile;
  const a = (path: string, text: string) => `<a href="${esc(relativeHref(indexFile, path))}">${esc(text)}</a>`;
  const out: string[] = [];
  const section = (id: string, title: string, body: string, count?: number) =>
    out.push(`<section id="${id}"><h2>${esc(title)}${count !== undefined ? ` <span class="n">${count}</span>` : ""}</h2>${body || `<p class="muted">${esc(t.none)}</p>`}</section>`);

  const wb = ctx.w.workbooks;
  section("tables", t.workbooks, `<ul class="grid">${[wb.tasks, wb.iptt, wb.workplan, wb.decisions, wb.partners].map((f) => `<li>${a(f, f.replace(/\.xlsx$/, ""))}</li>`).join("")}</ul>`);

  // Pages as a tree, sub-pages under their parent.
  const notes = ctx.tables.notes ?? [];
  const kids = new Map<string, BackupRow[]>();
  for (const n of notes) {
    const parent = n.parent_id && ctx.layout.notes.has(str(n.parent_id)) ? str(n.parent_id) : "";
    kids.set(parent, [...(kids.get(parent) ?? []), n]);
  }
  const noteTitle = (n: BackupRow) => str(n.title).trim() || (n.daily_date ? str(n.daily_date) : ctx.w.untitled);
  const tree = (parent: string, depth: number): string => {
    const list = (kids.get(parent) ?? []).filter((n) => depth > 0 || n.kind !== "daily").sort((x, y) => noteTitle(x).localeCompare(noteTitle(y), "tr"));
    if (!list.length) return "";
    return `<ul>${list.map((n) => `<li>${a(`${ctx.layout.notes.get(str(n.id))}.md`, noteTitle(n))} <span class="alt">${a(`${ctx.layout.notes.get(str(n.id))}.docx`, "Word")}</span>${depth < 8 ? tree(str(n.id), depth + 1) : ""}</li>`).join("")}</ul>`;
  };
  const daily = notes.filter((n) => n.kind === "daily" && !n.parent_id).sort((x, y) => str(y.daily_date).localeCompare(str(x.daily_date)));
  const dailyHtml = daily.length
    ? `<details><summary>${esc(ctx.w.dirs.daily)} <span class="n">${daily.length}</span></summary><ul class="cols">${daily.map((n) => `<li>${a(`${ctx.layout.notes.get(str(n.id))}.md`, str(n.daily_date) || noteTitle(n))}</li>`).join("")}</ul></details>`
    : "";
  section("notes", t.notes, tree("", 0) + dailyHtml, notes.length);

  const meetings = [...(ctx.tables.meetings ?? [])].sort((x, y) => str(y.starts_at).localeCompare(str(x.starts_at)));
  const mw = meetingWords(ctx.en);
  section(
    "meetings",
    t.meetings,
    meetings.length
      ? `<table><tbody>${meetings
          .map((m) => {
            const stem = ctx.layout.meetings.get(str(m.id))!;
            return `<tr><td class="date">${esc(formatDateTime(str(m.starts_at), ctx.en ? "en" : "tr"))}</td><td>${a(`${stem}.md`, str(m.title))} <span class="alt">${a(`${stem}.docx`, "Word")}</span></td><td class="muted kind">${esc(mw.kinds[str(m.kind)] ?? "")}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : "",
    meetings.length,
  );

  const reports = ctx.tables.reports ?? [];
  section(
    "reports",
    t.reports,
    reports.length
      ? `<ul>${reports.map((r) => `<li>${a(`${ctx.layout.reports.get(str(r.id))}.docx`, str(r.title))} <span class="alt">${a(`${ctx.layout.reports.get(str(r.id))}.md`, "Markdown")}</span> <span class="muted">${esc(r.status === "final" ? t.final : t.draft)}</span></li>`).join("")}</ul>`
      : "",
    reports.length,
  );

  // Files under their folders, like the Belgeler screen.
  let filesHtml = "";
  if (!meta.files) filesHtml = `<p class="muted">${esc(t.noFiles)}</p>`;
  else {
    const current = ctx.layout.files.filter((f) => f.current);
    const olderCount = new Map<string, number>();
    for (const f of ctx.layout.files) if (!f.current) olderCount.set(f.documentId, (olderCount.get(f.documentId) ?? 0) + 1);
    const byDir = new Map<string, typeof current>();
    for (const f of current) {
      const dir = f.path.slice(0, f.path.lastIndexOf("/"));
      byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
    }
    const dirs = [...byDir.keys()].sort((x, y) => x.localeCompare(y, "tr"));
    filesHtml = dirs
      .map(
        (dir) =>
          `<h3>${esc(dir.split("/").slice(1).join(" / ") || ctx.w.dirs.files)}</h3><table><tbody>${byDir
            .get(dir)!
            .map(
              (f) =>
                `<tr><td>${a(f.path, f.path.slice(dir.length + 1))}${olderCount.get(f.documentId) ? ` <span class="muted">+${olderCount.get(f.documentId)} ${esc(t.older)}</span>` : ""}</td><td class="num">${esc(size(f.size, ctx.en))}</td>${ctx.layout.parts > 1 ? `<td class="muted">${esc(t.part(f.part))}</td>` : ""}</tr>`,
            )
            .join("")}</tbody></table>`,
      )
      .join("");
  }
  if (meta.held.length) filesHtml += `<h3>${esc(t.held)}</h3><ul>${meta.held.map((h) => `<li>${esc(h.title)}</li>`).join("")}</ul>`;
  section("files", t.files, filesHtml, meta.files ? ctx.layout.files.filter((f) => f.current).length : undefined);

  // The latest briefs in view, years of them behind one click.
  const briefs = [...(ctx.tables.briefs ?? [])].sort((x, y) => str(y.day).localeCompare(str(x.day)));
  const briefItem = (b: BackupRow) => `<li>${a(ctx.layout.briefs.get(str(b.id))!, `${str(b.day)} · ${str(b.title)}`)}</li>`;
  section(
    "briefs",
    t.briefs,
    briefs.length
      ? `<ul>${briefs.slice(0, 10).map(briefItem).join("")}</ul>${briefs.length > 10 ? `<details><summary>${esc(t.more(briefs.length - 10))}</summary><ul>${briefs.slice(10).map(briefItem).join("")}</ul></details>` : ""}`
      : "",
    briefs.length,
  );

  const nav = [
    ["tables", t.workbooks],
    ["notes", t.notes],
    ["meetings", t.meetings],
    ["reports", t.reports],
    ["files", t.files],
    ["briefs", t.briefs],
  ]
    .map(([id, label]) => `<a href="#${id}">${esc(label!)}</a>`)
    .join("");

  return `<!doctype html>
<html lang="${ctx.en ? "en" : "tr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.projectName)} · ${esc(t.title)}</title>
<style>
:root{--bg:#fbfbf9;--panel:#f2f2ee;--ink:#111;--ink2:#3a3a37;--muted:#6b6b66;--line:#e4e4de;--accent:#b45309;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--panel:#1c1c1a;--ink:#f2f2ee;--ink2:#d4d4cf;--muted:#9a9a93;--line:#2c2c29;--accent:#f59e0b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:40px 16px 80px}
h1{font:400 44px/1.1 "Instrument Serif",Georgia,"Times New Roman",serif;margin:0 0 8px}
h2{font:400 30px/1.2 "Instrument Serif",Georgia,serif;margin:48px 0 12px;border-bottom:1px solid var(--line);padding-bottom:8px}
h3{font-size:15px;font-weight:600;margin:24px 0 6px;color:var(--ink2)}
a{color:var(--ink);text-decoration-color:var(--line);text-underline-offset:3px}
a:hover{text-decoration-color:var(--ink)}
.lede{color:var(--muted);margin:0}
.note{background:var(--panel);border-radius:16px;padding:12px 16px;margin:20px 0;color:var(--ink2)}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}
nav a{border:1px solid var(--line);border-radius:999px;padding:8px 16px;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
ul{padding-left:20px;margin:6px 0}
li{margin:3px 0}
.grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.grid a{display:block;border:1px solid var(--line);border-radius:16px;padding:12px 16px;text-decoration:none}
.cols{columns:3 140px}
table{width:100%;border-collapse:collapse;font-size:15px}
td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
td.date{white-space:nowrap;color:var(--muted);width:1%}
td.num{text-align:right;white-space:nowrap;color:var(--muted)}
.muted,.n{color:var(--muted)}
.n{font:500 15px system-ui,sans-serif}
.alt{font-size:13px}
.alt a{color:var(--muted)}
details summary{cursor:pointer;padding:6px 0;min-height:44px;display:flex;align-items:center;gap:6px}
@media (max-width:600px){td.kind{display:none}h1{font-size:36px}}
</style>
</head>
<body>
<main>
<p class="lede">${esc(meta.appName)}</p>
<h1>${esc(meta.projectName)}</h1>
<p class="lede">${esc(t.exported)}: ${esc(meta.when)} · ${esc(t.counts(meta.counts))}</p>
<p class="note">${esc(t.open)}</p>
<nav>${nav}</nav>
${out.join("\n")}
</main>
</body>
</html>
`;
}

/* ------------------------------ The export ------------------------------ */

export type ArchivePlan = {
  en: boolean;
  w: ArchiveWords;
  files: boolean;
  collected: CollectedTables;
  layout: Layout;
  appName: string;
  projectName: string;
  exportedAt: Date;
  closedAt: string | null;
};

export async function planArchive(opts: { locale: "tr" | "en"; files: boolean }): Promise<ArchivePlan> {
  const en = opts.locale === "en";
  const w = archiveWords(en);
  const [collected, settings] = await Promise.all([collectTables(), getSettings(["profile", "archive"])]);
  const layout = layoutArchive(collected.tables, w, { files: opts.files, partBytes: partSize() });
  return {
    en,
    w,
    files: opts.files,
    collected,
    layout,
    appName: settings.profile.appName,
    projectName: settings.profile.projectName,
    exportedAt: new Date(),
    closedAt: settings.archive.readOnly ? settings.archive.archivedAt : null,
  };
}

export function archiveFileName(plan: ArchivePlan, part: number) {
  const date = dayOf(plan.exportedAt);
  const suffix = plan.layout.parts > 1 ? ` (${plan.w.partOf(part, plan.layout.parts)})` : "";
  return `${safeSegment(`${plan.appName} ${plan.w.exportName} ${date}`, 120)}${suffix}.zip`;
}

/** The data file the app restores from. */
export function backupOf(plan: ArchivePlan): Backup {
  const c = plan.collected;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema: SCHEMA_TAG,
    exportedAt: plan.exportedAt.toISOString(),
    appName: plan.appName,
    projectName: plan.projectName,
    locale: plan.en ? "en" : "tr",
    parts: plan.layout.parts,
    relations: c.relations,
    polymorphic: c.polymorphic,
    entityTables: c.entityTables,
    tables: c.tables,
    files: Object.fromEntries(plan.layout.files.map((f) => [f.versionId, { path: f.path, part: f.part, size: f.size, sha256: f.sha256 }])),
    held: c.held.map((h) => ({ title: h.title, reason: h.reason })),
  };
}

/** Every entry of one part, in the order they are written. */
export async function* archiveEntries(plan: ArchivePlan, part: number, origin: string): AsyncGenerator<ZipSource> {
  const { w, en, layout } = plan;
  const tables = plan.collected.tables;
  const locale = en ? "en" : "tr";
  const when = formatDateTime(plan.exportedAt, locale);
  const held = plan.collected.held.map((h) => ({ title: h.title, reason: h.reason }));
  const counts = {
    tasks: tables.tasks?.length ?? 0,
    notes: tables.notes?.length ?? 0,
    meetings: tables.meetings?.length ?? 0,
    documents: tables.documents?.length ?? 0,
    organisations: tables.organisations?.length ?? 0,
  };
  const readme = w.readmeText({
    appName: plan.appName,
    projectName: plan.projectName,
    when,
    part: layout.parts > 1 ? w.partOf(part, layout.parts) : null,
    parts: layout.parts,
    partOnlyFiles: part > 1,
    files: plan.files,
    closed: plan.closedAt ? formatLongDay(dayOf(plan.closedAt), locale) + ` ${plan.closedAt.slice(0, 4)}` : null,
    held,
  });
  yield { name: w.readme, data: readme, ...TEXT };

  if (part === 1) {
    const ctx = makeCtx(tables, layout, w, en, origin);
    yield { name: w.dataFile, data: JSON.stringify(backupOf(plan)), ...TEXT };
    yield { name: w.indexFile, data: indexHtml(ctx, { appName: plan.appName, projectName: plan.projectName, when, counts, held, files: plan.files }), ...TEXT };
    yield { name: w.workbooks.tasks, load: () => tasksWorkbook(tables, en), ...STORED };
    yield { name: w.workbooks.iptt, load: () => ipttWorkbook(en), ...STORED };
    yield { name: w.workbooks.workplan, load: () => workplanWorkbook({}, en), ...STORED };
    yield { name: w.workbooks.decisions, load: () => decisionsWorkbook({}, en, 100_000), ...STORED };
    yield { name: w.workbooks.partners, load: () => partnersWorkbook(tables, en), ...STORED };
    yield* noteEntries(ctx);
    yield* meetingEntries(ctx);
    yield* reportEntries(ctx);
    yield* briefEntries(ctx);
  }

  for (const f of layout.files) {
    if (f.part !== part) continue;
    yield {
      name: f.path,
      load: async () => {
        const buf = await getObjectBuffer(f.key);
        return buf ? new Uint8Array(buf.buffer, buf.byteOffset, buf.length) : null;
      },
      modified: f.modified,
      // Text-like files still shrink; PDFs, Office files and pictures are already compressed.
      compress: /\.(txt|csv|md|json|xml|html?|eml|svg)$/i.test(f.path),
    };
  }
}

/** For Ayarlar › Veri: how many files the export holds, how big it is, and in how many parts it comes. */
export async function exportSummary() {
  const s = schema;
  const db = await getDb();
  const live = and(isNull(s.documents.deletedAt), eq(s.documents.childDataFlag, false));
  const [folderRows, docRows, versionRows] = await Promise.all([
    db.select({ id: s.folders.id, name: s.folders.name, parent_id: s.folders.parentId }).from(s.folders).where(isNull(s.folders.deletedAt)),
    db.select({ id: s.documents.id, folder_id: s.documents.folderId, filename: s.documents.filename, current_version_id: s.documents.currentVersionId }).from(s.documents).where(live),
    db
      .select({ id: s.documentVersions.id, document_id: s.documentVersions.documentId, size: s.documentVersions.size, version: s.documentVersions.version, filename: s.documentVersions.filename })
      .from(s.documentVersions)
      .innerJoin(s.documents, eq(s.documents.id, s.documentVersions.documentId))
      .where(live),
  ]);
  const layout = layoutArchive({ folders: folderRows, documents: docRows, document_versions: versionRows }, archiveWords(false), { files: true, partBytes: partSize() });
  const partBytes = Array.from({ length: layout.parts }, (_, i) => layout.files.filter((f) => f.part === i + 1).reduce((n, f) => n + f.size, 0));
  return { files: layout.files.filter((f) => f.current).length, versions: layout.files.length, bytes: partBytes.reduce((a, b) => a + b, 0), parts: layout.parts, partBytes };
}
