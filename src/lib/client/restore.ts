"use client";

import {
  restoreBeginAction,
  restoreFilesAction,
  restoreFinishAction,
  restoreIndexAction,
  restoreRowsAction,
} from "@/app/(app)/settings/data-actions";
import { BACKUP_VERSION, batchRows, DATA_FILE_PATHS, isBackup, PARENT_COLUMNS, parentsFirst, planRestore, type Backup, type BackupRow } from "@/lib/backup-format";
import { entryBlob, entryText, readZipEntries, type ZipEntryInfo } from "@/lib/zip-read";
import type { ActionResult } from "@/server/action";

/**
 * Restoring an export from the browser: the ZIPs never go to the server as
 * a whole. The data file is read here, each file goes straight to storage,
 * and the rows follow in batches small enough for one request each.
 */

type Zip = { file: File; entries: Map<string, ZipEntryInfo> };

export type ChosenBackup = {
  backup: Backup;
  /** Where each file version's bytes are, among the ZIPs she chose. */
  sources: Map<string, { zip: Zip; entry: ZipEntryInfo }>;
  partsFound: number;
  /** Files the backup lists that none of the chosen ZIPs holds. */
  missingFiles: number;
  counts: { tasks: number; notes: number; meetings: number; files: number; organisations: number; reports: number };
};

export async function readBackup(files: File[]): Promise<ChosenBackup | { error: "bad" | "newer" }> {
  const zips: Zip[] = [];
  let backup: Backup | null = null;
  let newer = false;
  for (const file of files) {
    let entries: ZipEntryInfo[];
    try {
      entries = await readZipEntries(file);
    } catch {
      continue;
    }
    const zip = { file, entries: new Map(entries.map((e) => [e.name, e])) };
    zips.push(zip);
    const data = DATA_FILE_PATHS.map((p) => zip.entries.get(p)).find(Boolean);
    if (!data) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await entryText(file, data));
    } catch {
      continue;
    }
    if (!isBackup(parsed)) continue;
    if (parsed.version > BACKUP_VERSION) {
      newer = true;
      continue;
    }
    // Two exports chosen together: the newer one counts.
    if (!backup || parsed.exportedAt > backup.exportedAt) backup = parsed;
  }
  if (!backup) return { error: newer ? "newer" : "bad" };

  const sources = new Map<string, { zip: Zip; entry: ZipEntryInfo }>();
  const parts = new Set([1]);
  for (const [versionId, f] of Object.entries(backup.files ?? {})) {
    for (const zip of zips) {
      const entry = zip.entries.get(f.path);
      if (entry && entry.size === f.size) {
        sources.set(versionId, { zip, entry });
        parts.add(f.part);
        break;
      }
    }
  }
  const t = backup.tables;
  return {
    backup,
    sources,
    partsFound: parts.size,
    missingFiles: Object.keys(backup.files ?? {}).length - sources.size,
    counts: {
      tasks: t.tasks?.length ?? 0,
      notes: (t.notes ?? []).filter((n) => n.kind !== "memory").length,
      meetings: t.meetings?.length ?? 0,
      files: t.documents?.length ?? 0,
      organisations: t.organisations?.length ?? 0,
      reports: t.reports?.length ?? 0,
    },
  };
}

export type RestoreProgress =
  | { step: "begin" }
  | { step: "files"; done: number; total: number }
  | { step: "rows"; done: number; total: number }
  | { step: "index"; done: number };

export type RestoreOutcome = { documents: number; skipped: number; damaged: string[] };

/** A step the server refused, or a request that did not get through. */
export class RestoreError extends Error {}

async function must<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  let res: ActionResult<T>;
  try {
    res = await promise;
  } catch {
    throw new RestoreError("");
  }
  if (!res.ok) throw new RestoreError(res.code === "invalid" || res.code === "error" ? "" : res.error);
  return res.data;
}

