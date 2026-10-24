"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { onlyGiven } from "@/lib/patch";
import { VISUAL_LANGUAGES } from "@/lib/visuals";
import { act, UserError } from "@/server/action";
import {
  acceptDraft,
  addSection,
  createReport,
  createVisual,
  deleteSection,
  duplicateReport,
  getReport,
  reorderSections,
  reportInputSchema,
  sectionPatchSchema,
  sectionsAsTemplate,
  setReportSources,
  setSectionDraft,
  sourceSchema,
  suggestReportSources,
  updateReport,
  updateSection,
  updateVisual,
  visualInputSchema,
} from "@/server/services/reports";
import { saveTemplate } from "@/server/services/templates";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const locale = async () => ((await getLocale()) === "en" ? "en" : "tr") as "tr" | "en";

export async function createReportAction(input: z.input<typeof reportInputSchema>) {
  return act(async () => {
    const row = await createReport(reportInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateReportAction(id: string, patch: Partial<z.input<typeof reportInputSchema>> & { status?: "draft" | "final" }) {
  return act(async () => {
    const row = await updateReport(uuid.parse(id), patch);
    if (!row) throw new UserError("Rapor bulunamadı.");
    return null;
  });
}

/** "Yeni dönem için kopyala": the same sections and guidance, empty text, the next period. */
export async function duplicateReportAction(id: string, input: { title: string; periodId: string | null; dueDate?: string | null }) {
  return act(async () => {
    const row = await duplicateReport(uuid.parse(id), {
      title: z.string().trim().min(1).max(300).parse(input.title),
      periodId: uuid.nullable().parse(input.periodId),
      dueDate: day.nullish().parse(input.dueDate),
    });
    return { id: row.id };
  });
}

/* --------------------------------- Sources ---------------------------------- */

const sourcesSchema = z.array(sourceSchema).max(200);

export async function addSourcesAction(id: string, list: z.input<typeof sourceSchema>[]) {
  return act(async () => {
    const r = await getReport(uuid.parse(id));
    if (!r) throw new UserError("Rapor bulunamadı.");
    const added = sourcesSchema.parse(list);
    const next = await setReportSources(r.id, [...r.sources, ...added]);
    return { count: next.length - r.sources.length };
  });
}

export async function removeSourceAction(id: string, source: z.input<typeof sourceSchema>) {
  return act(async () => {
    const r = await getReport(uuid.parse(id));
    if (!r) throw new UserError("Rapor bulunamadı.");
    const s = sourceSchema.parse(source);
    await setReportSources(
      r.id,
      r.sources.filter((x) => !(x.type === s.type && x.id === s.id)),
    );
    return null;
  });
}

/** "Dönemden öner": files, meetings and indicators the report's period points to. */
export async function suggestSourcesAction(id: string) {
  return act(async () => suggestReportSources(uuid.parse(id)), { write: false });
}

/* --------------------------------- Sections --------------------------------- */

export async function addSectionAction(reportId: string, input: { heading: string; afterId?: string | null }) {
  return act(async () => {
    const row = await addSection(uuid.parse(reportId), { heading: z.string().trim().min(1).max(300).parse(input.heading), afterId: uuid.nullish().parse(input.afterId) });
    return { id: row.id };
  });
}

export async function updateSectionAction(id: string, patch: z.input<typeof sectionPatchSchema>) {
  return act(async () => {
    const row = await updateSection(uuid.parse(id), onlyGiven(patch, sectionPatchSchema.parse(patch)));
    if (!row) throw new UserError("Bölüm bulunamadı.");
    return null;
  });
}

export async function deleteSectionAction(id: string) {
  return act(async () => {
    const row = await deleteSection(uuid.parse(id));
    if (!row) throw new UserError("Bölüm bulunamadı.");
    return { heading: row.heading, guidance: row.guidance, wordLimit: row.wordLimit, content: row.content };
  });
}

export async function reorderSectionsAction(reportId: string, ids: string[]) {
  return act(async () => {
    await reorderSections(uuid.parse(reportId), z.array(uuid).max(200).parse(ids));
    return null;
  });
}

/* ------------------------------ Claude's help ------------------------------- */

/** "Taslak yaz" / "Yeniden yaz": Claude's draft waits beside her text. */
export async function draftSectionAction(id: string, instruction?: string | null) {
  return act(async () => {
    const { draftSection } = await import("@/server/ai/reports");
    return draftSection(uuid.parse(id), { instruction: z.string().max(800).nullish().parse(instruction) });
  });
}

export async function acceptDraftAction(id: string, mode: "replace" | "append") {
  return act(async () => {
    await acceptDraft(uuid.parse(id), z.enum(["replace", "append"]).parse(mode));
    return null;
  });
}

export async function discardDraftAction(id: string) {
  return act(async () => {
    await setSectionDraft(uuid.parse(id), null);
    return null;
  });
}

/** "Sayıları kontrol et": figures in her text against the IPTT. */
export async function checkNumbersAction(id: string) {
  return act(async () => {
    const { checkNumbers } = await import("@/server/ai/reports");
    return checkNumbers(uuid.parse(id), await locale());
  });
}

/** Report Studio: a brief, talking points, a slide outline or a partner email from the report's sources. */
export async function generateReportOutputAction(id: string, input: { kind: string; focus?: string | null; language: string }) {
  return act(async () => {
    const { generateStudioOutput } = await import("@/server/ai/collections");
    return generateStudioOutput(
      { type: "report", id: uuid.parse(id) },
      {
        kind: z.enum(["brief", "talking_points", "slide_outline", "partner_email"]).parse(input.kind),
        focus: z.string().max(600).nullish().parse(input.focus),
        language: z.enum(["tr", "en"]).parse(input.language),
      },
    );
  });
}

/* -------------------------------- Templates --------------------------------- */

/** "Donör şablonunu oku": Claude's reading of her donor template, for her to edit before saving. */
export async function readTemplateAction(documentId: string) {
  return act(
    async () => {
      const { readDonorTemplate } = await import("@/server/ai/reports");
      return readDonorTemplate(uuid.parse(documentId));
    },
    { write: false },
  );
}

const templateSectionSchema = z.object({ heading: z.string().trim().min(1).max(300), guidance: z.string().max(4000).default(""), wordLimit: z.number().int().min(10).max(20000).nullable().default(null) });

export async function saveReportTemplateAction(input: { name: string; description?: string | null; sections: z.input<typeof templateSectionSchema>[] }) {
  return act(async () => {
    const sections = z.array(templateSectionSchema).min(1).max(40).parse(input.sections);
    const row = await saveTemplate({
      kind: "report",
      name: z.string().trim().min(1).max(200).parse(input.name),
      description: z.string().max(400).nullish().parse(input.description) ?? null,
      content: { sections: sections.map((s) => ({ heading: s.heading, guidance: s.guidance || undefined, wordLimit: s.wordLimit })) },
    });
    return { id: row.id };
  });
}

/** "Şablon olarak kaydet": this report's sections, reused next period. */
export async function saveReportAsTemplateAction(reportId: string, name: string) {
  return act(async () => {
    const sections = await sectionsAsTemplate(uuid.parse(reportId));
    if (!sections?.length) throw new UserError("Rapor bulunamadı.");
    const row = await saveTemplate({ kind: "report", name: z.string().trim().min(1).max(200).parse(name), content: { sections } });
    return { id: row.id };
  });
}

/* --------------------------------- Visuals ---------------------------------- */

export async function createVisualAction(input: z.input<typeof visualInputSchema>) {
  return act(async () => {
    const row = await createVisual(visualInputSchema.parse(input));
    return { id: row.id };
  });
}

export async function updateVisualAction(id: string, patch: Partial<z.input<typeof visualInputSchema>>) {
  return act(async () => {
    const row = await updateVisual(uuid.parse(id), patch);
    if (!row) throw new UserError("Görsel bulunamadı.");
    return null;
  });
}

/** "Claude'a tarif et": Sonnet turns a sentence into a chart spec over her own data. The title is written in the chart's language. */
export async function proposeChartAction(prompt: string, language: "en" | "tr" = "en") {
  return act(
    async () => {
      const { proposeChart } = await import("@/server/ai/visuals");
      return proposeChart(z.string().trim().min(3).max(600).parse(prompt), z.enum(VISUAL_LANGUAGES).parse(language));
    },
    { write: false },
  );
}

/** "Claude ile doldur": a heading, figures and key points for a one-pager, from the IPTT. */
export async function proposeOnePagerAction(input: { periodId?: string | null; focus?: string | null; language?: "en" | "tr" }) {
  return act(
    async () => {
      const { proposeOnePager } = await import("@/server/ai/visuals");
      return proposeOnePager({ periodId: uuid.nullish().parse(input.periodId) ?? null, focus: z.string().max(400).nullish().parse(input.focus) ?? null, language: z.enum(VISUAL_LANGUAGES).parse(input.language ?? "en") });
    },
    { write: false },
  );
}

/** The live numbers under a chart spec while she edits it. */
export async function chartDataAction(spec: unknown) {
  return act(
    async () => {
      const { chartData } = await import("@/server/services/visual-data");
      return chartData(spec);
    },
    { write: false },
  );
}

/** The live figures under a one-pager spec while she edits it. */
export async function onePagerDataAction(spec: unknown) {
  return act(
    async () => {
      const { onePagerData } = await import("@/server/services/visual-data");
      return onePagerData(spec);
    },
    { write: false },
  );
}
