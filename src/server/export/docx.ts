import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { markdownToBlocks, type Block, type Inline, type InlineLink, type InlineMention, type InlineText } from "@/lib/blocks";

/**
 * Word export for pages and reports. Blocks become real Word headings,
 * lists and tables, so the file can be edited and restyled in Word.
 */

const FONT = "Calibri";
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function runsOf(content: Block["content"], base: { bold?: boolean; italics?: boolean } = {}, origin = ""): ParagraphChild[] {
  if (!content) return [];
  if (typeof content === "string") return [new TextRun({ text: content, ...base })];
  if (!Array.isArray(content)) return [];
  const out: ParagraphChild[] = [];
  for (const c of content as Inline[]) {
    if (c.type === "text") {
      const t = c as InlineText;
      const st = t.styles ?? {};
      const parts = t.text.split("\n");
      parts.forEach((part, i) => {
        out.push(
          new TextRun({
            text: part,
            bold: base.bold || Boolean(st.bold),
            italics: base.italics || Boolean(st.italic),
            strike: Boolean(st.strike),
            underline: st.underline ? {} : undefined,
            font: st.code ? "Consolas" : undefined,
            break: i > 0 ? 1 : undefined,
          }),
        );
      });
    } else if (c.type === "link") {
      const l = c as InlineLink;
      const text = l.content.map((x) => x.text).join("");
      const href = /^https?:\/\//.test(l.href) ? l.href : l.href.startsWith("/") && origin ? origin + l.href : null;
      if (href) out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text, style: "Hyperlink" })] }));
      else out.push(new TextRun({ text, ...base }));
    } else if (c.type === "mention") {
      const m = c as InlineMention;
      out.push(new TextRun({ text: m.props.title, bold: true }));
    }
  }
  return out;
}

function tableOf(block: Block, origin: string) {
  const tc = block.content as { rows?: { cells: (Inline[] | { type: "tableCell"; content: Inline[] })[] }[]; headerRows?: number } | undefined;
  const rows = tc?.rows ?? [];
  if (!rows.length) return null;
  const header = tc?.headerRows ?? 1;
  const width = Math.max(...rows.map((r) => r.cells.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r, ri) =>
        new TableRow({
          tableHeader: ri < header,
          children: Array.from({ length: width }, (_, ci) => {
            const cell = r.cells[ci];
            const content = cell ? (Array.isArray(cell) ? cell : cell.content) : [];
            return new TableCell({
              children: [new Paragraph({ children: runsOf(content, ri < header ? { bold: true } : {}, origin) })],
              shading: ri < header ? { fill: "F2F2EE" } : undefined,
            });
          }),
        }),
    ),
  });
}

function walk(blocks: Block[], depth: number, out: (Paragraph | Table)[], origin: string) {
  for (const b of blocks) {
    const level = Math.min(depth, 8);
    switch (b.type) {
      case "heading": {
        const n = Math.min(Math.max(Number(b.props?.level ?? 1), 1), 6);
        out.push(new Paragraph({ heading: HEADINGS[n - 1], children: runsOf(b.content, {}, origin) }));
        break;
      }
      case "bulletListItem":
      case "toggleListItem":
        out.push(new Paragraph({ bullet: { level }, children: runsOf(b.content, {}, origin) }));
        break;
      case "numberedListItem":
        out.push(new Paragraph({ numbering: { reference: "numbered", level }, children: runsOf(b.content, {}, origin) }));
        break;
      case "checkListItem":
        out.push(new Paragraph({ indent: { left: 360 * level }, children: [new TextRun({ text: b.props?.checked ? "☑ " : "☐ " }), ...runsOf(b.content, {}, origin)] }));
        break;
      case "task":
        if (b.props?.title) out.push(new Paragraph({ indent: { left: 360 * level }, children: [new TextRun({ text: `${b.props?.done ? "☑" : "☐"} ${String(b.props.title)}` })] }));
        break;
      case "entityCard":
        if (b.props?.title) out.push(new Paragraph({ children: [new TextRun({ text: `↗ ${String(b.props.title)}`, italics: true })] }));
        break;
      case "quote":
        out.push(
          new Paragraph({
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } },
            children: runsOf(b.content, { italics: true }, origin),
          }),
        );
        break;
      case "codeBlock": {
        const text = typeof b.content === "string" ? b.content : (b.content as Inline[] | undefined)?.map((c) => (c as InlineText).text ?? "").join("") ?? "";
        for (const line of text.split("\n")) out.push(new Paragraph({ children: [new TextRun({ text: line, font: "Consolas", size: 20 })] }));
        break;
      }
      case "divider":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 4 } }, children: [] }));
        break;
      case "pageBreak":
        out.push(new Paragraph({ pageBreakBefore: true, children: [] }));
        break;
      case "table": {
        const table = tableOf(b, origin);
        if (table) {
          out.push(table);
          out.push(new Paragraph({ children: [] }));
        }
        break;
      }
      case "image":
      case "file":
      case "video":
      case "audio": {
        const name = String(b.props?.caption || b.props?.name || "");
        out.push(new Paragraph({ children: [new TextRun({ text: `[${b.type === "image" ? "Görsel" : "Dosya"}${name ? `: ${name}` : ""}]`, italics: true, color: "666666" })] }));
        break;
      }
      default: {
        const runs = runsOf(b.content, {}, origin);
        out.push(new Paragraph({ indent: depth ? { left: 360 * level } : undefined, children: runs }));
      }
    }
    if (b.children?.length) walk(b.children, depth + 1, out, origin);
  }
}

export async function buildDocx(input: { title: string; subtitle?: string | null; blocks?: Block[]; markdown?: string; origin?: string }) {
  const blocks = input.blocks ?? markdownToBlocks(input.markdown ?? "");
  const body: (Paragraph | Table)[] = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: input.title || "—" })] })];
  if (input.subtitle) body.push(new Paragraph({ children: [new TextRun({ text: input.subtitle, color: "666666" })] }));
  walk(blocks, 0, body, input.origin ?? "");
  const doc = new Document({
    creator: "[uygulama]",
    title: input.title,
    styles: {
      default: { document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
    },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: i % 3 === 0 ? LevelFormat.DECIMAL : i % 3 === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN,
            text: `%${i + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ properties: {}, children: body }],
  });
  return Packer.toBuffer(doc);
}

/** File names she can read: "Saha ziyareti 12 Ekim.docx", without characters Windows refuses. */
export function safeFileName(title: string, ext: string) {
  const base = (title || "belge").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "belge";
  return `${base}.${ext}`;
}

export function attachmentHeaders(filename: string, mime: string) {
  const ascii = filename.replace(/[^\w.\- ]+/g, "_");
  return {
    "Content-Type": mime,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
