import { and, asc, eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { docPassages, documents, documentVersions } from "@/server/db/schema";
import { getObjectBuffer } from "@/server/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_RENDER = 15 * 1024 * 1024;

type Preview =
  | { kind: "html"; html: string; note?: string }
  | { kind: "sheets"; sheets: { name: string; rows: string[][]; more: boolean }[] }
  | { kind: "text"; pages: { page: number | null; text: string }[] }
  | { kind: "none" };

/**
 * In-app preview for files the browser cannot show itself: Word as HTML,
 * Excel as tables, everything else as the text Claude and search read.
 * Built from the stored bytes; nothing in the file is ever run.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[docId]/preview">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { docId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });
  const versionId = url.searchParams.get("v") ?? doc.currentVersionId;
  if (!versionId) return Response.json({ kind: "none" } satisfies Preview);
  const [ver] = await db.select().from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, docId))).limit(1);
  if (!ver) return new Response("Not found", { status: 404 });
  const name = ver.filename.toLowerCase();
  const headers = { "Cache-Control": "private, max-age=300" };

  try {
    if ((name.endsWith(".docx") || ver.mime.includes("wordprocessingml")) && ver.size <= MAX_RENDER) {
      const buf = await getObjectBuffer(ver.storageKey);
      if (buf) {
        const mammoth = await import("mammoth");
        const res = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
        const html = sanitizeHtml(res.value, {
          allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "u", "s", "table", "thead", "tbody", "tr", "td", "th", "br", "a", "blockquote", "sup", "sub"],
          allowedAttributes: { a: ["href"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
          allowedSchemes: ["http", "https", "mailto"],
        });
        return Response.json({ kind: "html", html } satisfies Preview, { headers });
      }
    }
    if ((name.endsWith(".xlsx") || ver.mime.includes("spreadsheetml")) && ver.size <= MAX_RENDER) {
      const buf = await getObjectBuffer(ver.storageKey);
      if (buf) {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
        const sheets = wb.worksheets.slice(0, 6).map((ws) => {
          const rows: string[][] = [];
          let more = false;
          ws.eachRow({ includeEmpty: false }, (row) => {
            if (rows.length >= 300) {
              more = true;
              return;
            }
            rows.push((row.values as unknown[]).slice(1, 41).map((v) => cellText(v)));
          });
          return { name: ws.name, rows, more };
        });
        return Response.json({ kind: "sheets", sheets } satisfies Preview, { headers });
      }
    }
  } catch (err) {
    console.error("[preview]", ver.filename, err);
  }

  // Everything else (and big files): the extracted text, page by page.
  const passages = await db
    .select({ page: docPassages.page, chunk: docPassages.chunk, text: docPassages.text })
    .from(docPassages)
    .where(eq(docPassages.versionId, ver.id))
    .orderBy(asc(docPassages.page), asc(docPassages.chunk))
    .limit(4000);
  if (!passages.length) return Response.json({ kind: "none" } satisfies Preview, { headers });
  const pages: { page: number | null; text: string }[] = [];
  for (const p of passages) {
    const last = pages[pages.length - 1];
    if (last && last.page === p.page) last.text = joinOverlap(last.text, p.text);
    else pages.push({ page: p.page, text: p.text });
  }
  return Response.json({ kind: "text", pages } satisfies Preview, { headers });
}

/** Passages overlap by about 150 characters; drop the repeated part when joining them. */
function joinOverlap(a: string, b: string) {
  const tail = a.slice(-260);
  const probe = b.slice(0, 40);
  const i = probe.length >= 20 ? tail.lastIndexOf(probe) : -1;
  if (i >= 0 && b.startsWith(tail.slice(i))) return a + b.slice(tail.length - i);
  return `${a}\n${b}`;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text ?? "");
    if ("result" in o) return cellText(o.result);
    return "";
  }
  return String(v);
}
