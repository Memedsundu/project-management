import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { authChallenges } from "@/server/db/schema";
import { getSetting } from "@/server/services/settings";
import { newStorageKey, storageMode, storageReady } from "@/server/storage";

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

export const prepareSchema = z.object({
  name: z.string().trim().min(1).max(300),
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  type: z.string().max(200).default(""),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  folderId: z.string().uuid().nullish(),
  documentId: z.string().uuid().nullish(),
  note: z.string().max(300).nullish(),
});
export type PrepareInput = z.infer<typeof prepareSchema>;

export type PendingUpload = PrepareInput & { key: string };

/** Reserve a storage key for one upload. Only keys reserved here can be completed. */
export async function reserveUpload(input: PrepareInput) {
  if (!storageReady()) throw new Error("STORAGE_NOT_READY");
  const archive = await getSetting("archive");
  if (archive.readOnly) throw new Error("READ_ONLY");
  return reserveUploadKey(input, newStorageKey(input.name));
}

/** The reservation itself, for a key chosen by the caller (a restore keeps the backup's keys). */
export async function reserveUploadKey(input: PrepareInput, key: string) {
  const db = await getDb();
  const [row] = await db
    .insert(authChallenges)
    .values({ kind: "upload", challenge: key, data: { ...input, key }, expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000) })
    .returning({ id: authChallenges.id });
  return { uploadId: row!.id, key, mode: storageMode() };
}

export async function findPendingUpload(by: { id?: string; key?: string }) {
  const db = await getDb();
  const where = [eq(authChallenges.kind, "upload"), isNull(authChallenges.usedAt), gt(authChallenges.expiresAt, new Date())];
  if (by.id) where.push(eq(authChallenges.id, by.id));
  if (by.key) where.push(eq(authChallenges.challenge, by.key));
  const [row] = await db.select().from(authChallenges).where(and(...where)).limit(1);
  return row ? { id: row.id, ...(row.data as PendingUpload) } : null;
}

export async function markUploadUsed(id: string) {
  const db = await getDb();
  const rows = await db
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(and(eq(authChallenges.id, id), isNull(authChallenges.usedAt)))
    .returning({ id: authChallenges.id });
  return rows.length > 0;
}

/** Types a browser may show inline. Everything else downloads. */
export function inlineSafe(mime: string) {
  return mime === "application/pdf" || /^image\/(png|jpe?g|gif|webp|avif)$/.test(mime) || mime === "text/plain" || mime === "text/csv" || /^video\/(mp4|webm)$/.test(mime) || /^audio\//.test(mime);
}

export function guessMime(name: string, given: string) {
  if (given && given !== "application/octet-stream") return given;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    odt: "application/vnd.oasis.opendocument.text",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    eml: "message/rfc822",
    msg: "application/vnd.ms-outlook",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    zip: "application/zip",
  };
  return map[ext] ?? (given || "application/octet-stream");
}
