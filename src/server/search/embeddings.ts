import "server-only";
import { sql } from "drizzle-orm";
import { aiStatus, recordRun } from "@/server/ai/client";
import { VOYAGE_PRICE_PER_MTOK } from "@/server/ai/models";
import { getDb } from "@/server/db/client";
import { EMBEDDING_DIMENSIONS } from "@/server/db/schema/common";
import { enqueue } from "@/server/jobs/queue";

/**
 * Meaning-based search uses Voyage embeddings (voyage-3.5, 1024 numbers per
 * passage). Only text Claude may read is embedded: anything marked
 * "Yapay zekâya kapalı" or flagged by the child-data guard is skipped.
 */

const MODEL = "voyage-3.5";

export function embeddingsConfigured() {
  return Boolean(process.env.VOYAGE_API_KEY);
}

async function voyage(input: string[], inputType: "document" | "query") {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input, model: MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
  const tokens = json.usage?.total_tokens ?? 0;
  await recordRun({ helper: inputType === "query" ? "search" : "embed", provider: "voyage", model: MODEL, costUsd: (tokens / 1_000_000) * VOYAGE_PRICE_PER_MTOK });
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const vec = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/** Embed a search question. Returns null when embeddings are off or the cap is reached. */
export async function embedQuery(text: string) {
  if (!embeddingsConfigured()) return null;
  const status = await aiStatus();
  if (!status.enabled || status.capReached) return null;
  try {
    const [v] = await voyage([text.slice(0, 4000)], "query");
    return v ? vec(v) : null;
  } catch (err) {
    console.error("[embed query]", err);
    return null;
  }
}

/** Job: embed passages and records that have no vector yet. */
export async function embedPendingJob() {
  if (!embeddingsConfigured()) return;
  const status = await aiStatus();
  if (!status.enabled || status.capReached) return;
  const db = await getDb();
  const started = Date.now();
  let more = false;
  while (Date.now() - started < 40_000) {
    const passages = (await db.execute(sql`
      with recursive off_folders as (
        select id from folders where ai_off = true
        union
        select f.id from folders f join off_folders o on f.parent_id = o.id
      )
      select p.id, p.text from doc_passages p
      join documents d on d.id = p.document_id
      where p.embedding is null and d.deleted_at is null and d.ai_off = false and d.child_data_flag = false
        and p.version_id = d.current_version_id
        and (d.folder_id is null or d.folder_id not in (select id from off_folders))
      limit 96`)) as unknown as { rows: { id: string; text: string }[] };
    const records = (await db.execute(sql`
      select id, title, body from search_index
      where embedding is null and ai_off = false and entity_type <> 'document'
      limit ${passages.rows.length ? 0 : 96}`)) as unknown as { rows: { id: string; title: string; body: string }[] };
    if (!passages.rows.length && !records.rows.length) break;
    if (passages.rows.length) {
      const vectors = await voyage(passages.rows.map((p) => p.text.slice(0, 8000)), "document");
      for (const [i, p] of passages.rows.entries()) {
        await db.execute(sql`update doc_passages set embedding = ${vec(vectors[i]!)}::vector where id = ${p.id}::uuid`);
      }
    }
    if (records.rows.length) {
      const vectors = await voyage(records.rows.map((r) => `${r.title}\n${r.body}`.slice(0, 8000)), "document");
      for (const [i, r] of records.rows.entries()) {
        await db.execute(sql`update search_index set embedding = ${vec(vectors[i]!)}::vector, embedded_at = now() where id = ${r.id}::uuid`);
      }
    }
    more = true;
  }
  if (more && Date.now() - started >= 40_000) await enqueue("embed_pending", {}, { dedupeKey: "embed_pending", runAt: new Date(Date.now() + 10_000) });
}
