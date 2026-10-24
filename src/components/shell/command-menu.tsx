"use client";

import type { QuickAddPrefill } from "./shell-context";

export function CommandMenu(props: {
  open: boolean;
  initialQuery: string;
  onOpenChange: (open: boolean) => void;
  onQuickAdd: (prefill?: QuickAddPrefill) => void;
  onAsk: (question: string) => void;
}) {
  void props;
  return null;
}
