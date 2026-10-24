import "server-only";
import { todayStr } from "@/lib/dates";
import { aiConfigured } from "@/server/ai/client";
import { listStudioOutputs } from "@/server/ai/collections";
import { aiOffKeys } from "@/server/ai/context";
import { isEntityType, type EntityRef } from "@/server/entities";
import { columnPeriods, ipttTable, listPeriods } from "@/server/services/indicators";
import { listLinks } from "@/server/services/links";
import { chartSpecSchema, onePagerSpecSchema } from "@/lib/visuals";
import { getReport, getVisual, listReports, listVisuals, numberCheckOf, textHash } from "@/server/services/reports";
import { chartData, onePagerData } from "@/server/services/visual-data";
import { getSetting } from "@/server/services/settings";
import { listTemplates } from "@/server/services/templates";

/** Periods for the report form, newest first within each kind (quarters before years). */
async function periodOptions() {
  const order = ["quarter", "half", "year", "month", "custom"];
  return (await listPeriods())
    .map((p) => ({ id: p.id, label: p.label, kind: p.kind, startDate: p.startDate, endDate: p.endDate }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.startDate.localeCompare(b.startDate));
}

async function reportTemplates() {
  return (await listTemplates("report")).map((t) => ({ id: t.id, name: t.name, description: t.description, builtin: t.builtin, sections: t.content.sections ?? [] }));
}

/** "Raporlar": every report with how far it has come, the visuals, and what a new one can start from. */
export async function loadReportsHome() {
  const [list, visuals, templates, periods, profile] = await Promise.all([listReports(), listVisuals(), reportTemplates(), periodOptions(), getSetting("profile")]);
  const titles = new Map(list.map((r) => [r.id, r.title]));
  return {
    reports: list.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as "draft" | "final",
      dueDate: r.dueDate,
      periodLabel: r.periodLabel,
      audience: r.audience,
      language: r.language,
      sectionCount: r.sectionCount,
      draftedCount: r.draftedCount,
      words: r.words,
      updatedAt: r.updatedAt.toISOString(),
    })),
    visuals: visuals.map((v) => ({ id: v.id, title: v.title, kind: v.kind as "chart" | "onepager", reportId: v.reportId, reportTitle: v.reportId ? (titles.get(v.reportId) ?? null) : null, updatedAt: v.updatedAt.toISOString() })),
    templates,
    periods,
    spelling: profile.reportSpelling,
    today: todayStr(),
    aiReady: aiConfigured(),
  };
}
export type ReportsHomeData = Awaited<ReturnType<typeof loadReportsHome>>;

/** One report: its sources, its sections with drafts and checks, and what was made from it. */
export async function loadReport(id: string) {
  const r = await getReport(id);
  if (!r || r.deletedAt) return null;
  const refs = r.sourceItems.filter((s) => isEntityType(s.type)).map((s) => ({ type: s.type, id: s.id }) as EntityRef);
  const [off, outputs, related, visuals, periods, templates] = await Promise.all([
    aiOffKeys(refs),
    listStudioOutputs("report", id),
    listLinks({ type: "report", id }, { kinds: ["related"] }),
    listVisuals({ reportId: id }),
    periodOptions(),
    reportTemplates(),
  ]);
  const sourceKeys = new Set(r.sourceItems.map((s) => `${s.type}:${s.id}`));
  return {
    id: r.id,
    title: r.title,
    status: r.status as "draft" | "final",
    dueDate: r.dueDate,
    audience: r.audience,
    language: r.language as "en-GB" | "en-US" | "tr",
    periodId: r.periodId,
    periodLabel: r.periodLabel,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    templateId: r.templateId,
    updatedAt: r.updatedAt.toISOString(),
    sources: r.sourceItems.map((s) => ({ ...s, aiOff: off.has(`${s.type}:${s.id}`) })),
    sections: r.sections.map((s) => {
      const check = numberCheckOf(s.numberChecks);
      return {
        id: s.id,
        heading: s.heading,
        guidance: s.guidance,
        wordLimit: s.wordLimit,
        content: s.content,
        citations: s.citations,
        draft: s.draft ?? null,
        check,
        // The text changed after the check: its marks may point at the wrong words.
        checkStale: check ? check.hash !== textHash(s.content) : false,
        generatedAt: s.generatedAt?.toISOString() ?? null,
      };
    }),
    outputs,
    // Notes saved from Studio; they are not sources unless she adds them.
    notes: related.filter((l) => l.type === "note" && !l.deleted && !sourceKeys.has(`note:${l.id}`)).map((l) => ({ id: l.id, title: l.title, href: l.href })),
    visuals: visuals.map((v) => ({ id: v.id, title: v.title, kind: v.kind as "chart" | "onepager" })),
    periods,
    templates,
    today: todayStr(),
    aiReady: aiConfigured(),
  };
}
export type ReportPageData = NonNullable<Awaited<ReturnType<typeof loadReport>>>;
export type ReportSectionData = ReportPageData["sections"][number];

/** A chart or one-pager with what its editor offers: her indicators, the IPTT periods, her charts and reports. */
export async function loadVisual(id: string) {
  const v = await getVisual(id);
  if (!v || v.deletedAt) return null;
  const [{ rows }, all, reports, visuals, profile] = await Promise.all([ipttTable(), listPeriods(), listReports(), listVisuals(), getSetting("profile")]);
  const report = v.reportId ? reports.find((r) => r.id === v.reportId) : null;
  const base = {
    id: v.id,
    title: v.title,
    reportId: report ? report.id : null,
    reportTitle: report?.title ?? null,
    updatedAt: v.updatedAt.toISOString(),
    indicators: rows
      .filter((r) => r.unit !== "text")
      .map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit as "number" | "percent", cumulative: r.cumulative, hasData: r.cells.some((c) => c.actual !== null) })),
    periods: columnPeriods(all).map((p) => ({ id: p.id, label: p.label })),
    reports: reports.map((r) => ({ id: r.id, title: r.title })),
    projectName: profile.projectName,
    aiReady: aiConfigured(),
    today: todayStr(),
  };
  if (v.kind === "onepager") {
    const parsed = onePagerSpecSchema.safeParse(v.spec);
    const spec = parsed.success ? parsed.data : onePagerSpecSchema.parse({ heading: v.title });
    return { ...base, kind: "onepager" as const, spec, onePager: await onePagerData(spec), charts: visuals.filter((x) => x.kind === "chart").map((x) => ({ id: x.id, title: x.title })) };
  }
  const parsed = chartSpecSchema.safeParse(v.spec);
  const spec = parsed.success ? parsed.data : chartSpecSchema.parse({ source: "indicator_progress" });
  return { ...base, kind: "chart" as const, spec, chart: await chartData(spec) };
}
export type VisualPageData = NonNullable<Awaited<ReturnType<typeof loadVisual>>>;
