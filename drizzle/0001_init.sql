CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"title" text,
	"summary" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"helper" text NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"batch" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" text,
	"duration_ms" integer,
	"entity_type" text,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"payload" jsonb NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"decision" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"challenge" text NOT NULL,
	"data" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tr" text NOT NULL,
	"en" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_type" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_type" text NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" text DEFAULT 'related' NOT NULL,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT 'Passkey' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"model" text DEFAULT 'claude-haiku-5-5' NOT NULL,
	"builtin_key" text,
	"schedule" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"folded_title" text NOT NULL,
	"folded_body" text DEFAULT '' NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(folded_title, '')), 'A') || setweight(to_tsvector('simple', coalesce(folded_body, '')), 'B')) STORED,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_off" boolean DEFAULT false NOT NULL,
	"embedding" vector(1024),
	"embedded_at" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sent_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "taggings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid,
	"text" text NOT NULL,
	"decided_on" date NOT NULL,
	"organisation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"recurrence" text,
	"recurrence_label" text,
	"organisation_id" uuid,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'partner' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"online_url" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes_content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes_text" text DEFAULT '' NOT NULL,
	"transcript" text,
	"recap" jsonb,
	"prep_brief" text,
	"followup_email" text,
	"ai_off" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"icon" text,
	"parent_id" uuid,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'page' NOT NULL,
	"daily_date" date,
	"pinned" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"ai_off" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbox" boolean DEFAULT false NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"kind" text DEFAULT 'partner' NOT NULL,
	"provinces" text[] DEFAULT '{}' NOT NULL,
	"agreement_start" date,
	"agreement_end" date,
	"focal_contact_id" uuid,
	"reporting_rhythm" text DEFAULT 'none' NOT NULL,
	"report_due_days" integer DEFAULT 10 NOT NULL,
	"status_line" text,
	"notes" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" integer DEFAULT 4 NOT NULL,
	"start_date" date,
	"due_date" date,
	"due_time" text,
	"estimate_min" integer,
	"owner_kind" text DEFAULT 'me' NOT NULL,
	"owner_contact_id" uuid,
	"owner_org_id" uuid,
	"owner_name" text,
	"parent_id" uuid,
	"recurrence" text,
	"recurrence_label" text,
	"plan_date" date,
	"plan_order" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"reminder_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"source_type" text,
	"source_id" uuid,
	"template_id" uuid,
	"inbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" jsonb NOT NULL,
	"builtin_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doc_passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"page" integer,
	"chunk" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"folded_text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(folded_text, ''))) STORED,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name_tr" text NOT NULL,
	"name_en" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"note" text,
	"text_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"current_version_id" uuid,
	"doc_type" text,
	"status" text DEFAULT 'final' NOT NULL,
	"language" text,
	"period_label" text,
	"period_id" uuid,
	"summary" text,
	"key_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"ai_off" boolean DEFAULT false NOT NULL,
	"classification_status" text DEFAULT 'pending' NOT NULL,
	"child_data_flag" boolean DEFAULT false NOT NULL,
	"child_data_reason" text,
	"starred" boolean DEFAULT false NOT NULL,
	"page_count" integer,
	"text_status" text DEFAULT 'pending' NOT NULL,
	"last_opened_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"ai_off" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"logframe_node_id" uuid,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'planned' NOT NULL,
	"provinces" text[] DEFAULT '{}' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name_tr" text NOT NULL,
	"name_en" text NOT NULL,
	"kind" text DEFAULT 'public' NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicator_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indicator_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicator_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indicator_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"value" numeric NOT NULL,
	"disaggregation" jsonb,
	"organisation_id" uuid,
	"source_document_id" uuid,
	"source_page" integer,
	"source_note" text,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"logframe_node_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"definition" text,
	"unit" text DEFAULT 'number' NOT NULL,
	"disaggregation" text[] DEFAULT '{}' NOT NULL,
	"baseline" numeric,
	"baseline_date" date,
	"lop_target" numeric,
	"data_source" text,
	"frequency" text,
	"responsible_org_id" uuid,
	"means_of_verification" text,
	"direction" text DEFAULT 'increase' NOT NULL,
	"cumulative" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "logframe_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"level" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'quarter' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"crop" text,
	"provinces" text[] DEFAULT '{}' NOT NULL,
	"start_month" integer NOT NULL,
	"start_day" integer DEFAULT 1 NOT NULL,
	"end_month" integer NOT NULL,
	"end_day" integer DEFAULT 28 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text DEFAULT 'all' NOT NULL,
	"scope_id" uuid,
	"question" text NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"saved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"context" jsonb,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"smart_filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"heading" text NOT NULL,
	"guidance" text,
	"word_limit" integer,
	"content" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"number_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"template_id" uuid,
	"period_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"due_date" date,
	"audience" text,
	"language" text DEFAULT 'en-GB' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studio_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'chart' NOT NULL,
	"spec" jsonb NOT NULL,
	"data_source" jsonb,
	"report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taggings" ADD CONSTRAINT "taggings_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_series" ADD CONSTRAINT "meeting_series_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_series_id_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."meeting_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_versions" ADD CONSTRAINT "note_versions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_id_notes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_org_id_organisations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_passages" ADD CONSTRAINT "doc_passages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_passages" ADD CONSTRAINT "doc_passages_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_logframe_node_id_logframe_nodes_id_fk" FOREIGN KEY ("logframe_node_id") REFERENCES "public"."logframe_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_dependencies" ADD CONSTRAINT "activity_dependencies_depends_on_id_activities_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_targets" ADD CONSTRAINT "indicator_targets_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_indicator_id_indicators_id_fk" FOREIGN KEY ("indicator_id") REFERENCES "public"."indicators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_values" ADD CONSTRAINT "indicator_values_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_logframe_node_id_logframe_nodes_id_fk" FOREIGN KEY ("logframe_node_id") REFERENCES "public"."logframe_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicators" ADD CONSTRAINT "indicators_responsible_org_id_organisations_id_fk" FOREIGN KEY ("responsible_org_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logframe_nodes" ADD CONSTRAINT "logframe_nodes_parent_id_logframe_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."logframe_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_suggestions_status_idx" ON "ai_suggestions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "links_unique_idx" ON "links" USING btree ("from_type","from_id","to_type","to_id","kind");--> statement-breakpoint
