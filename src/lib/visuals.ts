import { z } from "zod";

/**
 * Görseller: a chart or a one-pager is a small spec over her live data
 * (the IPTT and the workplan), never a copy of the numbers. Opening it
 * again shows the latest approved values.
 */

/**
 * The words drawn into a picture follow the picture's language, not the
 * screen's: with Turkish on screen she can still make an English chart for
 * an English report. Numbers and dates are written the same way.
 */
export const VISUAL_LANGUAGES = ["en", "tr"] as const;
export type VisualLanguage = (typeof VISUAL_LANGUAGES)[number];

export const VISUAL_WORDS = {
  en: {
    actual: "Actual",
    target: "Target",
    other: "Other",
    progress: "Progress to target",
    count: "Activities",
    reference: "100% of target",
    statuses: { planned: "Planned", ongoing: "Ongoing", done: "Done", delayed: "Delayed", canceled: "Cancelled" } as Record<string, string>,
    sourceIptt: "Source: IPTT, approved values as of {date}",
    sourceWorkplan: "Source: workplan, as of {date}",
    pointsHeading: "Highlights",
    noteShare: "Of the life-of-project target",
    noteTarget: "Target {value}",
    noteToDate: "To date",
    noteLop: "LoP target {value}",
  },
  tr: {
    actual: "Gerçekleşen",
    target: "Hedef",
    other: "Diğer",
    progress: "Hedefe göre ilerleme",
    count: "Faaliyet",
    reference: "Hedefin %100'ü",
    statuses: { planned: "Planlandı", ongoing: "Devam ediyor", done: "Tamamlandı", delayed: "Gecikti", canceled: "İptal" } as Record<string, string>,
    sourceIptt: "Kaynak: IPTT, {date} itibarıyla onaylı değerler",
    sourceWorkplan: "Kaynak: iş planı, {date} itibarıyla",
    pointsHeading: "Öne çıkanlar",
    noteShare: "Proje sonu hedefine göre",
    noteTarget: "Hedef {value}",
    noteToDate: "Bugüne kadar",
    noteLop: "Proje hedefi {value}",
  },
} as const;
export type VisualWords = (typeof VISUAL_WORDS)[VisualLanguage];

/** "Target {value}" with its value filled in. */
export const fillWords = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export const CHART_SOURCES = ["indicator_periods", "indicator_partners", "indicator_progress", "workplan_status"] as const;
export type ChartSource = (typeof CHART_SOURCES)[number];
export const CHART_TYPES = ["bar", "line", "stacked"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const chartSpecSchema = z.object({
  source: z.enum(CHART_SOURCES),
  type: z.enum(CHART_TYPES).default("bar"),
  indicatorIds: z.array(z.string().uuid()).max(12).default([]),
  /** Empty: every IPTT column that has a target or a value. */
  periodIds: z.array(z.string().uuid()).max(24).default([]),
  /** Running totals instead of per-period values (cumulative indicators). */
  cumulative: z.boolean().default(false),
  subtitle: z.string().max(300).default(""),
  language: z.enum(VISUAL_LANGUAGES).default("en"),
});
export type ChartSpec = z.output<typeof chartSpecSchema>;

/** Which chart types each source can draw. */
export const TYPES_FOR: Record<ChartSource, ChartType[]> = {
  indicator_periods: ["bar", "line"],
  indicator_partners: ["stacked", "bar"],
  indicator_progress: ["bar"],
  workplan_status: ["bar"],
};

/** How many indicators each source takes. */
export const INDICATORS_FOR: Record<ChartSource, { min: number; max: number }> = {
  indicator_periods: { min: 1, max: 3 },
  indicator_partners: { min: 1, max: 1 },
  indicator_progress: { min: 0, max: 12 },
  workplan_status: { min: 0, max: 0 },
};

export const STAT_SHOWS = ["period", "to_date", "percent"] as const;

export const onePagerSpecSchema = z.object({
  heading: z.string().max(140).default(""),
  subheading: z.string().max(240).default(""),
  periodId: z.string().uuid().nullable().default(null),
  stats: z
    .array(z.object({ indicatorId: z.string().uuid(), label: z.string().max(90).default(""), show: z.enum(STAT_SHOWS).default("to_date") }))
    .max(6)
    .default([]),
  /** One chart from her visuals, drawn in the middle of the page. */
  chartId: z.string().uuid().nullable().default(null),
  points: z.array(z.string().max(220)).max(5).default([]),
  footer: z.string().max(200).default(""),
  language: z.enum(VISUAL_LANGUAGES).default("en"),
});
export type OnePagerSpec = z.output<typeof onePagerSpecSchema>;

export type ChartUnit = "number" | "percent";

/** One series of a computed chart. `role` decides its look: the target is a faint tick or dashed line. */
export type ChartSeries = {
  key: string;
  name: string;
  role: "actual" | "target" | "series" | "other";
  values: (number | null)[];
  /** Colour slot 0–3. It follows the thing (a partner keeps its colour in every chart), never its rank. */
  slot: number;
};

/** A chart's numbers, computed on the server from the spec. */
export type ChartData = {
  source: ChartSource;
  type: ChartType;
  categories: string[];
  /** Workplan bars are labelled by status keys the screen translates. */
  categoryKind: "label" | "status";
  /** Full names for the tooltip when the axis shows short codes. */
  categoryTitles: string[] | null;
  series: ChartSeries[];
  unit: ChartUnit;
  /** Horizontal bars (progress, workplan) read their labels down the side. */
  horizontal: boolean;
  /** A reference line, such as 100% of target. */
  reference: number | null;
  /** Why something was left out, e.g. an indicator in another unit. */
  notes: ("mixed_units" | "too_many_partners" | "text_indicator" | "no_indicators" | "no_periods")[];
  /** Approved values as of this day. */
  asOf: string;
};

/** A one-pager's figures, computed on the server from the spec. */
export type OnePagerStat = { indicatorId: string; label: string; code: string; value: number | null; unit: ChartUnit; show: (typeof STAT_SHOWS)[number]; target: number | null; periodLabel: string | null };

/**
 * Series colours: ink, amber, grey, then a light amber for "Diğer". Checked
 * with the dataviz validator against both surfaces: all pairs of the first
 * three ≥ ΔE 12.8 under protan and deutan (16.1 normal vision) and ≥ 3:1
 * contrast. The fourth slot is under 3:1, so every chart carries a visible
 * table. The validator's hue-band and chroma checks do not apply to greys.
 */
export const SERIES_COLORS = {
  light: ["#111111", "#b45309", "#8a8a85", "#e7c9a0"],
  dark: ["#f2f2f0", "#f0b35a", "#7c7c77", "#5a4220"],
} as const;

/** The light theme, for images that go into Word whatever theme she uses. */
export const LIGHT_THEME = { ink: "#111111", muted: "#5c5c5c", faint: "#8a8a85", line: "#e6e6e6", lineSoft: "#ecece8", bg: "#ffffff", panel: "#f5f5f2", accent: "#b45309", accentSoft: "#fdf3e1" } as const;
