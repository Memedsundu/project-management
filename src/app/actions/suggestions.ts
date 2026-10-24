"use server";

import { z } from "zod";
import { act } from "@/server/action";
import { acceptSuggestion, rejectSuggestion } from "@/server/services/suggestions";

/** Accept a Claude suggestion, with her edits in `decision`. */
export async function acceptSuggestionAction(id: string, decision?: unknown) {
  return act(async () => {
    const res = await acceptSuggestion(z.string().uuid().parse(id), decision);
    if (!res) throw new Error("gone");
    return { status: res.status };
  });
}

export async function rejectSuggestionAction(id: string) {
  return act(async () => {
    await rejectSuggestion(z.string().uuid().parse(id));
    return null;
  });
}
