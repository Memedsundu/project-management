import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { DB } from "./client";
import * as schema from "./schema";

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * DATABASE_URL unset or "pglite:./.data/db" stores data on disk;
 * "memory://" keeps everything in memory (tests).
 */
export async function createPgliteDb(url?: string): Promise<DB> {
  let dataDir: string | undefined;
  if (url === "memory://") {
    dataDir = undefined;
  } else {
    dataDir = url?.startsWith("pglite:") ? url.slice("pglite:".length) : "./.data/db";
    mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  }
  const client = await PGlite.create(dataDir, { extensions: { vector, pg_trgm, unaccent } });
  const db = drizzle({ client, schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
