"use client";

import { useEffect } from "react";

/** Opens the print dialog once the page has painted (fonts included). */
export function PrintOnLoad() {
  useEffect(() => {
    const go = () => window.setTimeout(() => window.print(), 300);
    if (document.fonts?.ready) void document.fonts.ready.then(go);
    else go();
  }, []);
  return null;
}
