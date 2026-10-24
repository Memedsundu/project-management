"use server";

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { redirect } from "next/navigation";
import { destroySession } from "@/server/auth/session";
import {
  AuthError,
  beginLogin,
  beginPairing,
  beginSetup,
  finishLogin,
  finishPairing,
  finishSetup,
  loginWithRecoveryCode,
} from "@/server/auth/webauthn";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.code };
    console.error("[auth]", e);
    return { ok: false, error: "verify" };
  }
}

export async function startSetupAction(input: { name: string; setupToken?: string }) {
  return run(() => beginSetup(input));
}

export async function finishSetupAction(response: RegistrationResponseJSON) {
  return run(() => finishSetup(response));
}

export async function startLoginAction() {
  return run(() => beginLogin());
}

export async function finishLoginAction(response: AuthenticationResponseJSON) {
  return run(() => finishLogin(response));
}

export async function recoveryLoginAction(code: string) {
  return run(() => loginWithRecoveryCode(code));
}

export async function startPairingAction(code: string) {
  return run(() => beginPairing(code));
}

export async function finishPairingAction(response: RegistrationResponseJSON) {
  return run(() => finishPairing(response));
}

export async function signOutAction() {
  await destroySession();
  redirect("/sign-in");
}
