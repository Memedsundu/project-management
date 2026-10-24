import "server-only";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getDb } from "@/server/db/client";
import { authChallenges, passkeys, recoveryCodes, users } from "@/server/db/schema";
import { hashSecret, newPairingCode, newRecoveryCode, normalizeRecoveryCode, safeEqual } from "./crypto";
import { assertUser, createSession, hasAnyUser } from "./session";

const CHALLENGE_COOKIE = "wa";
const CHALLENGE_MINUTES = 5;
const RECOVERY_CODE_COUNT = 10;

export class AuthError extends Error {
  constructor(
    public code:
      | "setup_done"
      | "setup_token"
      | "setup_token_missing"
      | "challenge"
      | "verify"
      | "unknown_passkey"
      | "rate_limited"
      | "bad_code"
      | "pairing_code",
  ) {
    super(code);
  }
}

/** Relying party: the app's own domain. APP_ORIGIN pins it in production. */
export async function getRp() {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  let origin = configured;
  if (!origin) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    origin = `${proto}://${host}`;
  }
  const rpID = new URL(origin).hostname;
  return { rpID, origin, rpName: process.env.APP_NAME ?? "[uygulama]" };
}

function deviceNameFromUa(ua: string | null) {
  if (!ua) return "Passkey";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Passkey";
}

async function saveChallenge(kind: string, challenge: string, data?: unknown) {
  const db = await getDb();
  const [row] = await db
    .insert(authChallenges)
    .values({
      kind,
      challenge,
      data: data ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000),
    })
    .returning({ id: authChallenges.id });
  const store = await cookies();
  store.set(CHALLENGE_COOKIE, row.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_MINUTES * 60,
  });
}

async function takeChallenge(kind: string) {
  const store = await cookies();
  const id = store.get(CHALLENGE_COOKIE)?.value;
  store.delete(CHALLENGE_COOKIE);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new AuthError("challenge");
  const db = await getDb();
  const [row] = await db
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authChallenges.id, id),
        eq(authChallenges.kind, kind),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new AuthError("challenge");
  return row;
}

async function recordFailure(kind: string) {
  const db = await getDb();
  await db.insert(authChallenges).values({
    kind: `fail:${kind}`,
    challenge: "-",
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
}

async function assertNotRateLimited(kind: string, max = 8) {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(authChallenges)
    .where(and(eq(authChallenges.kind, `fail:${kind}`), gt(authChallenges.expiresAt, new Date())));
  if ((row?.n ?? 0) >= max) throw new AuthError("rate_limited");
}

async function userPasskeyDescriptors(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: passkeys.id, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId));
  return rows.map((r) => ({ id: r.id, transports: r.transports ?? undefined }));
}

async function registrationOptionsFor(userId: string, userName: string, displayName: string, kind: string, data?: unknown) {
  const rp = await getRp();
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName,
    userDisplayName: displayName,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    excludeCredentials: await userPasskeyDescriptors(userId),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await saveChallenge(kind, options.challenge, { userId, ...(data as object) });
  return options;
}

async function verifyAndStoreRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  userId: string,
  name?: string,
) {
  const rp = await getRp();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch {
    throw new AuthError("verify");
  }
  if (!verification.verified) throw new AuthError("verify");
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const ua = (await headers()).get("user-agent");
  const db = await getDb();
  await db.insert(passkeys).values({
    id: credential.id,
    userId,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name?.trim() || deviceNameFromUa(ua),
  });
}

async function issueRecoveryCodes(userId: string) {
  const db = await getDb();
  await db.delete(recoveryCodes);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.insert(recoveryCodes).values(codes.map((c) => ({ codeHash: hashSecret(c) })));
  void userId;
  return codes;
}

/* ---------------- First-time setup ---------------- */

export function setupTokenRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.SETUP_TOKEN);
}

export async function beginSetup(input: { name: string; setupToken?: string }) {
  if (await hasAnyUser()) throw new AuthError("setup_done");
  if (setupTokenRequired()) {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) throw new AuthError("setup_token_missing");
    await assertNotRateLimited("setup", 10);
    if (!input.setupToken || !safeEqual(input.setupToken.trim(), expected)) {
      await recordFailure("setup");
      throw new AuthError("setup_token");
    }
  }
  const pendingUserId = crypto.randomUUID();
  const name = input.name.trim().slice(0, 80) || "Proje yöneticisi";
  return registrationOptionsFor(pendingUserId, name, name, "register", { name, setup: true });
}

