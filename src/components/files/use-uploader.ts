"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX = 250 * 1024 * 1024;

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Prepared = { uploadId: string; key: string; mode: "blob" | "local" } | { duplicate: { id: string; title: string } } | { error: string };

/**
 * Upload files the Drive way: straight from the browser to private storage,
 * then the server files them and Claude reads them in the background.
 */
export function useUploader() {
  const t = useTranslations("files.upload");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  // The duplicate toast offers "upload anyway", which calls upload again.
  const self = useRef<((files: File[], opts: { folderId: string | null; documentId?: string; note?: string; force?: boolean }) => Promise<boolean>) | null>(null);

  const upload = useCallback(
    async (files: File[], opts: { folderId: string | null; documentId?: string; note?: string; force?: boolean }) => {
      if (!files.length) return false;
      if (!navigator.onLine) {
        toast.error(t("offline"));
        return false;
      }
      setBusy(true);
      const done: { id: string; title: string }[] = [];
      try {
        for (const [i, file] of files.entries()) {
          const prefix = files.length > 1 ? `${i + 1}/${files.length} · ` : "";
          if (file.size > MAX) {
            toast.error(t("tooLarge", { name: file.name }));
            continue;
          }
          setLabel(`${prefix}${t("reading")}`);
          const sha256 = await sha256Hex(file);
          const res = await fetch(`/api/files/prepare${opts.force ? "?force=1" : ""}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, size: file.size, type: file.type, sha256, folderId: opts.folderId, documentId: opts.documentId ?? null, note: opts.note ?? null }),
          });
          const prep = (await res.json().catch(() => ({ error: "error" }))) as Prepared;
          if ("duplicate" in prep) {
            const dup = prep.duplicate;
            toast(t("duplicate", { name: file.name }), {
              duration: 8000,
              action: { label: t("openExisting"), onClick: () => router.push(`/files/d/${dup.id}`) },
              cancel: { label: t("uploadAnyway"), onClick: () => void self.current?.([file], { ...opts, force: true }) },
            });
            continue;
          }
          if ("error" in prep) {
            toast.error(prep.error === "storage_not_ready" ? t("storageNotReady") : prep.error === "read_only" ? t("readOnly") : t("failed", { name: file.name }));
            continue;
          }
          setLabel(`${prefix}${t("uploading")}`);
          if (prep.mode === "blob") {
            const { upload: put } = await import("@vercel/blob/client");
            await put(prep.key, file, {
              access: "private",
              handleUploadUrl: "/api/files/blob-token",
              multipart: file.size > 8 * 1024 * 1024,
              contentType: file.type || undefined,
              onUploadProgress: (p) => setLabel(`${prefix}${t("uploading")} ${Math.round(p.percentage)}%`),
            });
          } else {
            const put = await fetch(`/api/files/local-upload?upload=${prep.uploadId}`, { method: "PUT", body: file });
            if (!put.ok) {
              toast.error(t("failed", { name: file.name }));
              continue;
            }
          }
          setLabel(`${prefix}${t("saving")}`);
          const fin = await fetch("/api/files/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId: prep.uploadId }),
          });
          const out = (await fin.json().catch(() => ({}))) as { id?: string; title?: string };
          if (!fin.ok || !out.id) {
            toast.error(t("failed", { name: file.name }));
            continue;
          }
          done.push({ id: out.id, title: out.title ?? file.name });
        }
      } catch (err) {
        console.error(err);
        toast.error(t("failedGeneric"));
      } finally {
        setBusy(false);
        setLabel("");
      }
      if (done.length) {
        router.refresh();
        if (opts.documentId) toast(t("versionDone"));
        else
          toast(done.length === 1 ? t("doneOne", { name: done[0]!.title }) : t("doneMany", { count: done.length }), {
            action: done.length === 1 ? { label: t("open"), onClick: () => router.push(`/files/d/${done[0]!.id}`) } : undefined,
          });
      }
      return done.length > 0;
    },
    [router, t],
  );

  useEffect(() => {
    self.current = upload;
  }, [upload]);

  return { upload, busy, label };
}
