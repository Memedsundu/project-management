import { File, FileImage, FileSpreadsheet, FileText, FileType2, Mail, Music, Presentation, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { fileKind, type FileKind } from "./types";

const ICON: Record<FileKind, typeof File> = {
  pdf: FileType2,
  word: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  image: FileImage,
  email: Mail,
  text: FileText,
  video: Video,
  audio: Music,
  other: File,
};

const LABEL: Record<FileKind, string> = { pdf: "PDF", word: "DOC", sheet: "XLS", slides: "PPT", image: "IMG", email: "EML", text: "TXT", video: "VID", audio: "SES", other: "" };

/** A quiet black-and-white file glyph with a small format label, like Drive's type icons without colour. */
export function FileIcon({ mime, filename, size = 18, className, boxed }: { mime: string; filename?: string; size?: number; className?: string; boxed?: boolean }) {
  const kind = fileKind(mime, filename);
  const Icon = ICON[kind];
  if (!boxed) return <Icon size={size} className={cn("shrink-0 text-ink-2", className)} aria-hidden />;
  return (
    <span className={cn("relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel", className)} aria-hidden>
      <Icon size={size} className="text-ink-2" />
      {LABEL[kind] ? <span className="absolute -bottom-1 -right-1 rounded-md bg-ink px-1 text-[9px] font-semibold leading-[14px] text-on-ink">{LABEL[kind]}</span> : null}
    </span>
  );
}
