"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { onlyGiven } from "@/lib/patch";
import { act, UserError } from "@/server/action";
import {
  addIndicatorValue,
  approveIndicatorValues,
  createIndicator,
  createLogframeNode,
  deleteIndicatorValue,
  deletePeriod,
  indicatorInputSchema,
  nodeInputSchema,
  periodSchema,
  rebuildQuarters,
  savePeriod,
  setTargets,
  updateIndicator,
  updateIndicatorValue,
  updateLogframeNode,
  valueInputSchema,
} from "@/server/services/indicators";

const uuid = z.string().uuid();
const locale = async () => ((await getLocale()) === "en" ? "en" : "tr") as "tr" | "en";

export async function createIndicatorAction(input: z.input<typeof indicatorInputSchema>) {
  return act(async () => {
    const row = await createIndicator(indicatorInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateIndicatorAction(id: string, patch: Partial<z.input<typeof indicatorInputSchema>>) {
  return act(async () => {
    const row = await updateIndicator(uuid.parse(id), onlyGiven(patch, indicatorInputSchema.partial().parse(patch)));
    if (!row) throw new UserError("Gösterge bulunamadı.");
    return null;
  });
}

export async function setTargetsAction(id: string, list: { periodId: string; value: number | string | null }[]) {
  return act(async () => {
    const parsed = z.array(z.object({ periodId: uuid, value: z.union([z.number(), z.string().max(30), z.null()]) })).max(200).parse(list);
    for (const t of parsed) {
      if (typeof t.value === "string" && t.value.trim() && !/^-?\d+([.,]\d+)?$/.test(t.value.trim())) throw new UserError("Hedef bir sayı olmalı.");
    }
    await setTargets(uuid.parse(id), parsed.map((t) => ({ periodId: t.periodId, value: typeof t.value === "string" ? t.value.trim() || null : t.value })));
    return null;
  });
}

export async function addValueAction(input: z.input<typeof valueInputSchema>) {
  return act(async () => {
    const row = await addIndicatorValue(valueInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateValueAction(id: string, patch: Partial<z.input<typeof valueInputSchema>>) {
  return act(async () => {
    const row = await updateIndicatorValue(uuid.parse(id), onlyGiven(patch, valueInputSchema.partial().parse(patch)));
    if (!row) throw new UserError("Değer bulunamadı.");
    return null;
  });
}

export async function deleteValueAction(id: string) {
  return act(async () => {
    const row = await deleteIndicatorValue(uuid.parse(id));
    return row ? { value: row } : null;
  });
}

/** "Geri al" after deleting a value: the same row comes back. */
export async function restoreValueAction(row: { indicatorId: string; periodId: string; value: string; disaggregation: Record<string, string> | null; organisationId: string | null; sourceDocumentId: string | null; sourcePage: number | null; sourceNote: string | null; status: string }) {
  return act(async () => {
    await addIndicatorValue({
      indicatorId: row.indicatorId,
      periodId: row.periodId,
      value: row.value,
      disaggregation: row.disaggregation,
      organisationId: row.organisationId,
      sourceDocumentId: row.sourceDocumentId,
      sourcePage: row.sourcePage,
      sourceNote: row.sourceNote,
      status: row.status === "proposed" ? "proposed" : "approved",
    });
    return null;
  });
}

export async function approveValuesAction(ids: string[]) {
  return act(async () => ({ approved: await approveIndicatorValues(z.array(uuid).max(500).parse(ids)) }));
}

export async function createNodeAction(input: z.input<typeof nodeInputSchema>) {
  return act(async () => {
    const row = await createLogframeNode(nodeInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateNodeAction(id: string, patch: Partial<z.input<typeof nodeInputSchema>>) {
  return act(async () => {
    const row = await updateLogframeNode(uuid.parse(id), nodeInputSchema.partial().parse(patch));
    if (!row) throw new UserError("Öğe bulunamadı.");
    return null;
  });
}

export async function savePeriodAction(id: string | null, input: z.input<typeof periodSchema>) {
  return act(async () => {
    const row = await savePeriod(id ? uuid.parse(id) : null, periodSchema.parse(input));
    return row ? { id: row.id } : null;
  });
}

/** "Çeyrekleri yeniden oluştur": project quarters from another start month, while nothing is recorded. */
export async function rebuildQuartersAction(startMonth: number) {
  return act(async () => ({ count: await rebuildQuarters(startMonth) }));
}

export async function deletePeriodAction(id: string) {
  return act(async () => {
    await deletePeriod(uuid.parse(id));
    return null;
  });
}

/** "Neden geride?": Claude drafts the variance explanation; nothing is saved. */
export async function explainShortfallAction(id: string) {
  return act(
    async () => {
      const { explainShortfall } = await import("@/server/ai/indicators");
      return explainShortfall(uuid.parse(id), await locale());
    },
    { write: false },
  );
}

/** Keeps her (possibly edited) explanation as a note linked to the indicator. */
export async function saveExplanationAction(id: string, title: string, text: string) {
  return act(async () => {
    const { createNote } = await import("@/server/services/notes");
    const note = await createNote({ title: z.string().trim().min(1).max(200).parse(title), markdown: z.string().trim().min(1).max(20_000).parse(text), links: [{ type: "indicator", id: uuid.parse(id) }] });
    return { id: note.id };
  });
}
