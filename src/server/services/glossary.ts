import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { glossaryTerms } from "@/server/db/schema";

/** Turkish and English project terms, used by Claude in every translation and draft. */

export const glossaryInputSchema = z.object({
  id: z.string().uuid().nullish(),
  tr: z.string().trim().min(1).max(200),
  en: z.string().trim().min(1).max(200),
  note: z.string().trim().max(300).nullish(),
});

export type GlossaryTerm = { id: string; tr: string; en: string; note: string | null };

export async function listGlossary(): Promise<GlossaryTerm[]> {
  const db = await getDb();
  const rows = await db.select().from(glossaryTerms).orderBy(asc(glossaryTerms.tr)).limit(400);
  return rows.map((r) => ({ id: r.id, tr: r.tr, en: r.en, note: r.note }));
}

/** Add a term, or change one. The same Turkish term twice is one term. */
export async function saveGlossaryTerm(raw: z.input<typeof glossaryInputSchema>): Promise<GlossaryTerm> {
  const input = glossaryInputSchema.parse(raw);
  const db = await getDb();
  const all = await db.select().from(glossaryTerms);
  const same = all.find((t) => t.id !== input.id && t.tr.toLocaleLowerCase("tr") === input.tr.toLocaleLowerCase("tr"));
  if (same && input.id) throw new UserError(`“${input.tr}” sözlükte zaten var.`);
  const targetId = input.id ?? same?.id;
  if (targetId) {
    const [row] = await db
      .update(glossaryTerms)
      .set({ tr: input.tr, en: input.en, note: input.note || null, updatedAt: new Date() })
      .where(eq(glossaryTerms.id, targetId))
      .returning();
    if (!row) throw new UserError("Bu terim bulunamadı.");
    return { id: row.id, tr: row.tr, en: row.en, note: row.note };
  }
  const [row] = await db.insert(glossaryTerms).values({ tr: input.tr, en: input.en, note: input.note || null }).returning();
  return { id: row!.id, tr: row!.tr, en: row!.en, note: row!.note };
}

export async function deleteGlossaryTerm(id: string) {
  const db = await getDb();
  await db.delete(glossaryTerms).where(eq(glossaryTerms.id, id));
}
