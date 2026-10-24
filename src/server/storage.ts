import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { localDataDir } from "./local-data";

/**
 * The private file store. In production files go to a private Vercel Blob
 * store (BLOB_READ_WRITE_TOKEN); on a laptop and in tests they go to a local folder
 * outside the project (see local-data.ts).
 * Nothing here is ever public: files are served only through the signed-in
 * /api/files routes.
 */

export type StorageMode = "blob" | "local";

export function storageMode(): StorageMode {
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "local";
}

/** True when uploads can work: Blob in production, local disk elsewhere. */
export function storageReady() {
  if (storageMode() === "blob") return true;
  // Vercel functions cannot keep files on disk.
  return !process.env.VERCEL;
}

const LOCAL_DIR = () => process.env.LOCAL_UPLOAD_DIR ?? path.join(localDataDir(), "uploads");

function safeName(filename: string) {
  const base = filename.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
  return (base || "file").slice(-120);
}

/** A fresh key such as documents/2026/10/<uuid>/Rapor.pdf */
export function newStorageKey(filename: string, prefix = "documents") {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${ym}/${randomUUID()}/${safeName(filename)}`;
}

function localPath(key: string) {
  // Local mode only (never on Vercel), so the bundler need not trace this folder.
  const root = path.resolve(/*turbopackIgnore: true*/ LOCAL_DIR());
  const full = path.resolve(/*turbopackIgnore: true*/ root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Bad storage key");
  return full;
}

export async function putObject(key: string, data: Buffer | Uint8Array, contentType: string) {
  if (storageMode() === "blob") {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(data), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function objectExists(key: string) {
  if (storageMode() === "blob") {
    const { head } = await import("@vercel/blob");
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await stat(localPath(key));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (storageMode() === "blob") {
    const { get } = await import("@vercel/blob");
    const res = await get(key, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const chunks: Buffer[] = [];
    const reader = res.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  try {
    return await readFile(localPath(key));
  } catch {
    return null;
  }
}

/** A web stream of the file, for serving it without loading it all into memory. */
export async function getObjectStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null> {
  if (storageMode() === "blob") {
    const { get } = await import("@vercel/blob");
    const res = await get(key, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return { stream: res.stream as ReadableStream<Uint8Array>, size: res.blob.size };
  }
  try {
    const file = localPath(key);
    const info = await stat(file);
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    return { stream, size: info.size };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  if (storageMode() === "blob") {
    const { del } = await import("@vercel/blob");
    await del(key).catch(() => undefined);
    return;
  }
  await rm(localPath(key), { force: true });
  // Remove the per-file folder too (documents/yyyy/mm/<uuid>/).
  await rmdir(path.dirname(localPath(key))).catch(() => undefined);
}
