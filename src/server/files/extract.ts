import "server-only";

export type ExtractedPage = { page: number | null; text: string; label?: string };
export type Extracted = {
  pages: ExtractedPage[];
  pageCount: number | null;
  /** Header rows of tables (first row of each sheet), for the child-data guard. */
  headers: string[][];
  kind: "pdf" | "word" | "sheet" | "slides" | "text" | "email" | "image" | "other";
  /** True when the file is a scan or picture with no text layer. */
  needsOcr: boolean;
  meta?: Record<string, string | null>;
};

function ext(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function clean(s: string) {
  return s.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function xmlText(xml: string, tag: string) {
  const out: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!.replace(/<[^>]+>/g, ""));
  return out.map(decodeXml);
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text ?? "");
    if ("result" in o) return cellText(o.result);
    if ("formula" in o) return "";
    if ("error" in o) return "";
    return "";
  }
  return String(v);
}

/** Read the words out of a file. Never runs code from the file; macros and scripts are ignored. */
export async function extractFile(buf: Buffer, mime: string, filename: string): Promise<Extracted> {
  const e = ext(filename);
  if (mime === "application/pdf" || e === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t, i) => ({ page: i + 1, text: clean(t) }));
    const chars = pages.reduce((n, p) => n + p.text.length, 0);
    return { pages, pageCount: totalPages, headers: [], kind: "pdf", needsOcr: chars < Math.max(80, totalPages * 25) };
  }
  if (e === "docx" || mime.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const res = await mammoth.extractRawText({ buffer: buf });
    return { pages: splitLong(clean(res.value)), pageCount: null, headers: [], kind: "word", needsOcr: false };
  }
  if (e === "odt" || mime.includes("opendocument.text")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const xml = (await zip.file("content.xml")?.async("string")) ?? "";
    const paras = xmlText(xml, "text:p").concat(xmlText(xml, "text:h"));
    return { pages: splitLong(clean(paras.join("\n"))), pageCount: null, headers: [], kind: "word", needsOcr: false };
  }
  if (e === "xlsx" || mime.includes("spreadsheetml")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const pages: ExtractedPage[] = [];
    const headers: string[][] = [];
    wb.worksheets.forEach((ws, i) => {
      const lines: string[] = [];
      let first = true;
      ws.eachRow({ includeEmpty: false }, (row) => {
        const values = (row.values as unknown[]).slice(1).map(cellText);
        if (first) {
          headers.push(values.map((v) => v.trim()).filter(Boolean));
          first = false;
        }
        const line = values.join(" | ").replace(/(\s\|\s)+$/g, "").trim();
        if (line.replace(/[|\s]/g, "")) lines.push(line);
      });
      pages.push({ page: i + 1, text: clean(lines.join("\n")).slice(0, 200_000), label: ws.name });
    });
    return { pages, pageCount: wb.worksheets.length, headers, kind: "sheet", needsOcr: false };
  }
  if (e === "csv" || mime === "text/csv") {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
    return { pages: splitLong(clean(text)), pageCount: null, headers: [firstLine.split(sep).map((x) => x.replace(/^"|"$/g, "").trim())], kind: "sheet", needsOcr: false };
  }
  if (e === "pptx" || mime.includes("presentationml")) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
    const pages: ExtractedPage[] = [];
    for (const [i, name] of slides.entries()) {
      const xml = (await zip.file(name)?.async("string")) ?? "";
      const notesName = name.replace("slides/slide", "notesSlides/notesSlide");
      const notesXml = (await zip.file(notesName)?.async("string")) ?? "";
      const text = xmlText(xml, "a:t").join("\n");
      const notes = xmlText(notesXml, "a:t").join(" ");
      pages.push({ page: i + 1, text: clean(notes ? `${text}\n\n${notes}` : text) });
    }
    return { pages, pageCount: slides.length, headers: [], kind: "slides", needsOcr: false };
  }
  if (e === "eml" || mime === "message/rfc822") {
    const PostalMime = (await import("postal-mime")).default;
    const email = await PostalMime.parse(new Uint8Array(buf));
    const body = email.text ?? (email.html ? email.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ") : "");
    const head = [
      email.subject ? `Subject: ${email.subject}` : "",
      email.from ? `From: ${email.from.name ?? ""} <${email.from.address ?? ""}>` : "",
      email.date ? `Date: ${email.date}` : "",
    ].filter(Boolean);
    return {
      pages: splitLong(clean(`${head.join("\n")}\n\n${body}`)),
      pageCount: null,
      headers: [],
      kind: "email",
      needsOcr: false,
      meta: { subject: email.subject ?? null, from: email.from?.address ?? null, date: email.date ?? null },
    };
  }
  if (e === "msg" || mime === "application/vnd.ms-outlook") {
    const MsgReader = (await import("@kenjiuno/msgreader")).default;
    const reader = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const d = reader.getFileData();
    const head = [d.subject ? `Subject: ${d.subject}` : "", d.senderName ? `From: ${d.senderName} <${d.senderEmail ?? ""}>` : ""].filter(Boolean);
    return {
      pages: splitLong(clean(`${head.join("\n")}\n\n${d.body ?? ""}`)),
      pageCount: null,
      headers: [],
      kind: "email",
      needsOcr: false,
      meta: { subject: d.subject ?? null, from: d.senderEmail ?? null, date: (d as { messageDeliveryTime?: string }).messageDeliveryTime ?? null },
    };
  }
  if (mime.startsWith("text/") || ["txt", "md", "markdown", "json"].includes(e)) {
    return { pages: splitLong(clean(buf.toString("utf8"))), pageCount: null, headers: [], kind: "text", needsOcr: false };
  }
  if (mime.startsWith("image/")) {
    return { pages: [], pageCount: 1, headers: [], kind: "image", needsOcr: true };
  }
  return { pages: [], pageCount: null, headers: [], kind: "other", needsOcr: false };
}

/** Files without pages are cut into ~3,000-character parts so search can point inside them. */
function splitLong(text: string): ExtractedPage[] {
  if (!text) return [];
  const parts: ExtractedPage[] = [];
  const paras = text.split(/\n{2,}/);
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > 3000 && cur) {
      parts.push({ page: null, text: cur });
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) parts.push({ page: null, text: cur });
  return parts;
}

/** Cut a page into passages of about 1,200 characters with a little overlap. */
export function chunkPage(text: string, size = 1200, overlap = 150): string[] {
  const t = text.trim();
  if (t.length <= size) return t ? [t] : [];
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + size);
    if (end < t.length) {
      const breakAt = Math.max(t.lastIndexOf("\n", end), t.lastIndexOf(". ", end));
      if (breakAt > start + size * 0.5) end = breakAt + 1;
    }
    out.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}
