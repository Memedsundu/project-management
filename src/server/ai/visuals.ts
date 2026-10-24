import "server-only";
import { z } from "zod";
import { UserError } from "@/server/action";
import { checkForChildData } from "@/server/files/child-guard";
import { CHART_SOURCES, CHART_TYPES, chartSpecSchema, INDICATORS_FOR, onePagerSpecSchema, STAT_SHOWS, TYPES_FOR, type ChartSpec, type OnePagerSpec, type VisualLanguage } from "@/lib/visuals";
import { aiJson } from "./client";
import { projectMemoryText } from "./memory";

/**
 * Görseller with Claude: Sonnet reads her sentence and picks the chart
 * from her own indicators and periods, or fills a one-pager from the IPTT.
 * The answer is a spec she adjusts; the numbers always come from the data.
 */

async function catalogue() {
  const { columnPeriods, ipttTable, listPeriods } = await import("@/server/services/indicators");
  const [{ rows }, all] = await Promise.all([ipttTable(), listPeriods()]);
  const numeric = rows.filter((r) => r.unit !== "text");
  return { rows: numeric, periods: columnPeriods(all) };
}

const SOURCE_HELP = `Chart sources:
- indicator_periods: one to three indicators in the same unit, by period. With one indicator it shows actual against target. Types: bar, line. "cumulative" shows running totals (only for cumulative indicators).
- indicator_partners: one indicator, by period, split by the partner that reported it. Types: stacked, bar.
- indicator_progress: several indicators as percent of their target to date. Type: bar. An empty indicator list means every indicator with data.
- workplan_status: activities by status (done, ongoing, planned, delayed). Type: bar. No indicators.`;

export async function proposeChart(prompt: string, language: VisualLanguage): Promise<{ title: string; spec: ChartSpec }> {
  if (checkForChildData({ text: prompt }).flag) throw new UserError("Metinde bir çocuğa ait kişisel bilgi olabilir; yapay zekâya gönderilmedi.");
  const { rows, periods } = await catalogue();
  const indIds = rows.map((r) => r.id);
  const periodIds = periods.map((p) => p.id);
  const schema = z.object({
    title: z.string().describe(`A short chart title in ${language === "en" ? "English" : "Turkish"}.`),
    subtitle: z.string().describe(`One short line in ${language === "en" ? "English" : "Turkish"}: what is measured and for which periods. May be empty.`),
    source: z.enum(indIds.length ? CHART_SOURCES : ["workplan_status"]),
    type: z.enum(CHART_TYPES),
    indicatorIds: indIds.length ? z.array(z.enum(indIds as [string, ...string[]])) : z.array(z.string()).max(0),
    periodIds: periodIds.length ? z.array(z.enum(periodIds as [string, ...string[]])).describe("Empty for every period with data.") : z.array(z.string()).max(0),
    cumulative: z.boolean(),
  });
  const out = await aiJson({
    helper: "visuals",
    effort: "low",
    thinking: "light",
    maxTokens: 2000,
    schema,
    system: [
      await projectMemoryText({ glossary: true, max: 1500 }),
      `Choose the one chart that best shows what she asks for, using only her indicators and periods below. Never invent an indicator. Never put two units on one chart.\n${SOURCE_HELP}`,
      `Indicators (id: code name [unit]):\n${rows.map((r) => `- ${r.id}: ${r.code} ${r.name} [${r.unit}${r.cumulative ? ", cumulative" : ""}]`).join("\n") || "(none)"}`,
      `Periods (id: label):\n${periods.map((p) => `- ${p.id}: ${p.label}`).join("\n") || "(none)"}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: prompt }],
  });
  const limits = INDICATORS_FOR[out.source];
  const ids = [...new Set(out.indicatorIds)].slice(0, limits.max);
  if (ids.length < limits.min) throw new UserError("Claude bu tarife uyan bir gösterge bulamadı. Göstergeyi adıyla yazar mısın?");
  const spec = chartSpecSchema.parse({
    source: out.source,
    type: TYPES_FOR[out.source].includes(out.type) ? out.type : TYPES_FOR[out.source][0],
    indicatorIds: ids,
    periodIds: [...new Set(out.periodIds)],
    cumulative: out.cumulative,
    subtitle: out.subtitle.slice(0, 300),
    language,
  });
  return { title: out.title.trim().slice(0, 200) || prompt.slice(0, 120), spec };
}

/** "Claude ile doldur": a heading, up to four figures and key points, every one from the IPTT. */
export async function proposeOnePager(input: { periodId: string | null; focus: string | null; language: VisualLanguage }): Promise<OnePagerSpec> {
  if (input.focus && checkForChildData({ text: input.focus }).flag) throw new UserError("Metinde bir çocuğa ait kişisel bilgi olabilir; yapay zekâya gönderilmedi.");
  const { rows, periods } = await catalogue();
  if (!rows.length) throw new UserError("IPTT'de henüz sayısal gösterge yok.");
  const { ipttText } = await import("@/server/services/indicators");
  const period = input.periodId ? periods.find((p) => p.id === input.periodId) : null;
  const indIds = rows.map((r) => r.id) as [string, ...string[]];
  const language = input.language === "en" ? "English" : "Turkish";
  const schema = z.object({
    heading: z.string().describe(`A short heading in ${language}, e.g. "${period ? period.label : "2026"} at a glance".`),
    subheading: z.string().describe(`One line in ${language} under the heading: the project and the period.`),
    stats: z
      .array(z.object({ indicatorId: z.enum(indIds), label: z.string().describe(`A label of at most six words in ${language}.`), show: z.enum(STAT_SHOWS) }))
      .describe('Two to four headline figures. "period" is the actual for the chosen period, "to_date" the total so far, "percent" the share of target reached to date.'),
    points: z.array(z.string()).describe(`Two to four key points in ${language}, one sentence each, each stating only what the IPTT below says.`),
  });
  const out = await aiJson({
    helper: "visuals",
    effort: "low",
    thinking: "light",
    maxTokens: 3000,
    schema,
    system: [
      await projectMemoryText({ glossary: true, max: 2000 }),
      `Fill a one-page summary of her project's results for a donor or partner audience${period ? `, for ${period.label}` : ""}. Use only the IPTT below: never invent or work out numbers, and leave out indicators with no data. Totals only, never a child's details.`,
      `IPTT:\n${await ipttText(input.periodId)}`,
      `Indicator ids:\n${rows.map((r) => `- ${r.id}: ${r.code} ${r.name}`).join("\n")}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: input.focus ? `Focus on: ${input.focus}` : "Choose what matters most." }],
  });
  return onePagerSpecSchema.parse({
    heading: out.heading.slice(0, 140),
    subheading: out.subheading.slice(0, 240),
    periodId: period?.id ?? null,
    stats: out.stats.slice(0, 4).map((s) => ({ indicatorId: s.indicatorId, label: s.label.slice(0, 90), show: s.show === "period" && !period ? "to_date" : s.show })),
    points: out.points.slice(0, 4).map((p) => p.slice(0, 220)),
    language: input.language,
  });
}
