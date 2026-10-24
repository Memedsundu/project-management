import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { embedQuery } from "./embeddings";
import { filterSql, keywordSearch, toHit, type SearchFilters, type SearchHit } from "./search";

export type HybridHit = SearchHit & { match: "keyword" | "meaning" | "both" };

type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
  const db = await getDb();
  const res = (await db.execute(query)) as unknown as { rows: Row[] };
  return res.rows ?? [];
}

/** Below this cosine similarity a vector match is noise. */
const MIN_SIMILARITY = 0.3;

/**
 * Meaning-based matches: records and file passages whose vectors sit close to
 * the question's vector, so a Turkish question finds an English report.
 */
export async function semanticSearch(vec: string, opts: { filters?: SearchFilters; limit?: number } = {}): Promise<SearchHit[]> {
  const limit = opts.limit ?? 30;
  const filters = filterSql(opts.filters);
  const extra = filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``;
  const types = opts.filters?.types ?? [];
  const wantDocs = !types.length || types.includes("document");
  const wantRecords = !types.length || types.some((t) => t !== "document");

  const [records, passages] = await Promise.all([
    wantRecords
      ? rows(sql`
          select s.entity_type, s.entity_id, s.title, s.meta, s.occurred_at, left(s.body, 220) as body,
            1 - (s.embedding <=> ${vec}::vector) as sim
          from search_index s
          where s.embedding is not null and s.entity_type <> 'document' ${extra}
          order by s.embedding <=> ${vec}::vector
          limit ${limit}`)
      : Promise.resolve([]),
    wantDocs
      ? rows(sql`
          select p.document_id, p.page, p.text, 1 - (p.embedding <=> ${vec}::vector) as sim
          from doc_passages p
          join documents d on d.id = p.document_id and d.deleted_at is null and p.version_id = d.current_version_id
          where p.embedding is not null
          order by p.embedding <=> ${vec}::vector
          limit 80`)
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const r of records) {
    const sim = Number(r.sim ?? 0);
    if (sim >= MIN_SIMILARITY) hits.push(toHit(r, String(r.body ?? ""), sim));
  }

  // One hit per file: its closest passage, with the page.
  const best = new Map<string, Row>();
  for (const p of passages) {
    if (Number(p.sim ?? 0) < MIN_SIMILARITY) continue;
    const id = String(p.document_id);
    if (!best.has(id)) best.set(id, p);
  }
  if (best.size) {
    const docRows = await rows(sql`
      select s.entity_type, s.entity_id, s.title, s.meta, s.occurred_at
      from search_index s
      where s.entity_type = 'document' and s.entity_id in (${sql.join([...best.keys()].map((id) => sql`${id}::uuid`), sql`, `)}) ${extra}`);
    for (const d of docRows) {
      const p = best.get(String(d.entity_id))!;
      const text = String(p.text ?? "").replace(/\s+/g, " ").trim();
      const hit = toHit(d, text.length > 200 ? `${text.slice(0, 200)}…` : text, Number(p.sim ?? 0));
      hit.page = (p.page as number | null) ?? null;
      hits.push(hit);
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Keyword and meaning together (reciprocal rank fusion). Keyword search is
 * free and instant; meaning search runs only when Voyage is connected.
 */
export async function hybridSearch(
  query: string,
  opts: { filters?: SearchFilters; limit?: number; semantic?: boolean; vector?: string | null; mode?: "and" | "or" } = {},
): Promise<{ hits: HybridHit[]; semantic: boolean }> {
  const limit = opts.limit ?? 40;
  const wantSemantic = opts.semantic !== false && query.trim().length >= 3;
  const [keyword, vec] = await Promise.all([
    keywordSearch(query, { filters: opts.filters, limit, mode: opts.mode }),
    !wantSemantic ? Promise.resolve(null) : opts.vector !== undefined ? Promise.resolve(opts.vector) : embedQuery(query),
  ]);
  if (!vec) return { hits: keyword.map((h) => ({ ...h, match: "keyword" as const })), semantic: false };

  const meaning = await semanticSearch(vec, { filters: opts.filters, limit });
  const K = 60;
  const fused = new Map<string, HybridHit & { rrf: number }>();
  keyword.forEach((h, i) => fused.set(`${h.type}:${h.id}`, { ...h, match: "keyword", rrf: 1 / (K + i + 1) }));
  meaning.forEach((h, i) => {
    const key = `${h.type}:${h.id}`;
    const seen = fused.get(key);
    if (seen) {
      seen.rrf += 1 / (K + i + 1);
      seen.match = "both";
      seen.page ??= h.page;
      if (!seen.snippet) seen.snippet = h.snippet;
    } else fused.set(key, { ...h, match: "meaning", rrf: 1 / (K + i + 1) });
  });
  const hits = [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map(({ rrf, ...h }) => ({ ...h, score: rrf }));
  return { hits, semantic: true };
}
