import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * One database handle for the whole app.
 *
 * Production (Vercel): Neon Postgres in Frankfurt, through DATABASE_URL.
 * Development and tests: PGlite, a real Postgres compiled to WASM that runs
 * inside Node, so nobody needs to install a database to work on the app.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: Promise<DB> };
const holder = globalThis as unknown as { __appDb?: Holder };
holder.__appDb ??= {};

export function usingPglite() {
  const url = process.env.DATABASE_URL;
  return !url || url.startsWith("pglite:") || url === "memory://";
}

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (usingPglite()) {
    const { createPgliteDb } = await import("./pglite");
    return createPgliteDb(url);
  }
  // Node 22+ has a global WebSocket, which the Neon driver uses directly.
  const { Pool } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  const pool = new Pool({ connectionString: url, max: 5 });
  return drizzle({ client: pool, schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  holder.__appDb!.db ??= create();
  return holder.__appDb!.db;
}

/** Tests swap in a fresh in-memory database. */
export function setDbForTests(db: DB) {
  holder.__appDb!.db = Promise.resolve(db);
}

export { schema };
