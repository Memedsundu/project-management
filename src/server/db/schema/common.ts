import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** Postgres tsvector, filled by generated columns. Never written from the app. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/** Raw bytes (passkey public keys). */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    if (value instanceof Uint8Array) return value;
    // Some drivers hand back a hex string such as "\\x0102".
    const hex = String(value).replace(/^\\x/, "");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  },
});

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
/** Soft delete for the 30-day trash. */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true });

export const EMBEDDING_DIMENSIONS = 1024;
