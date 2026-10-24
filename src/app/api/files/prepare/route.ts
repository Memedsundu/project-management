import { getCurrentUser } from "@/server/auth/session";
import { prepareSchema, reserveUpload } from "@/server/files/uploads";
import { findDuplicate } from "@/server/services/documents";

export const dynamic = "force-dynamic";

/** Step 1 of an upload: check for a duplicate and reserve a private storage key. */
export async function POST(req: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = prepareSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const input = parsed.data;
  if (!input.documentId) {
    const dup = await findDuplicate(input.sha256);
    if (dup && !new URL(req.url).searchParams.has("force")) return Response.json({ duplicate: dup });
  }
  try {
    const res = await reserveUpload(input);
    return Response.json(res);
  } catch (err) {
    const code = err instanceof Error ? err.message : "error";
    if (code === "STORAGE_NOT_READY") return Response.json({ error: "storage_not_ready" }, { status: 503 });
    if (code === "READ_ONLY") return Response.json({ error: "read_only" }, { status: 403 });
    console.error("[upload prepare]", err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
