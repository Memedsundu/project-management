"use client";

import { createContext, useContext, useEffect } from "react";

export type ScreenContext = {
  /** What the assistant "sees": a record or a list screen. */
  kind: string;
  id?: string;
  title: string;
  /** Short text the assistant can use, for example the current selection. */
  detail?: string;
};

export type QuickAddPrefill = { text?: string; mode?: "task" | "note" | "file"; link?: { type: string; id: string; title: string } };

type ShellApi = {
  openCommand: (query?: string) => void;
  openQuickAdd: (prefill?: QuickAddPrefill) => void;
  openAssistant: (prompt?: string) => void;
  toggleAssistant: () => void;
  assistantOpen: boolean;
  setScreen: (ctx: ScreenContext | null) => void;
  screen: ScreenContext | null;
  readOnly: boolean;
  aiConfigured: boolean;
};

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside the app shell");
  return ctx;
}

/** Pages call this so the assistant knows what is on screen. */
export function useScreenContext(ctx: ScreenContext | null) {
  const shell = useContext(ShellContext);
  const key = ctx ? `${ctx.kind}:${ctx.id ?? ""}:${ctx.title}:${ctx.detail ?? ""}` : "";
  useEffect(() => {
    shell?.setScreen(ctx);
    return () => shell?.setScreen(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Server pages can drop this in to set the screen context. */
export function ScreenContextSetter(props: ScreenContext) {
  useScreenContext(props);
  return null;
}
