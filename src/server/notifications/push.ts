import "server-only";
import { eq } from "drizzle-orm";
import webpush from "web-push";
import { nowTz } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { pushSubscriptions, sentNotifications } from "@/server/db/schema";
import { getSetting, setSetting } from "@/server/services/settings";

/**
 * Web Push for the installed app (PWA). Keys are made once and kept in
 * settings; the private key never leaves the server.
 */

export async function vapidKeys() {
  const current = await getSetting("vapid");
  if (current?.publicKey && current.privateKey) return current;
  const keys = webpush.generateVAPIDKeys();
  await setSetting("vapid", { publicKey: keys.publicKey, privateKey: keys.privateKey });
  return keys;
}

export async function publicVapidKey() {
  return (await vapidKeys()).publicKey;
}

export async function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string | null) {
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error("Bad endpoint");
  const db = await getDb();
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, keys: sub.keys, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys: sub.keys } });
}

export async function removeSubscription(endpoint: string) {
  const db = await getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function hasSubscriptions() {
  const db = await getDb();
  const rows = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).limit(1);
  return rows.length > 0;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True inside her quiet hours (default 21:00–08:00, Istanbul time). */
export async function inQuietHours(now = nowTz()) {
  const n = await getSetting("notifications");
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(n.quietStart);
  const end = toMinutes(n.quietEnd);
  return start > end ? cur >= start || cur < end : cur >= start && cur < end;
}

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

/**
 * Send one notification to every device, once per key. Returns false when
 * it was skipped (already sent, quiet hours, or no device).
 */
export async function sendPush(key: string, payload: PushPayload, opts: { ignoreQuiet?: boolean } = {}) {
  const db = await getDb();
  if (!opts.ignoreQuiet && (await inQuietHours())) return false;
  const subs = await db.select().from(pushSubscriptions);
  if (!subs.length) return false;
  const claimed = await db.insert(sentNotifications).values({ key: key.slice(0, 300) }).onConflictDoNothing().returning({ id: sentNotifications.id });
  if (!claimed.length) return false;
  const keys = await vapidKeys();
  const subject = process.env.APP_ORIGIN?.startsWith("https://") ? process.env.APP_ORIGIN : "https://example.invalid";
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  const body = JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.url ?? "/", tag: payload.tag ?? key });
  let delivered = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, body, { TTL: 60 * 60 });
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // The browser dropped this subscription: forget it.
      if (status === 404 || status === 410) await removeSubscription(s.endpoint);
    }
  }
  return delivered > 0;
}
