"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/messages";

export async function setLocaleAction(locale: string) {
  const store = await cookies();
  store.set(LOCALE_COOKIE, normalizeLocale(locale), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
