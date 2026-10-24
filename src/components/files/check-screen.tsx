"use client";

import { Check, CheckCheck, ExternalLink, ShieldAlert, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { acceptClassificationsAction, clearChildFlagAction } from "@/app/(app)/files/actions";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { formatDateTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { formatBytes } from "@/lib/utils";
import type { CheckScreenData } from "@/server/views/files";
import { ClassificationCard } from "./classification-card";
import { FileIcon } from "./file-icon";
import { useUploader } from "./use-uploader";

/** Kontrol: Claude's filing proposals (Paperless inbox) and the files held back for child data. */
export function CheckScreen({ data, tab }: { data: CheckScreenData; tab: "suggestions" | "flagged" }) {
  const t = useTranslations("files.check");
  const tf = useTranslations("files");
  const router = useRouter();
  const shell = useShell();
  const readOnly = shell.readOnly;
  const [busy, setBusy] = useState(false);
  useScreenContext({ kind: "files-check", title: t("title") });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link href="/files" className="hover:text-ink">
            {tf("title")}
          </Link>
        }
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          tab === "suggestions" && data.items.length > 1 && !readOnly ? (
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await runAction(acceptClassificationsAction(data.items.map((i) => i.suggestion.id)));
                setBusy(false);
                if (res) {
                  router.refresh();
                  void import("sonner").then(({ toast }) => toast(t("allFiled", { count: res.count })));
                }
              }}
            >
              <CheckCheck size={16} />
              {t("acceptAll", { count: data.items.length })}
            </Button>
          ) : undefined
        }
      />
      <SegmentedLinks
        active={tab}
        items={[
          { key: "suggestions", label: t("tabs.suggestions"), href: "/files/check", count: data.items.length },
          { key: "flagged", label: t("tabs.flagged"), href: "/files/check?tab=flagged", count: data.flagged.length },
        ]}
      />
      {tab === "suggestions" ? (
        data.items.length === 0 ? (
          <EmptyState title={t("empty.title")} body={shell.aiConfigured ? t("empty.body") : t("empty.noAi")} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-muted">{t("hint")}</p>
            {data.items.map((item) => (
              <ClassificationCard
                key={item.suggestion.id}
                s={item.suggestion}
                file={item.file}
                docTypes={data.docTypes}
                orgs={data.orgs}
                folders={data.allFolders}
                readOnly={readOnly}
              />
            ))}
          </div>
        )
      ) : data.flagged.length === 0 ? (
        <EmptyState title={t("flaggedEmpty.title")} body={t("flaggedEmpty.body")} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3 rounded-2xl bg-accent-soft px-5 py-4 text-accent-ink">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            <p className="text-[14px]">{t("flaggedHint")}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {data.flagged.map((f) => (
              <FlaggedRow key={f.id} f={f} readOnly={readOnly} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FlaggedRow({ f, readOnly }: { f: CheckScreenData["flagged"][number]; readOnly: boolean }) {
  const t = useTranslations("files.check");
  const td = useTranslations("files.doc");
  const tc = useTranslations("common");
  const locale = useLocale();
  const trash = useTrash();
  const uploader = useUploader();
  const input = useRef<HTMLInputElement>(null);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line px-5 py-4">
      <input
        ref={input}
        type="file"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await uploader.upload([file], { folderId: f.folderId, documentId: f.id });
        }}
      />
      <div className="flex items-start gap-3">
        <FileIcon mime={f.mime} filename={f.filename} boxed />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link href={`/files/d/${f.id}`} className="truncate text-[15px] font-medium hover:underline">
            {f.title}
          </Link>
          <span className="text-[12.5px] text-muted">{[f.filename, formatBytes(f.size, locale), formatDateTime(f.createdAt, locale)].join(" · ")}</span>
          {f.reason ? <span className="text-[13px] text-accent-ink">{f.reason}</span> : null}
        </div>
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/files/d/${f.id}`}>
              <ExternalLink size={14} />
              {t("look")}
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={uploader.busy}>
            <Upload size={14} />
            {uploader.busy ? uploader.label : td("hold.upload")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => runAction(clearChildFlagAction(f.id), { success: td("hold.cleared") })}>
            <Check size={14} />
            {td("hold.clear")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => trash("document", f.id, { title: f.title })}>
            <Trash2 size={14} />
            {tc("delete")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
