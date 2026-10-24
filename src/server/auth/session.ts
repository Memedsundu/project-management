import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
/** Signed out after two weeks without use. */
const IDLE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type CurrentUser = { id: string; name: string; sessionId: string };

export async function createSession(userId: string) {
  const db = await getDb();
  const token = randomToken();
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), userAgent: ua, expiresAt });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const now = new Date();
  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_DAYS * DAY) return null;
  // Touch at most once an hour to keep writes low.
  if (now.getTime() - row.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  return { id: row.userId, name: row.name, sessionId: row.sessionId };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  }
  store.delete(SESSION_COOKIE);
}

export async function hasAnyUser() {
  const db = await getDb();
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}
