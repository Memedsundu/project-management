"use client";

import { Download, ExternalLink, FileQuestion } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fileKind } from "./types";

type Preview =
  | { kind: "html"; html: string; note?: string }
  | { kind: "sheets"; sheets: { name: string; rows: string[][]; more: boolean }[] }
  | { kind: "text"; pages: { page: number | null; text: string }[] }
  | { kind: "none" };

/**
 * Drive's preview: PDFs, pictures, sound and video in the browser's own viewer;
 * Word and Excel rendered on the server from the stored bytes; anything else as
 * the text search reads. A page number from search opens that page.
 */
export function FilePreview({
  docId,
  versionId,
  mime,
  filename,
  page,
  textStatus,
  className,
}: {
  docId: string;
  versionId?: string | null;
  mime: string;
  filename: string;
  page: number | null;
  textStatus: string;
  className?: string;
}) {
  const kind = fileKind(mime, filename);
  const v = versionId ? `v=${versionId}` : "";
  const src = `/api/files/${docId}/content${v ? `?${v}` : ""}`;
  const browserShows = kind === "pdf" || (kind === "image" && !/heic|heif|tiff/.test(mime)) || /^video\/(mp4|webm)$/.test(mime) || kind === "audio";

  if (kind === "pdf") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <iframe
          key={`${src}#${page ?? ""}`}
          src={`${src}#${page ? `page=${page}&` : ""}view=FitH`}
          title={filename}
          className="h-[72vh] min-h-[420px] w-full rounded-2xl border border-line bg-panel"
        />
        <OpenLinks src={src} />
      </div>
    );
  }
  if (kind === "image" && browserShows) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div className="flex max-h-[72vh] items-center justify-center overflow-auto rounded-2xl border border-line bg-panel p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private file served by our own route */}
          <img src={src} alt={filename} className="max-h-[68vh] w-auto max-w-full object-contain" />
        </div>
        <OpenLinks src={src} />
      </div>
    );
  }
  if (kind === "video" && browserShows) {
    return (
      <video src={src} controls className={cn("max-h-[72vh] w-full rounded-2xl border border-line bg-black", className)}>
        <track kind="captions" />
      </video>
    );
  }
  if (kind === "audio") {
    return <audio src={src} controls className={cn("w-full", className)} />;
  }
  return <ServerPreview docId={docId} query={v} page={page} textStatus={textStatus} className={className} />;
}

function OpenLinks({ src }: { src: string }) {
  const t = useTranslations("files.preview");
  return (
    <div className="flex flex-wrap gap-2 text-[13px]">
      <a href={src} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
        <ExternalLink size={13} />
        {t("openNewTab")}
      </a>
    </div>
  );
}

function ServerPreview({ docId, query, page, textStatus, className }: { docId: string; query: string; page: number | null; textStatus: string; className?: string }) {
  const t = useTranslations("files.preview");
  const [state, setState] = useState<{ key: string; data: Preview | null; error: boolean }>({ key: "", data: null, error: false });
  const [sheet, setSheet] = useState(0);
  const key = `${docId}?${query}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/files/${docId}/preview${query ? `?${query}` : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<Preview>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => live && setState({ key, data, error: false }))
      .catch(() => live && setState({ key, data: null, error: true }));
    return () => {
      live = false;
    };
  }, [docId, query, key]);

  // Jump to the page search or Ask pointed at.
  useEffect(() => {
    if (!page || state.data?.kind !== "text") return;
    document.getElementById(`preview-page-${page}`)?.scrollIntoView({ block: "start" });
  }, [page, state.data]);

  const box = cn("max-h-[72vh] overflow-auto rounded-2xl border border-line bg-bg", className);
  if (state.key !== key) return <div className={cn(box, "flex h-64 items-center justify-center text-[14px] text-muted")}>{t("loading")}</div>;
  const data = state.data;
  if (state.error || !data || data.kind === "none" || (data.kind === "text" && !data.pages.length)) {
    return (
      <div className={cn("flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-8", className)}>
        <FileQuestion size={22} className="text-muted" />
        <p className="text-[15px] font-medium">{t("none")}</p>
        <p className="max-w-[56ch] text-[14px] text-muted">{textStatus === "pending" ? t("stillReading") : textStatus === "failed" ? t("readFailed") : t("noneBody")}</p>
        <Button variant="outline" asChild>
          <a href={`/api/files/${docId}/content?download=1${query ? `&${query}` : ""}`}>
            <Download size={15} />
            {t("download")}
          </a>
        </Button>
      </div>
    );
  }
  if (data.kind === "html") {
    return (
      <div className={box}>
        {data.note ? <p className="border-b border-line px-6 py-2 text-[12.5px] text-muted">{data.note}</p> : null}
        {/* Sanitized on the server (mammoth output through sanitize-html). */}
        <div className="prose-app doc-preview mx-auto max-w-[760px] px-6 py-6" dangerouslySetInnerHTML={{ __html: data.html }} />
      </div>
    );
  }
  if (data.kind === "sheets") {
    const cur = data.sheets[sheet] ?? data.sheets[0];
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {data.sheets.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("sheets")}>
            {data.sheets.map((s, i) => (
              <button
                key={s.name + i}
                type="button"
                role="tab"
                aria-selected={i === sheet}
                onClick={() => setSheet(i)}
                className={cn("h-8 rounded-full px-3 text-[13px]", i === sheet ? "bg-ink text-on-ink" : "bg-panel text-ink-2 hover:bg-panel-2")}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="max-h-[68vh] overflow-auto rounded-2xl border border-line">
          <table className="min-w-full border-collapse text-[13px]">
            <tbody>
              {(cur?.rows ?? []).map((row, ri) => (
                <tr key={ri} className={ri === 0 ? "bg-panel font-medium" : "border-t border-line-soft"}>
                  <td className="sticky left-0 border-r border-line-soft bg-panel px-2 py-1 text-right text-[11px] text-faint">{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className="max-w-[280px] truncate whitespace-nowrap px-2.5 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cur?.more ? <p className="text-[12.5px] text-muted">{t("moreRows")}</p> : null}
      </div>
    );
  }
  return (
    <div className={box}>
      <p className="border-b border-line px-6 py-2 text-[12.5px] text-muted">{t("textOnly")}</p>
      <div className="flex flex-col gap-6 px-6 py-5">
        {data.pages.map((p, i) => (
          <section key={`${p.page}-${i}`} id={p.page ? `preview-page-${p.page}` : undefined} className={cn("scroll-mt-4", page && p.page === page && "rounded-xl bg-accent-soft/40 -mx-3 px-3 py-2")}>
            {p.page ? <h3 className="label-caps mb-2">{t("page", { page: p.page })}</h3> : null}
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{p.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
