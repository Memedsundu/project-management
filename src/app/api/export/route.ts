import { getLocale } from "next-intl/server";
import { getCurrentUser } from "@/server/auth/session";
import { archiveEntries, archiveFileName, planArchive } from "@/server/export/archive";
import { attachmentHeaders } from "@/server/export/docx";
import { zipStream } from "@/server/export/zip";

export const dynamic = "force-dynamic";
// A big part streams for minutes on a slow connection; 800 s is the most Vercel allows (Fluid compute).
export const maxDuration = 800;

/**
 * The full export as a ZIP, written while it downloads so memory stays flat.
 * `?files=0` leaves the files out; `?part=2` is the second part of an export
 * too big for one download.
 */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const locale = (await getLocale()) === "en" ? "en" : "tr";
  const plan = await planArchive({ locale, files: url.searchParams.get("files") !== "0" });
  const part = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("part") ?? 1)) || 1, 1), plan.layout.parts);
  const origin = process.env.APP_ORIGIN?.replace(/\/+$/, "") || url.origin;
  const stream = zipStream(archiveEntries(plan, part, origin), {
    // A file missing from storage is left out rather than ending the download.
    onSkip: (name) => console.warn("[export] skipped", name),
  });
  return new Response(stream, { headers: attachmentHeaders(archiveFileName(plan, part), "application/zip") });
}
