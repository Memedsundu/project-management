import "server-only";
import { z } from "zod";
import { PermanentJobError } from "@/server/jobs/queue";
import { createSuggestion } from "@/server/services/suggestions";
import { aiJson, asMaterial } from "./client";
import { requireAiText } from "./context";
import { projectMemoryText } from "./memory";

/**
 * Gösterge okuyucu: Claude reads a partner report and proposes indicator
 * totals with the page each one came from. She approves each value; only
 * then does it reach the IPTT.
 */

export type IndicatorProposal = {
  indicatorId: string;
  indicatorLabel: string;
  periodId: string;
  periodLabel: string;
  value: number;
  disaggregation: Record<string, string> | null;
  organisationId: string | null;
  page: number | null;
  quote: string;
};

export type IndicatorValuesPayload = { documentId: string; organisationId: string | null; values: IndicatorProposal[]; notes: string };

export async function readIndicators(documentId: string, opts: { periodId?: string | null; organisationId?: string | null } = {}) {
  const material = await requireAiText({ type: "document", id: documentId }, { max: 120_000 });
  const { columnPeriods, listIndicators, listPeriods } = await import("@/server/services/indicators");
  const { listOrganisationsLite } = await import("@/server/services/partners-lite");
  const [inds, allPeriods, partners] = await Promise.all([listIndicators(), listPeriods(), listOrganisationsLite()]);
  // Only the IPTT's columns, so every approved value shows in the table.
  const periods = columnPeriods(allPeriods);
  const numeric = inds.filter((r) => r.i.unit !== "text");
  if (!numeric.length) throw new PermanentJobError("no indicators yet");
  if (!periods.length) throw new PermanentJobError("no periods yet");
  const indIds = numeric.map((r) => r.i.id) as [string, ...string[]];
  const periodIds = periods.map((p) => p.id) as [string, ...string[]];
  const orgIds = ["none", ...partners.map((p) => p.id)] as [string, ...string[]];
  const schema = z.object({
    organisationId: z.enum(orgIds).describe("The partner who wrote the report, or 'none'."),
    values: z.array(
      z.object({
        indicatorId: z.enum(indIds),
        periodId: z.enum(periodIds).describe("The reporting period the number belongs to."),
        value: z.number().describe("The total as a plain number. Percent values as 0-100."),
        groups: z.array(z.object({ dimension: z.string(), group: z.string() })).describe("Empty for an overall total; otherwise the disaggregation group, e.g. dimension 'Cinsiyet', group 'Kız'."),
        page: z.number().int().nullable().describe("Page number from the [page N] markers."),
        quote: z.string().describe("The exact short phrase or table cell the number comes from (max 200 characters)."),
      }),
    ),
    notes: z.string().describe("One or two Turkish sentences: anything unclear, numbers that conflict, or indicators the report does not cover."),
  });
  const indicatorList = numeric
    .map(({ i, nodeCode }) => `- ${i.id}: ${i.code} ${i.name} [unit ${i.unit}]${i.definition ? ` — ${i.definition.slice(0, 300)}` : ""}${i.disaggregation.length ? ` (disaggregation: ${i.disaggregation.join(", ")})` : ""}${nodeCode ? ` (under ${nodeCode})` : ""}`)
    .join("\n");
  const periodList = periods.map((p) => `- ${p.id}: ${p.label} (${p.startDate} to ${p.endDate})`).join("\n");
  const partnerList = partners.map((p) => `- ${p.id}: ${p.name}${p.shortName ? ` (${p.shortName})` : ""}`).join("\n");
  const out = await aiJson({
    helper: "indicatorReader",
    effort: "medium",
    maxTokens: 8000,
    schema,
    entity: { type: "document", id: documentId },
    system: [
      await projectMemoryText({ glossary: true, max: 3000 }),
      "Read the partner report and list the indicator totals it reports. Only use numbers that are written in the report; never compute or estimate a number that is not there. Totals only: never copy names or details of individual children.",
      opts.periodId ? `The report covers period id ${opts.periodId} unless a number is clearly for another period.` : "",
      `Indicators (id: code name):\n${indicatorList}`,
      `Periods (id: label):\n${periodList}\nUse only these periods. When a number covers a longer stretch (a half year, a year), use the last period inside it and say so in notes.`,
      `Partners (id: name):\n${partnerList || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [{ role: "user", content: asMaterial("document", { title: material.title }, material.text) }],
  });
  const indById = new Map(numeric.map((r) => [r.i.id, r]));
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const org = opts.organisationId ?? (out.organisationId === "none" ? null : out.organisationId);
  const values: IndicatorProposal[] = [];
  for (const v of out.values) {
    const ind = indById.get(v.indicatorId);
    const period = periodById.get(v.periodId);
    if (!ind || !period || !Number.isFinite(v.value)) continue;
    const dims = new Set(ind.i.disaggregation);
    const groups = v.groups.filter((g) => dims.has(g.dimension) && g.group.trim());
    if (groups.length !== v.groups.length) continue; // a dimension she did not define: leave it out
    values.push({
      indicatorId: ind.i.id,
      indicatorLabel: `${ind.i.code} ${ind.i.name}`,
      periodId: period.id,
      periodLabel: period.label,
      value: v.value,
      disaggregation: groups.length ? Object.fromEntries(groups.map((g) => [g.dimension, g.group.trim().slice(0, 40)])) : null,
      organisationId: org,
      page: v.page && v.page > 0 ? v.page : null,
      quote: v.quote.slice(0, 200),
    });
  }
  return { documentId, organisationId: org, values, notes: out.notes.trim() } satisfies IndicatorValuesPayload;
}

export async function readIndicatorsJob(payload: Record<string, unknown>) {
  const documentId = String(payload.documentId ?? "");
  const result = await readIndicators(documentId, {
    periodId: payload.periodId ? String(payload.periodId) : null,
    organisationId: payload.organisationId ? String(payload.organisationId) : null,
  });
  return createSuggestion({
    kind: "indicator_values",
    title: result.values.length ? `${result.values.length} gösterge değeri bulundu` : "Gösterge değeri bulunamadı",
    summary: result.notes || null,
    payload: result,
    source: { type: "document", id: documentId },
  });
}

type Decision = { indexes?: number[]; values?: IndicatorProposal[] };

export async function applyIndicatorValues(payload: unknown, decision: unknown) {
  const p = payload as IndicatorValuesPayload;
  const d = (decision ?? {}) as Decision;
  const chosen = d.values ?? (d.indexes ? d.indexes.map((i) => p.values[i]).filter(Boolean) : p.values);
  const { addIndicatorValue } = await import("@/server/services/indicators");
  const { checkForChildData } = await import("@/server/files/child-guard");
  const created: string[] = [];
  for (const v of chosen as IndicatorProposal[]) {
    const note = v.quote && !checkForChildData({ text: v.quote }).flag ? v.quote : null;
    const row = await addIndicatorValue(
      {
        indicatorId: v.indicatorId,
        periodId: v.periodId,
        value: v.value,
        disaggregation: v.disaggregation,
        organisationId: v.organisationId,
        sourceDocumentId: p.documentId,
        sourcePage: v.page,
        sourceNote: note,
        status: "approved",
      },
      "ai",
    );
    created.push(row.id);
  }
  return { status: created.length === p.values.length ? ("accepted" as const) : ("partial" as const), result: created };
}