async function sha256Hex(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function send(blob: Blob, slot: { key: string; uploadId: string; mode: "blob" | "local" }, type: string) {
  if (slot.mode === "blob") {
    const { upload } = await import("@vercel/blob/client");
    await upload(slot.key, blob, { access: "private", handleUploadUrl: "/api/files/blob-token", multipart: blob.size > 8 * 1024 * 1024, contentType: type || undefined });
    return;
  }
  const put = await fetch(`/api/files/local-upload?upload=${slot.uploadId}`, { method: "PUT", body: blob });
  if (!put.ok) throw new Error(`upload ${put.status}`);
}

/** Up to three tries: a dropped connection should not end a long restore. */
async function sendWithRetry(blob: Blob, slot: { key: string; uploadId: string; mode: "blob" | "local" }, type: string, name: string, failed: (name: string) => string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(blob, slot, type);
    } catch (err) {
      if (attempt >= 3) {
        console.error(err);
        throw new RestoreError(failed(name));
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/**
 * The whole restore, step by step. Each step can be run again, so after a
 * failure she simply starts over with the same ZIPs; files that already
 * reached storage are not sent twice.
 */
export async function runRestore(chosen: ChosenBackup, onProgress: (p: RestoreProgress) => void, words: { uploadFailed: (name: string) => string }): Promise<RestoreOutcome> {
  const { backup } = chosen;
  onProgress({ step: "begin" });
  const { order } = await must(restoreBeginAction({ exportedAt: backup.exportedAt, projectName: backup.projectName }));

  // Files: the server says which are already in storage and where the rest go.
  const versions = backup.tables.document_versions ?? [];
  const keys = new Map<string, string>();
  const available = new Set<string>();
  const damaged: string[] = [];
  let done = 0;
  onProgress({ step: "files", done, total: versions.length });
  for (let i = 0; i < versions.length; i += 50) {
    const batch = versions.slice(i, i + 50);
    const byId = new Map(batch.map((v) => [String(v.id), v]));
    const slots = await must(
      restoreFilesAction(
        batch.map((v) => ({
          versionId: String(v.id),
          key: String(v.storage_key ?? ""),
          size: Number(v.size ?? 0),
          sha256: String(v.sha256 ?? ""),
          name: String(v.filename || "file"),
          type: String(v.mime ?? ""),
        })),
      ),
    );
    for (const slot of slots) {
      const v = byId.get(slot.versionId)!;
      const name = String(v.filename || "file");
      if (slot.status === "stored") {
        keys.set(slot.versionId, slot.key);
        available.add(slot.versionId);
      } else {
        const src = chosen.sources.get(slot.versionId);
        if (src) {
          const type = String(v.mime ?? "");
          const blob = await entryBlob(src.zip.file, src.entry, type);
          if ((await sha256Hex(blob)) !== String(v.sha256)) {
            damaged.push(name);
          } else {
            await sendWithRetry(blob, slot, type, name, words.uploadFailed);
            keys.set(slot.versionId, slot.key);
            available.add(slot.versionId);
          }
        }
      }
      onProgress({ step: "files", done: ++done, total: versions.length });
    }
  }

  // Rows: what can come back, in the server's order, parents before children.
  const plan = planRestore(backup, available);
  if (plan.tables.document_versions) {
    plan.tables.document_versions = plan.tables.document_versions.map((v) => ({ ...v, storage_key: keys.get(String(v.id)) ?? v.storage_key }));
  }
  const work = order
    .map((name) => {
      let rows: BackupRow[] = plan.tables[name] ?? [];
      const parent = PARENT_COLUMNS[name];
      if (parent) rows = parentsFirst(rows, parent);
      return { name, batches: batchRows(rows) };
    })
    .filter((w) => w.batches.length > 0);
  const total = work.reduce((n, w) => n + w.batches.reduce((m, b) => m + b.length, 0), 0);
  done = 0;
  onProgress({ step: "rows", done, total });
  for (const w of work) {
    for (const [i, batch] of w.batches.entries()) {
      await must(restoreRowsAction(w.name, batch, i === 0));
      done += batch.length;
      onProgress({ step: "rows", done, total });
    }
  }

  // The search index, in slices.
  let cursor: { type: number; after: string | null } | null = null;
  let indexed = 0;
  onProgress({ step: "index", done: 0 });
  do {
    const slice: { cursor: { type: number; after: string | null } | null; done: number } = await must(restoreIndexAction(cursor));
    indexed += slice.done;
    cursor = slice.cursor;
    onProgress({ step: "index", done: indexed });
  } while (cursor);

  const fin = await must(restoreFinishAction());
  return { documents: fin.documents, skipped: plan.skippedDocuments, damaged };
}
