"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** The current address with some search params changed (null removes one). */
export function useHrefWith() {
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
}
