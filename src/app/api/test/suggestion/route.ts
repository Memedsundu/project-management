import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { isEntityType } from "@/server/entities";
import { createSuggestion, type SuggestionKind } from "@/server/services/suggestions";

export const dynamic = "force-dynamic";

/**
 * Stores a Claude-style proposal for automated browser tests, so review screens
 * can be tested without an API key. Same guard as the test sign-in: 404 unless
 * the app runs outside production with E2E_LOGIN=1.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.E2E_LOGIN !== "1") return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json()) as { kind: SuggestionKind; title: string; summary?: string; payload: unknown; source?: { type: string; id: string } };
  const source = body.source && isEntityType(body.source.type) ? { type: body.source.type, id: body.source.id } : null;
  const row = await createSuggestion({ kind: body.kind, title: body.title, summary: body.summary ?? null, payload: body.payload, source });
  if (body.kind === "classification" && source?.type === "document") {
    const db = await getDb();
    await db.update(documents).set({ classificationStatus: "suggested" }).where(eq(documents.id, source.id));
  }
  return Response.json({ id: row.id });
}
