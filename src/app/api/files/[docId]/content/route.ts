import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { documents, documentVersions } from "@/server/db/schema";
import { inlineSafe } from "@/server/files/uploads";
import { touchDocument } from "@/server/services/documents";
import { getObjectStream } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Serves a stored file to the signed-in user only. Unsafe types always download. */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[docId]/content">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { docId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) return new Response("Not found", { status: 404 });
  const versionId = url.searchParams.get("v") ?? doc.currentVersionId;
  if (!versionId) return new Response("Not found", { status: 404 });
  const [ver] = await db.select().from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, docId))).limit(1);
  if (!ver) return new Response("Not found", { status: 404 });
  const file = await getObjectStream(ver.storageKey);
  if (!file) return new Response("File missing", { status: 404 });
  if (!url.searchParams.has("v")) await touchDocument(docId);
  const download = url.searchParams.has("download") || !inlineSafe(ver.mime);
  const headers = new Headers({
    "Content-Type": ver.mime,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ver.filename.replace(/[^\w.-]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(ver.filename)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
  });
  if (file.size) headers.set("Content-Length", String(file.size));
  return new Response(file.stream, { headers });
}
