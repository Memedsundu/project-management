"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadOne, type UploadOpts } from "./upload-core";

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
  const self = useRef<((files: File[], opts: UploadOpts) => Promise<boolean>) | null>(null);

  const upload = useCallback(
    async (files: File[], opts: UploadOpts) => {
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
          const out = await uploadOne(file, opts, (stage, percent) => setLabel(`${prefix}${t(stage)}${percent !== undefined ? ` ${percent}%` : ""}`));
          if (out.ok) {
            done.push({ id: out.id, title: out.title });
            continue;
          }
          if ("duplicate" in out) {
            const dup = out.duplicate;
            toast(t("duplicate", { name: file.name }), {
              duration: 8000,
              action: { label: t("openExisting"), onClick: () => router.push(`/files/d/${dup.id}`) },
              cancel: { label: t("uploadAnyway"), onClick: () => void self.current?.([file], { ...opts, force: true }) },
            });
            continue;
          }
          if (out.error === "too_large") toast.error(t("tooLarge", { name: file.name }));
          else if (out.error === "storage_not_ready") toast.error(t("storageNotReady"));
          else if (out.error === "read_only") toast.error(t("readOnly"));
          else toast.error(t("failed", { name: file.name }));
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
