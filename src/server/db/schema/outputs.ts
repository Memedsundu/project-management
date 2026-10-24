import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, id, updatedAt } from "./common";
import { periods } from "./plan";

export type SourceRef = { type: string; id: string };

export type Citation = {
  n: number;
  sourceType: string;
  sourceId: string;
  title: string;
  page?: number | null;
  quote?: string;
};

export const reports = pgTable("reports", {
  id: id(),
  title: text("title").notNull(),
  templateId: uuid("template_id"),
  periodId: uuid("period_id").references(() => periods.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft | final
  dueDate: date("due_date", { mode: "string" }),
  audience: text("audience"),
  language: text("language").notNull().default("en-GB"),
  sources: jsonb("sources").$type<SourceRef[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const reportSections = pgTable(
  "report_sections",
  {
    id: id(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
    heading: text("heading").notNull(),
    guidance: text("guidance"),
    wordLimit: integer("word_limit"),
    content: text("content").notNull().default(""), // markdown with [n] citation markers
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    numberChecks: jsonb("number_checks").notNull().default([]),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("report_sections_report_idx").on(t.reportId, t.sort)],
);

/** Hand-picked or smart sets that leave items where they live (Dash Stacks, NotebookLM). */
export const collections = pgTable("collections", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  pinned: boolean("pinned").notNull().default(false),
  smartFilter: jsonb("smart_filter"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/** Questions asked in Ask, a collection chat or "Bu belgeye sor", saved like NotebookLM. */
export const askThreads = pgTable(
  "ask_threads",
  {
    id: id(),
    scopeType: text("scope_type").notNull().default("all"), // all | collection | document | meetings
    scopeId: uuid("scope_id"),
    question: text("question").notNull(),
    answer: text("answer").notNull().default(""),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    model: text("model"),
    saved: boolean("saved").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("ask_threads_scope_idx").on(t.scopeType, t.scopeId, t.createdAt)],
);

/** Charts and one-page visuals built from indicator or workplan data. */
export const visuals = pgTable("visuals", {
  id: id(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("chart"), // chart | onepager
  spec: jsonb("spec").notNull(),
  dataSource: jsonb("data_source"),
  reportId: uuid("report_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/** Assistant panel conversations, with the screen context they started from. */
export const assistantConversations = pgTable("assistant_conversations", {
  id: id(),
  title: text("title").notNull().default(""),
  context: jsonb("context"),
  messages: jsonb("messages").notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Outputs made from a collection or a report's sources (brief, talking points ...). */
export const studioOutputs = pgTable("studio_outputs", {
  id: id(),
  scopeType: text("scope_type").notNull(), // collection | report
  scopeId: uuid("scope_id").notNull(),
  kind: text("kind").notNull(), // brief | talking_points | slide_outline | partner_email | section
  title: text("title").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
  createdAt: createdAt(),
});

/** What the scheduled helpers wrote: the daily brief, the weekly review, partner checks and recipe runs. */
export const briefs = pgTable(
  "briefs",
  {
    id: id(),
    kind: text("kind").notNull(), // daily | weekly | partner_check | recipe
    day: date("day", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(), // markdown
    data: jsonb("data"),
    recipeId: uuid("recipe_id"),
    model: text("model"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("briefs_kind_day_idx").on(t.kind, t.day)],
);
