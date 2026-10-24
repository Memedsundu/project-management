import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/server/auth/session";
import { findPendingUpload } from "@/server/files/uploads";

export const dynamic = "force-dynamic";

/** Gives the browser a one-file token to upload straight to the private Blob store. */
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await getCurrentUser())) throw new Error("unauthorized");
        const pending = await findPendingUpload({ key: pathname });
        if (!pending) throw new Error("unknown upload");
        return {
          maximumSizeInBytes: pending.size + 1024,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 60 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "error" }, { status: 400 });
  }
}