export async function finishSetup(response: RegistrationResponseJSON) {
  const challenge = await takeChallenge("register");
  const data = challenge.data as { userId: string; name: string; setup?: boolean };
  if (!data?.setup) throw new AuthError("challenge");
  if (await hasAnyUser()) throw new AuthError("setup_done");
  const db = await getDb();
  await db.insert(users).values({ id: data.userId, name: data.name });
  await verifyAndStoreRegistration(response, challenge.challenge, data.userId);
  const codes = await issueRecoveryCodes(data.userId);
  await createSession(data.userId);
  return { recoveryCodes: codes };
}

/* ---------------- Sign in ---------------- */

export async function beginLogin() {
  const rp = await getRp();
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred" });
  await saveChallenge("login", options.challenge);
  return options;
}

export async function finishLogin(response: AuthenticationResponseJSON) {
  await assertNotRateLimited("login", 20);
  const challenge = await takeChallenge("login");
  const db = await getDb();
  const [pk] = await db.select().from(passkeys).where(eq(passkeys.id, response.id)).limit(1);
  if (!pk) {
    await recordFailure("login");
    throw new AuthError("unknown_passkey");
  }
  const rp = await getRp();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: pk.id,
        publicKey: pk.publicKey as Uint8Array<ArrayBuffer>,
        counter: pk.counter,
        transports: (pk.transports ?? undefined) as never,
      },
      requireUserVerification: false,
    });
  } catch {
    await recordFailure("login");
    throw new AuthError("verify");
  }
  if (!verification.verified) {
    await recordFailure("login");
    throw new AuthError("verify");
  }
  await db
    .update(passkeys)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(passkeys.id, pk.id));
  await createSession(pk.userId);
}

export async function loginWithRecoveryCode(input: string) {
  await assertNotRateLimited("recovery", 6);
  const code = normalizeRecoveryCode(input);
  const db = await getDb();
  if (!code) {
    await recordFailure("recovery");
    throw new AuthError("bad_code");
  }
  const [row] = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.codeHash, hashSecret(code)), isNull(recoveryCodes.usedAt)))
    .returning();
  if (!row) {
    await recordFailure("recovery");
    throw new AuthError("bad_code");
  }
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  await createSession(user.id);
}

/* ---------------- Signed-in: passkeys, recovery codes, pairing ---------------- */

export async function beginAddPasskey() {
  const user = await assertUser();
  return registrationOptionsFor(user.id, user.name, user.name, "register", { add: true });
}

export async function finishAddPasskey(response: RegistrationResponseJSON, name?: string) {
  const user = await assertUser();
  const challenge = await takeChallenge("register");
  const data = challenge.data as { userId: string; add?: boolean };
  if (!data?.add || data.userId !== user.id) throw new AuthError("challenge");
  await verifyAndStoreRegistration(response, challenge.challenge, user.id, name);
}

export async function regenerateRecoveryCodes() {
  const user = await assertUser();
  return issueRecoveryCodes(user.id);
}

export async function remainingRecoveryCodes() {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(recoveryCodes).where(isNull(recoveryCodes.usedAt));
  return row?.n ?? 0;
}

/** A six-digit code, valid ten minutes, that lets a new phone or laptop add its own passkey. */
export async function createPairingCode() {
  await assertUser();
  const code = newPairingCode();
  const db = await getDb();
  await db.insert(authChallenges).values({
    kind: "pair",
    challenge: hashSecret(code),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return { code, expiresInMinutes: 10 };
}

export async function beginPairing(input: string) {
  await assertNotRateLimited("pair", 8);
  const code = input.replace(/\D/g, "");
  const db = await getDb();
  const [row] = await db
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authChallenges.kind, "pair"),
        eq(authChallenges.challenge, hashSecret(code)),
        isNull(authChallenges.usedAt),
        gt(authChallenges.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) {
    await recordFailure("pair");
    throw new AuthError("pairing_code");
  }
  const [user] = await db.select().from(users).limit(1);
  return registrationOptionsFor(user.id, user.name, user.name, "register", { pair: true });
}

export async function finishPairing(response: RegistrationResponseJSON) {
  const challenge = await takeChallenge("register");
  const data = challenge.data as { userId: string; pair?: boolean };
  if (!data?.pair) throw new AuthError("challenge");
  await verifyAndStoreRegistration(response, challenge.challenge, data.userId);
  await createSession(data.userId);
}
