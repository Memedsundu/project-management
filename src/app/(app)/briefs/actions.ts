"use server";

import { z } from "zod";
import { act, UserError } from "@/server/action";
import { getBrief, deleteBrief, markBriefsRead } from "@/server/services/briefs";

const uuid = z.string().uuid();

/** "Şimdi hazırla": one of the scheduled helpers, written now for today. */
export async function makeBriefAction(kind: "daily" | "weekly" | "partner_check") {
  return act(async () => {
    const { makeBriefNow } = await import("@/server/ai/helpers");
    const brief = await makeBriefNow(z.enum(["daily", "weekly", "partner_check"]).parse(kind));
    return { id: brief.id };
  });
}

export async function remakeBriefAction(id: string) {
  return act(async () => {
    const { remakeBrief } = await import("@/server/ai/helpers");
    const brief = await remakeBrief(uuid.parse(id));
    return { id: brief.id };
  });
}

export async function deleteBriefAction(id: string) {
  return act(async () => {
    await deleteBrief(uuid.parse(id));
    return null;
  });
}

export async function markBriefsReadAction(ids: string[]) {
  return act(
    async () => {
      await markBriefsRead(z.array(uuid).max(500).parse(ids));
      return null;
    },
    { write: false, refresh: true },
  );
}

/** Keep a brief as a page of her notes, where she can edit it. */
export async function briefToNoteAction(id: string) {
  return act(async () => {
    const brief = await getBrief(uuid.parse(id));
    if (!brief) throw new UserError("Özet bulunamadı.");
    const { createNote } = await import("@/server/services/notes");
    const note = await createNote({ title: brief.title, markdown: brief.content, links: brief.entity ? [brief.entity] : undefined });
    return { id: note.id };
  });
}
