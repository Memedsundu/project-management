import { getCurrentUser } from "@/server/auth/session";
import { findPendingUpload } from "@/server/files/uploads";
import { putObject, storageMode } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Upload target on a laptop or in tests, where files go to the local .uploads folder. */
export async function PUT(req: Request) {
  if (storageMode() !== "local" || process.env.VERCEL) return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("upload") ?? "";
  const pending = await findPendingUpload({ id });
  if (!pending) return new Response("Unknown upload", { status: 400 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > pending.size + 1024) return new Response("Too large", { status: 413 });
  await putObject(pending.key, buf, pending.type || "application/octet-stream");
  return Response.json({ ok: true });
}
