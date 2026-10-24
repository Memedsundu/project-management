import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, id, updatedAt } from "./common";

/** Partners, the donor, ministries and other organisations ("Paydaşlar"). */
export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  kind: text("kind").notNull().default("partner"), // partner | donor | government | un | ngo | other
  provinces: text("provinces").array().notNull().default([]),
  agreementStart: date("agreement_start", { mode: "string" }),
  agreementEnd: date("agreement_end", { mode: "string" }),
  focalContactId: uuid("focal_contact_id"),
  reportingRhythm: text("reporting_rhythm").notNull().default("none"), // none | monthly | quarterly | biannual | annual
  reportDueDays: integer("report_due_days").notNull().default(10), // days after period end
  statusLine: text("status_line"),
  notes: text("notes"),
  website: text("website"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

/** Work contacts of adults only: name, role, email and phone. */
export const contacts = pgTable("contacts", {
  id: id(),
  organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  role: text("role"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("todo"), // todo | doing | waiting | done | canceled
    priority: integer("priority").notNull().default(4), // 1 high .. 4 none
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    dueTime: text("due_time"), // HH:mm, Europe/Istanbul
    estimateMin: integer("estimate_min"),
    ownerKind: text("owner_kind").notNull().default("me"), // me | contact | organisation | person
    ownerContactId: uuid("owner_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    ownerOrgId: uuid("owner_org_id").references(() => organisations.id, { onDelete: "set null" }),
    ownerName: text("owner_name"),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    recurrence: text("recurrence"), // RRULE
    recurrenceLabel: text("recurrence_label"),
    planDate: date("plan_date", { mode: "string" }), // picked for the morning plan of this day
    planOrder: integer("plan_order"),
    sortOrder: integer("sort_order").notNull().default(0),
    reminderAt: timestamp("reminder_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    templateId: uuid("template_id"),
    /** Captured without a date or a home: waits in Gelen kutusu until she files it. */
    inbox: boolean("inbox").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_due_idx").on(t.dueDate),
    index("tasks_start_idx").on(t.startDate),
    index("tasks_owner_org_idx").on(t.ownerOrgId),
  ],
);

/** Notion-style pages. Content is BlockNote JSON, plainText feeds search. */
export const notes = pgTable(
  "notes",
  {
    id: id(),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    parentId: uuid("parent_id").references((): AnyPgColumn => notes.id, { onDelete: "set null" }),
    content: jsonb("content").notNull().default([]),
    plainText: text("plain_text").notNull().default(""),
    kind: text("kind").notNull().default("page"), // page | daily | memory | email
    dailyDate: date("daily_date", { mode: "string" }),
    pinned: boolean("pinned").notNull().default(false),
    systemKey: text("system_key"),
    aiOff: boolean("ai_off").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    meta: jsonb("meta").notNull().default({}),
    inbox: boolean("inbox").notNull().default(false),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("notes_daily_idx").on(t.dailyDate),
    uniqueIndex("notes_system_key_idx").on(t.systemKey),
    index("notes_parent_idx").on(t.parentId),
  ],
);

export const noteVersions = pgTable(
  "note_versions",
  {
    id: id(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: jsonb("content").notNull(),
    createdBy: text("created_by").notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [index("note_versions_note_idx").on(t.noteId, t.createdAt)],
);

export const meetingSeries = pgTable("meeting_series", {
  id: id(),
  title: text("title").notNull(),
  recurrence: text("recurrence"),
  recurrenceLabel: text("recurrence_label"),
  organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
  templateId: uuid("template_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export type AgendaItem = {
  id: string;
  text: string;
  done: boolean;
  carriedFrom?: string | null;
  notes?: string;
};

export type MeetingRecap = {
  summary: string;
  decisions: string[];
  actions: { title: string; owner?: string | null; dueDate?: string | null }[];
  openQuestions: string[];
  nextSteps: string[];
  language: "tr" | "en";
};

export const meetings = pgTable(
  "meetings",
  {
    id: id(),
    seriesId: uuid("series_id").references(() => meetingSeries.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("partner"), // partner | donor | steering | field | internal | other
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    onlineUrl: text("online_url"),
    status: text("status").notNull().default("planned"), // planned | done | canceled
    agenda: jsonb("agenda").$type<AgendaItem[]>().notNull().default([]),
    notesContent: jsonb("notes_content").notNull().default([]),
    notesText: text("notes_text").notNull().default(""),
    transcript: text("transcript"),
    recap: jsonb("recap").$type<MeetingRecap | null>(),
    prepBrief: text("prep_brief"),
    followupEmail: text("followup_email"),
    aiOff: boolean("ai_off").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("meetings_starts_idx").on(t.startsAt), index("meetings_series_idx").on(t.seriesId)],
);

/** "Kararlar" log: every decision across all meetings, each linked to its meeting. */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    meetingId: uuid("meeting_id").references(() => meetings.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    decidedOn: date("decided_on", { mode: "string" }).notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("decisions_meeting_idx").on(t.meetingId)],
);

/** Page, meeting, report and task-set templates. */
export const templates = pgTable("templates", {
  id: id(),
  kind: text("kind").notNull(), // note | meeting | report | task_set
  name: text("name").notNull(),
  description: text("description"),
  content: jsonb("content").notNull(),
  builtinKey: text("builtin_key"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});
