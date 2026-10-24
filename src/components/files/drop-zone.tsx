"use client";

import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createFolderAction } from "@/app/(app)/files/actions";
import { runAction } from "@/lib/client/run-action";
import type { useUploader } from "./use-uploader";

type Picked = { file: File; dirs: string[] };

/* Folder entries from a drop (Chrome, Edge, Safari and Firefox all support webkitGetAsEntry). */
type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err?: (e: unknown) => void) => void } };

async function walk(entry: Entry, dirs: string[], out: Picked[]) {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    if (!file.name.startsWith(".")) out.push({ file, dirs });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns the folder in batches until it returns nothing.
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, [...dirs, entry.name], out);
    }
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<Picked[]> {
  const items = [...dt.items].filter((i) => i.kind === "file");
  const entries = items.map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some((e) => e?.isDirectory)) {
    const out: Picked[] = [];
    for (const e of entries) if (e) await walk(e, [], out);
    return out;
  }
  return [...dt.files].map((file) => ({ file, dirs: [] }));
}

export function filesFromInput(list: FileList | null): Picked[] {
  return [...(list ?? [])]
    .filter((f) => !f.name.startsWith("."))
    .map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const parts = rel.split("/").filter(Boolean);
      return { file, dirs: parts.slice(0, -1) };
    });
}

/** Upload files and whole folders: the folder tree is recreated under the current folder first. */
export async function uploadPicked(picked: Picked[], parentId: string | null, uploader: ReturnType<typeof useUploader>, labels: { creating: string }) {
  if (!picked.length) return;
  const folderIds = new Map<string, string | null>([["", parentId]]);
  const paths = [...new Set(picked.map((p) => p.dirs.join("/")))].sort((a, b) => a.split("/").length - b.split("/").length);
  if (paths.some(Boolean)) toast(labels.creating);
  for (const path of paths) {
    if (!path) continue;
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      if (folderIds.has(key)) continue;
      const parent = folderIds.get(parts.slice(0, i - 1).join("/")) ?? parentId;
      const res = await runAction(createFolderAction(parts[i - 1]!, parent));
      if (!res) return;
      folderIds.set(key, res.id);
    }
  }
  const byFolder = new Map<string, File[]>();
  for (const p of picked) {
    const key = p.dirs.join("/");
    byFolder.set(key, [...(byFolder.get(key) ?? []), p.file]);
  }
  for (const [key, files] of byFolder) await uploader.upload(files, { folderId: folderIds.get(key) ?? parentId });
}

/** Drop files or folders anywhere on the screen (Drive). */
export function FileDropOverlay({ folderId, uploader, disabled }: { folderId: string | null; uploader: ReturnType<typeof useUploader>; disabled?: boolean }) {
  const t = useTranslations("files.drop");
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    if (disabled) return;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setActive(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setActive(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const picked = await filesFromDrop(e.dataTransfer);
      await uploadPicked(picked, folderId, uploader, { creating: t("creatingFolders") });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [disabled, folderId, uploader, t]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-ink px-12 py-10 text-center">
        <UploadCloud size={36} />
        <p className="text-[18px] font-semibold">{t("title")}</p>
        <p className="text-[14px] text-muted">{t("body")}</p>
      </div>
    </div>
  );
}
