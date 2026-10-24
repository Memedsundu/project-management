CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"data" jsonb,
	"recipe_id" uuid,
	"model" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "briefs_kind_day_idx" ON "briefs" USING btree ("kind","day");