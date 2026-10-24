-- Extensions used by search: pgvector for meaning-based search, pg_trgm for typo-tolerant
-- matching and unaccent for accent-free comparisons. Neon and PGlite both provide them.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
