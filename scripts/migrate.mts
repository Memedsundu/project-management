/**
 * Apply database migrations to Neon before a production build.
 * Local development uses PGlite, which migrates itself on start, so this skips.
 */
const url = process.env.DATABASE_URL;
if (!url || url.startsWith("pglite:") || url === "memory://") {
  console.log("[migrate] No DATABASE_URL for Postgres; skipping (PGlite migrates on start).");
  process.exit(0);
}
const { Pool } = await import("@neondatabase/serverless");
const { drizzle } = await import("drizzle-orm/neon-serverless");
const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
const pool = new Pool({ connectionString: url });
const db = drizzle({ client: pool });
await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("[migrate] Migrations applied.");
