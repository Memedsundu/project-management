"use server";

import { z } from "zod";
import { askQuestion, deleteAskThread, setAskSaved } from "@/server/ai/ask";
import { act } from "@/server/action";

const uuid = z.string().uuid();

/** "Sor": answered from her own records with citations; the question is kept in her history. */
export async function askAction(question: string, scope: "all" | "meetings" = "all") {
  return act(async () => askQuestion(z.string().trim().min(3).max(1000).parse(question), { type: z.enum(["all", "meetings"]).parse(scope) }), {
    write: false,
  });
}

export async function saveAskAction(id: string, saved: boolean) {
  return act(async () => {
    await setAskSaved(uuid.parse(id), saved);
    return null;
  });
}

export async function deleteAskAction(id: string) {
  return act(async () => {
    await deleteAskThread(uuid.parse(id));
    return null;
  });
}
