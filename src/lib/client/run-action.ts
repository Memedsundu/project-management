"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

/**
 * Await a server action from a client component: errors become a toast,
 * success can show a short confirmation. Returns the data, or undefined.
 */
export async function runAction<T>(
  promise: Promise<ActionResult<T>>,
  opts: { success?: string; silent?: boolean } = {},
): Promise<T | undefined> {
  let res: ActionResult<T>;
  try {
    res = await promise;
  } catch (err) {
    console.error(err);
    if (!opts.silent) toast.error(navigator.onLine ? "Bir şey ters gitti. Tekrar dener misin?" : "İnternet bağlantısı yok.");
    return undefined;
  }
  if (!res.ok) {
    if (res.code === "unauthorized") {
      // A full page load on purpose: it drops every cached screen of the old session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/sign-in";
      return undefined;
    }
    if (!opts.silent) toast.error(res.error);
    return undefined;
  }
  if (opts.success) toast(opts.success);
  return res.data;
}
