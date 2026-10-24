export type FileItem = {
  id: string;
  title: string;
  filename: string;
  mime: string;
  size: number;
  docType: string | null;
  status: string;
  language: string | null;
  periodLabel: string | null;
  starred: boolean;
  aiOff: boolean;
  classificationStatus: string;
  childDataFlag: boolean;
  textStatus: string;
  folderId: string | null;
  updatedAt: string;
  createdAt: string;
  orgIds: string[];
  tags: { name: string; slug: string }[];
};

export type FolderItem = { id: string; name: string; documentCount: number; folderCount: number; aiOff: boolean };

export type FolderNode = { id: string; name: string; parentId: string | null; aiOff: boolean };

export type DocTypeOption = { key: string; tr: string; en: string };

export type FileKind = "pdf" | "word" | "sheet" | "slides" | "image" | "email" | "text" | "video" | "audio" | "other";

export function fileKind(mime: string, filename = ""): FileKind {
  const e = filename.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || e === "pdf") return "pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword" || mime.includes("opendocument.text") || ["docx", "doc", "odt"].includes(e)) return "word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel" || mime === "text/csv" || ["xlsx", "xls", "csv", "ods"].includes(e)) return "sheet";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint" || ["pptx", "ppt", "odp"].includes(e)) return "slides";
  if (mime.startsWith("image/")) return "image";
  if (mime === "message/rfc822" || mime === "application/vnd.ms-outlook" || ["eml", "msg"].includes(e)) return "email";
  if (mime.startsWith("text/") || ["txt", "md"].includes(e)) return "text";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}
