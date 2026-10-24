"use client";

export const MAX_UPLOAD = 250 * 1024 * 1024;

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Prepared = { uploadId: string; key: string; mode: "blob" | "local" } | { duplicate: { id: string; title: string } } | { error: string };

export type UploadOpts = { folderId: string | null; documentId?: string; note?: string; force?: boolean };

export type UploadOutcome =
  | { ok: true; id: string; title: string }
  | { ok: false; duplicate: { id: string; title: string } }
  | { ok: false; error: "too_large" | "storage_not_ready" | "read_only" | "failed" };

/**
 * One file the Drive way: the server checks for a duplicate and reserves a
 * private key, the browser sends the bytes straight to storage, then the
 * server files the document and Claude reads it in the background.
 */
export async function uploadOne(file: File, opts: UploadOpts, onStage?: (stage: "reading" | "uploading" | "saving", percent?: number) => void): Promise<UploadOutcome> {
  if (file.size > MAX_UPLOAD) return { ok: false, error: "too_large" };
  onStage?.("reading");
  const sha256 = await sha256Hex(file);
  const res = await fetch(`/api/files/prepare${opts.force ? "?force=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type, sha256, folderId: opts.folderId, documentId: opts.documentId ?? null, note: opts.note ?? null }),
  });
  const prep = (await res.json().catch(() => ({ error: "error" }))) as Prepared;
  if ("duplicate" in prep) return { ok: false, duplicate: prep.duplicate };
  if ("error" in prep) return { ok: false, error: prep.error === "storage_not_ready" ? "storage_not_ready" : prep.error === "read_only" ? "read_only" : "failed" };
  onStage?.("uploading");
  if (prep.mode === "blob") {
    const { upload: put } = await import("@vercel/blob/client");
    await put(prep.key, file, {
      access: "private",
      handleUploadUrl: "/api/files/blob-token",
      multipart: file.size > 8 * 1024 * 1024,
      contentType: file.type || undefined,
      onUploadProgress: (p) => onStage?.("uploading", Math.round(p.percentage)),
    });
  } else {
    const put = await fetch(`/api/files/local-upload?upload=${prep.uploadId}`, { method: "PUT", body: file });
    if (!put.ok) return { ok: false, error: "failed" };
  }
  onStage?.("saving");
  const fin = await fetch("/api/files/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId: prep.uploadId }),
  });
  const out = (await fin.json().catch(() => ({}))) as { id?: string; title?: string };
  if (!fin.ok || !out.id) return { ok: false, error: "failed" };
  return { ok: true, id: out.id, title: out.title ?? file.name };
}
