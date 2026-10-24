import "server-only";
import { refresh } from "next/cache";
import { getLocale } from "next-intl/server";
import { ZodError } from "zod";
import { AiError, aiErrorMessage } from "@/server/ai/client";
import { assertUser, type CurrentUser } from "@/server/auth/session";
import { getSetting } from "@/server/services/settings";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** A message she can read, thrown on purpose by services ("Bu klasör boş değil"). */
export class UserError extends Error {
  constructor(
    message: string,
    public code = "user",
  ) {
    super(message);
  }
}

const GENERIC = {
  tr: "Bir şey ters gitti. Tekrar dener misin?",
  en: "Something went wrong. Could you try again?",
};
const READ_ONLY = {
  tr: "Proje arşivlendi; bu çalışma alanı salt okunur.",
  en: "The project is archived; this workspace is read-only.",
};
const INVALID = {
  tr: "Bazı alanlar eksik ya da hatalı.",
  en: "Some fields are missing or wrong.",
};

/**
 * Every server action goes through here: it checks the session, blocks
 * changes once the project is archived, refreshes the screen after a change,
 * and turns errors into a short message for a toast.
 */
export async function act<T>(
  fn: (user: CurrentUser) => Promise<T>,
  opts: { write?: boolean; refresh?: boolean } = {},
): Promise<ActionResult<T>> {
  const write = opts.write ?? true;
  let locale: "tr" | "en" = "tr";
  try {
    locale = (await getLocale()) === "en" ? "en" : "tr";
  } catch {
    // Outside a request (tests): keep Turkish.
  }
  try {
    const user = await assertUser();
    if (write) {
      const archive = await getSetting("archive");
      if (archive.readOnly) return { ok: false, error: READ_ONLY[locale], code: "read_only" };
    }
    const data = await fn(user);
    // Changes refresh the screen; `refresh: true` asks for it on an action that skips the archive check.
    if (opts.refresh ?? write) {
      try {
        refresh();
      } catch {
        // Not inside a server action (tests or route handlers).
      }
    }
    return { ok: true, data };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message, code: err.code };
    if (err instanceof AiError) return { ok: false, error: aiErrorMessage(err, locale), code: `ai_${err.code}` };
    if (err instanceof ZodError) return { ok: false, error: INVALID[locale], code: "invalid" };
    if (err instanceof Error && err.message === "UNAUTHORIZED") return { ok: false, error: "UNAUTHORIZED", code: "unauthorized" };
    console.error("[action]", err);
    return { ok: false, error: GENERIC[locale], code: "error" };
  }
}
