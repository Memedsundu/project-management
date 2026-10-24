import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { foldText, queryTerms, stemmedTsQuery, stemTerm } from "@/lib/fold";
import { getDb } from "@/server/db/client";
import { ENTITIES, isEntityType, type EntityType } from "@/server/entities";

export type SearchFilters = {
  types?: EntityType[];
  orgId?: string;
  from?: string;
  to?: string;
  owner?: "me" | "others";
  docType?: string;
};

export type SearchHit = {
  type: EntityType;
  id: string;
  title: string;
  snippet: string;
  href: string;
  meta: Record<string, unknown>;
  score: number;
  occurredAt: string | null;
  page?: number | null;
};

type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
  const db = await getDb();
  const res = (await db.execute(query)) as unknown as { rows: Row[] };
  return res.rows ?? [];
}

/** A window of text around the first matching word. */
export function makeSnippet(body: string, foldedBody: string, stems: string[], size = 200): string {
  if (!body) return "";
  let at = -1;
  for (const s of stems) {
    if (!s) continue;
    const re = new RegExp(`(^|\\s)${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    const m = re.exec(foldedBody);
    if (m && (at === -1 || m.index < at)) at = m.index + m[1]!.length;
  }
  // Folding keeps one character per character for Turkish text, so the
  // position in the folded body is close enough in the original.
  const start = Math.max(0, at === -1 ? 0 : at - 60);
  const end = Math.min(body.length, start + size);
  let snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < body.length) snippet += "…";
  return snippet;
}

function filterSql(f: SearchFilters | undefined): SQL[] {
  const where: SQL[] = [];
  if (!f) return where;
  const types = (f.types ?? []).filter(isEntityType);
  if (types.length) where.push(sql`s.entity_type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})`);
  if (f.orgId) where.push(sql`(s.meta -> 'orgIds') ? ${f.orgId}`);
  if (f.from) where.push(sql`s.occurred_at >= ${f.from}::date`);
  if (f.to) where.push(sql`s.occurred_at < (${f.to}::date + 1)`);
  if (f.owner === "me") where.push(sql`coalesce(s.meta ->> 'owner', 'me') = 'me'`);
  if (f.owner === "others") where.push(sql`coalesce(s.meta ->> 'owner', 'me') <> 'me'`);
  if (f.docType) where.push(sql`s.meta ->> 'docType' = ${f.docType}`);
  return where;
}

/**
 * Keyword search across everything: titles and bodies from search_index, plus
 * the words inside files from doc_passages. Turkish-aware (folded text, light
 * stemming, prefix matching) and forgiving of small typos in titles.
 */
export async function keywordSearch(
  query: string,
  opts: { filters?: SearchFilters; limit?: number } = {},
): Promise<SearchHit[]> {
  const limit = opts.limit ?? 40;
  const folded = foldText(query);
  const terms = queryTerms(query);
  const stems = terms.map(stemTerm);
  const andQuery = stemmedTsQuery(query, "and");
  const filters = filterSql(opts.filters);
  const extra = filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``;

  // No words: show the most recent items (used by pickers with an empty box).
  if (!andQuery) {
    const recent = await rows(sql`
      select s.entity_type, s.entity_id, s.title, s.meta, s.occurred_at, left(s.body, 220) as body
      from search_index s where true ${extra}
      order by s.updated_at desc limit ${limit}`);
    return recent.map((r) => toHit(r, String(r.body ?? ""), 0));
  }

  const matched = await rows(sql`
    select s.entity_type, s.entity_id, s.title, s.body, s.folded_body, s.meta, s.occurred_at,
      ts_rank_cd(s.tsv, to_tsquery('simple', ${andQuery})) as rank,
      word_similarity(${folded}, s.folded_title) as sim,
      (position(${folded} in s.folded_title) > 0) as exact
    from search_index s
    where (s.tsv @@ to_tsquery('simple', ${andQuery}) or word_similarity(${folded}, s.folded_title) > 0.45) ${extra}
    order by (ts_rank_cd(s.tsv, to_tsquery('simple', ${andQuery})) * 2
      + word_similarity(${folded}, s.folded_title)
      + case when position(${folded} in s.folded_title) > 0 then 1 else 0 end) desc,
      s.occurred_at desc nulls last
    limit ${limit}`);

  const hits = new Map<string, SearchHit>();
  for (const r of matched) {
    const score = Number(r.rank ?? 0) * 2 + Number(r.sim ?? 0) + (r.exact ? 1 : 0);
    const snippet = makeSnippet(String(r.body ?? ""), String(r.folded_body ?? ""), stems);
    const hit = toHit(r, snippet, score);
    hits.set(`${hit.type}:${hit.id}`, hit);
  }

  // Words inside files (current version only, not in the trash).
  const wantDocs = !opts.filters?.types?.length || opts.filters.types.includes("document");
  if (wantDocs) {
    const passages = await rows(sql`
      select p.document_id, p.page, p.text, p.folded_text,
        ts_rank_cd(p.tsv, to_tsquery('simple', ${andQuery})) as rank
      from doc_passages p
      join documents d on d.id = p.document_id and d.deleted_at is null and p.version_id = d.current_version_id
      where p.tsv @@ to_tsquery('simple', ${andQuery})
      order by rank desc limit 60`);
    const best = new Map<string, Row>();
    for (const p of passages) {
      const id = String(p.document_id);
      if (!best.has(id)) best.set(id, p);
    }
    const missing = [...best.keys()].filter((id) => !hits.has(`document:${id}`));
    if (missing.length) {
      const docRows = await rows(sql`
        select s.entity_type, s.entity_id, s.title, s.meta, s.occurred_at
        from search_index s
        where s.entity_type = 'document' and s.entity_id in (${sql.join(missing.map((m) => sql`${m}::uuid`), sql`, `)}) ${extra}`);
      for (const d of docRows) {
        const p = best.get(String(d.entity_id))!;
        const hit = toHit(d, makeSnippet(String(p.text), String(p.folded_text), stems), Number(p.rank ?? 0) * 1.5);
        hit.page = (p.page as number | null) ?? null;
        hits.set(`document:${hit.id}`, hit);
      }
    }
    for (const [id, p] of best) {
      const hit = hits.get(`document:${id}`);
      if (hit && hit.page == null) {
        hit.page = (p.page as number | null) ?? null;
        if (!hit.snippet) hit.snippet = makeSnippet(String(p.text), String(p.folded_text), stems);
        hit.score += Number(p.rank ?? 0);
      }
    }
  }

  return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function toHit(r: Row, snippet: string, score: number): SearchHit {
  const type = String(r.entity_type) as EntityType;
  const id = String(r.entity_id);
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const def = ENTITIES[type];
  const occurred = r.occurred_at ? new Date(r.occurred_at as string).toISOString() : null;
  return {
    type,
    id,
    title: String(r.title ?? "—"),
    snippet,
    href: def ? def.href(id, meta) : "#",
    meta,
    score,
    occurredAt: occurred,
  };
}

/** Group hits by kind in a fixed order for the ⌘K menu and the search page. */
export const GROUP_ORDER: EntityType[] = [
  "task",
  "note",
  "document",
  "meeting",
  "organisation",
  "contact",
  "decision",
  "activity",
  "indicator",
  "report",
  "collection",
  "folder",
  "series",
  "logframe",
  "template",
  "visual",
];
