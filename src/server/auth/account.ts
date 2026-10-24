import "server-only";
import { and, count, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { deviceLabel } from "@/lib/device";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { passkeys, sessions } from "@/server/db/schema";
import type { CurrentUser } from "./session";

/** Ayarlar › Hesap: her passkeys and the devices signed in. */

export type PasskeyItem = { id: string; name: string; createdAt: string; lastUsedAt: string | null; synced: boolean };
export type SessionItem = { id: string; device: string | null; createdAt: string; lastSeenAt: string; current: boolean };

export async function listPasskeys(user: CurrentUser): Promise<PasskeyItem[]> {
  const db = await getDb();
  const rows = await db.select().from(passkeys).where(eq(passkeys.userId, user.id)).orderBy(desc(passkeys.createdAt));
  return rows.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt?.toISOString() ?? null, synced: p.backedUp }));
}

export async function renamePasskey(user: CurrentUser, id: string, name: string) {
  const db = await getDb();
  await db
    .update(passkeys)
    .set({ name: z.string().trim().min(1).max(60).parse(name) })
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)));
}

/** The last passkey stays: without one she could only sign in with a recovery code. */
export async function deletePasskey(user: CurrentUser, id: string) {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, user.id));
  if ((row?.n ?? 0) <= 1) throw new UserError("Son passkey silinemez. Önce başka bir cihaz ekle.");
  await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)));
}

export async function listSessions(user: CurrentUser): Promise<SessionItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    device: deviceLabel(s.userAgent),
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    current: s.id === user.sessionId,
  }));
}

export async function revokeSession(user: CurrentUser, id: string) {
  if (id === user.sessionId) throw new UserError("Bu cihazdan çıkmak için Çıkış yap'ı kullan.");
  const db = await getDb();
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, id), eq(sessions.userId, user.id)));
}

export async function revokeOtherSessions(user: CurrentUser) {
  const db = await getDb();
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), ne(sessions.id, user.sessionId)))
    .returning({ id: sessions.id });
  return rows.length;
}
