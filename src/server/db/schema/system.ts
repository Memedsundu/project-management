import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea, createdAt, EMBEDDING_DIMENSIONS, id, tsvector, updatedAt } from "./common";

/** Key-value settings for the single workspace (profile, AI cap, working hours ...). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/** The one person who uses the app. */
export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(), // credential id, base64url
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: text("transports").array(),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  name: text("name").notNull().default("Passkey"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash)],
);

/** Short-lived WebAuthn challenges and device pairing codes. */
export const authChallenges = pgTable("auth_challenges", {
  id: id(),
  kind: text("kind").notNull(), // register | login | pair
  challenge: text("challenge").notNull(),
  data: jsonb("data"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const recoveryCodes = pgTable("recovery_codes", {
  id: id(),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Any record linked to any other record. The backbone of "Bağlantılar". */
export const links = pgTable(
  "links",
  {
    id: id(),
    fromType: text("from_type").notNull(),
    fromId: uuid("from_id").notNull(),
    toType: text("to_type").notNull(),
    toId: uuid("to_id").notNull(),
    kind: text("kind").notNull().default("related"), // related | mention | partner | attendee | collection_item | source | attachment
    createdBy: text("created_by").notNull().default("user"), // user | ai
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("links_unique_idx").on(t.fromType, t.fromId, t.toType, t.toId, t.kind),
    index("links_to_idx").on(t.toType, t.toId),
    index("links_from_idx").on(t.fromType, t.fromId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_slug_idx").on(t.slug)],
);

export const taggings = pgTable(
  "taggings",
  {
    id: id(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("taggings_unique_idx").on(t.tagId, t.entityType, t.entityId),
    index("taggings_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** What changed, when, and whether she or Claude proposed it. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull().default("user"), // user | ai | system
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    title: text("title"),
    summary: text("summary"),
    data: jsonb("data"),
  },
  (t) => [index("activity_entity_idx").on(t.entityType, t.entityId), index("activity_at_idx").on(t.at)],
);

/**
 * One row per searchable record (tasks, notes, meetings, partners, files ...).
 * Folded columns hold Turkish-aware, accent-free lower case text; the tsvector
 * is generated from them so prefix search handles Turkish word endings.
 */
export const searchIndex = pgTable(
  "search_index",
  {
    id: id(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    foldedTitle: text("folded_title").notNull(),
    foldedBody: text("folded_body").notNull().default(""),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(folded_title, '')), 'A') || setweight(to_tsvector('simple', coalesce(folded_body, '')), 'B')`,
    ),
    meta: jsonb("meta").notNull().default({}),
    aiOff: boolean("ai_off").notNull().default(false),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("search_entity_idx").on(t.entityType, t.entityId),
    index("search_tsv_idx").using("gin", t.tsv),
    index("search_title_trgm_idx").using("gin", sql`${t.foldedTitle} gin_trgm_ops`),
  ],
);

/** Everything Claude proposes waits here until she accepts, edits or rejects it. */
export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: id(),
    kind: text("kind").notNull(), // classification | tasks | organize | indicator_values | key_dates | meeting_recap | link | note
    status: text("status").notNull().default("pending"), // pending | accepted | rejected | partial
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    decision: jsonb("decision"),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("ai_suggestions_status_idx").on(t.status, t.createdAt)],
);

/** Each Claude or Voyage call, with tokens and cost, for the cost meter and cap. */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    helper: text("helper").notNull(),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    batch: boolean("batch").notNull().default(false),
    status: text("status").notNull().default("ok"), // ok | error | blocked
    error: text("error"),
    durationMs: integer("duration_ms"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_runs_created_idx").on(t.createdAt)],
);

/** Background work: classification, text extraction, embeddings, scheduled helpers. */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAt), index("jobs_dedupe_idx").on(t.dedupeKey)],
);

export const glossaryTerms = pgTable("glossary_terms", {
  id: id(),
  tr: text("tr").notNull(),
  en: text("en").notNull(),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Saved filters for tasks, files and search ("Ortak B'den beklenenler"). */
export const savedViews = pgTable("saved_views", {
  id: id(),
  kind: text("kind").notNull(), // tasks | files | search
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  pinned: boolean("pinned").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    endpoint: text("endpoint").notNull(),
    keys: jsonb("keys").notNull(),
    userAgent: text("user_agent"),
    /** The language of the device that subscribed, for the notification texts. */
    locale: text("locale").notNull().default("tr"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_endpoint_idx").on(t.endpoint)],
);

/** Push notifications already sent, so a reminder never repeats. */
export const sentNotifications = pgTable(
  "sent_notifications",
  {
    id: id(),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sent_notifications_key_idx").on(t.key)],
);

/** Saved instructions for the assistant ("Ortak brifi", "Haftalık güncelleme"). */
export const recipes = pgTable("recipes", {
  id: id(),
  name: text("name").notNull(),
  instructions: text("instructions").notNull(),
  model: text("model").notNull().default("claude-haiku-5-5"),
  builtinKey: text("builtin_key"),
  schedule: text("schedule"), // daily_0800 | friday_1600 | monthly_first_workday | null
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
