import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, id, updatedAt } from "./common";
import { documents } from "./files";
import { organisations } from "./work";

/** Reporting periods (quarters, months, years) used by indicators and reports. */
export const periods = pgTable(
  "periods",
  {
    id: id(),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("quarter"), // month | quarter | half | year | custom
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("periods_start_idx").on(t.startDate)],
);

/** Goal, outcomes and outputs of the logframe. */
export const logframeNodes = pgTable("logframe_nodes", {
  id: id(),
  parentId: uuid("parent_id").references((): AnyPgColumn => logframeNodes.id, { onDelete: "cascade" }),
  level: text("level").notNull(), // goal | outcome | output
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const activities = pgTable(
  "activities",
  {
    id: id(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    logframeNodeId: uuid("logframe_node_id").references(() => logframeNodes.id, { onDelete: "set null" }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    status: text("status").notNull().default("planned"), // planned | ongoing | done | delayed | canceled
    provinces: text("provinces").array().notNull().default([]),
    progress: integer("progress").notNull().default(0),
    isMilestone: boolean("is_milestone").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("activities_start_idx").on(t.startDate)],
);

export const activityDependencies = pgTable(
  "activity_dependencies",
  {
    id: id(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("activity_dep_unique_idx").on(t.activityId, t.dependsOnId)],
);

/** Season bands she draws behind the workplan (for example a crop's harvest months). */
export const seasons = pgTable("seasons", {
  id: id(),
  name: text("name").notNull(),
  crop: text("crop"),
  provinces: text("provinces").array().notNull().default([]),
  startMonth: integer("start_month").notNull(),
  startDay: integer("start_day").notNull().default(1),
  endMonth: integer("end_month").notNull(),
  endDay: integer("end_day").notNull().default(28),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const holidays = pgTable(
  "holidays",
  {
    id: id(),
    date: date("date", { mode: "string" }).notNull(),
    nameTr: text("name_tr").notNull(),
    nameEn: text("name_en").notNull(),
    kind: text("kind").notNull().default("public"), // public | religious | other
    halfDay: boolean("half_day").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("holidays_date_idx").on(t.date)],
);

export const indicators = pgTable("indicators", {
  id: id(),
  logframeNodeId: uuid("logframe_node_id").references(() => logframeNodes.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  definition: text("definition"),
  unit: text("unit").notNull().default("number"), // number | percent | text
  disaggregation: text("disaggregation").array().notNull().default([]),
  baseline: numeric("baseline"),
  baselineDate: date("baseline_date", { mode: "string" }),
  lopTarget: numeric("lop_target"), // life of project
  dataSource: text("data_source"),
  frequency: text("frequency"),
  responsibleOrgId: uuid("responsible_org_id").references(() => organisations.id, { onDelete: "set null" }),
  meansOfVerification: text("means_of_verification"),
  direction: text("direction").notNull().default("increase"), // increase | decrease
  cumulative: boolean("cumulative").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const indicatorTargets = pgTable(
  "indicator_targets",
  {
    id: id(),
    indicatorId: uuid("indicator_id")
      .notNull()
      .references(() => indicators.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    value: numeric("value").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("indicator_targets_unique_idx").on(t.indicatorId, t.periodId)],
);

/** Actual totals per period. Totals only: there is no field for an individual child. */
export const indicatorValues = pgTable(
  "indicator_values",
  {
    id: id(),
    indicatorId: uuid("indicator_id")
      .notNull()
      .references(() => indicators.id, { onDelete: "cascade" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => periods.id, { onDelete: "cascade" }),
    value: numeric("value").notNull(),
    disaggregation: jsonb("disaggregation").$type<Record<string, string> | null>(),
    organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    sourcePage: integer("source_page"),
    sourceNote: text("source_note"),
    status: text("status").notNull().default("approved"), // approved | proposed
    createdAt: createdAt(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [index("indicator_values_ind_idx").on(t.indicatorId, t.periodId)],
);
