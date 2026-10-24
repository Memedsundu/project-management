import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { createSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Sign-in for automated browser tests only. It answers 404 unless the app
 * runs outside production with E2E_LOGIN=1, so it can never open a real
 * deployment.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_LOGIN !== "1") return new Response("Not found", { status: 404 });
  const db = await getDb();
  let [user] = await db.select().from(users).limit(1);
  if (!user) [user] = await db.insert(users).values({ name: "Test" }).returning();
  await createSession(user!.id);
  return Response.json({ ok: true });
}