CREATE INDEX "links_to_idx" ON "links" USING btree ("to_type","to_id");--> statement-breakpoint
CREATE INDEX "links_from_idx" ON "links" USING btree ("from_type","from_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "search_entity_idx" ON "search_index" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_tsv_idx" ON "search_index" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_title_trgm_idx" ON "search_index" USING gin ("folded_title" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "sent_notifications_key_idx" ON "sent_notifications" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "taggings_unique_idx" ON "taggings" USING btree ("tag_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "taggings_entity_idx" ON "taggings" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_idx" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "decisions_meeting_idx" ON "decisions" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_starts_idx" ON "meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "meetings_series_idx" ON "meetings" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "note_versions_note_idx" ON "note_versions" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_daily_idx" ON "notes" USING btree ("daily_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_system_key_idx" ON "notes" USING btree ("system_key");--> statement-breakpoint
CREATE INDEX "notes_parent_idx" ON "notes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_start_idx" ON "tasks" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "tasks_owner_org_idx" ON "tasks" USING btree ("owner_org_id");--> statement-breakpoint
CREATE INDEX "doc_passages_doc_idx" ON "doc_passages" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_passages_tsv_idx" ON "doc_passages" USING gin ("tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_key_idx" ON "document_types" USING btree ("key");--> statement-breakpoint
CREATE INDEX "document_versions_doc_idx" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_folder_idx" ON "documents" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "documents_sha_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("doc_type");--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "activities_start_idx" ON "activities" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_dep_unique_idx" ON "activity_dependencies" USING btree ("activity_id","depends_on_id");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "indicator_targets_unique_idx" ON "indicator_targets" USING btree ("indicator_id","period_id");--> statement-breakpoint
CREATE INDEX "indicator_values_ind_idx" ON "indicator_values" USING btree ("indicator_id","period_id");--> statement-breakpoint
CREATE INDEX "periods_start_idx" ON "periods" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "ask_threads_scope_idx" ON "ask_threads" USING btree ("scope_type","scope_id","created_at");--> statement-breakpoint
CREATE INDEX "report_sections_report_idx" ON "report_sections" USING btree ("report_id","sort");