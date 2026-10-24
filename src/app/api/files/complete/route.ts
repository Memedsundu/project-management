import { refresh } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { findPendingUpload, guessMime, markUploadUsed } from "@/server/files/uploads";
import { addDocumentVersion, createDocumentFromUpload } from "@/server/services/documents";
import { objectExists } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Step 3: the bytes are stored; make the document (or the new version) and queue reading it. */
export async function POST(req: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z.object({ uploadId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const pending = await findPendingUpload({ id: parsed.data.uploadId });
  if (!pending) return Response.json({ error: "unknown" }, { status: 400 });
  if (!(await objectExists(pending.key))) return Response.json({ error: "missing" }, { status: 409 });
  if (!(await markUploadUsed(pending.id))) return Response.json({ error: "used" }, { status: 409 });
  const mime = guessMime(pending.name, pending.type);
  try {
    if (pending.documentId) {
      const ver = await addDocumentVersion(pending.documentId, { key: pending.key, filename: pending.name, mime, size: pending.size, sha256: pending.sha256, note: pending.note });
      return Response.json({ id: pending.documentId, versionId: ver.id, version: ver.version });
    }
    const doc = await createDocumentFromUpload({ key: pending.key, filename: pending.name, mime, size: pending.size, sha256: pending.sha256, folderId: pending.folderId ?? null });
    try {
      refresh();
    } catch {
      // Only available in server actions.
    }
    return Response.json({ id: doc.id, title: doc.title });
  } catch (err) {
    console.error("[upload complete]", err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
