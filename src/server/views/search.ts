import "server-only";
import { addDaysStr, todayStr } from "@/lib/dates";
import { aiConfigured } from "@/server/ai/client";
import { getAskThread, listAskThreads } from "@/server/ai/ask";
import { isEntityType, type EntityType } from "@/server/entities";
import { embeddingsConfigured } from "@/server/search/embeddings";
import { hybridSearch } from "@/server/search/hybrid";
import { GROUP_ORDER, type SearchFilters } from "@/server/search/search";
import { listOrganisationsLite } from "@/server/services/partners-lite";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DATE_RANGES = ["7d", "30d", "year"] as const;

/** "Ara": everything that matches, by kind, with Drive-style filter chips. */
export async function loadSearchPage(sp: SP) {
  const q = (str(sp.q) ?? "").trim().slice(0, 300);
  const typeParam = str(sp.type);
  const type: EntityType | null = typeParam && isEntityType(typeParam) ? typeParam : null;
  const org = str(sp.org) && UUID.test(str(sp.org)!) ? str(sp.org)! : null;
  const date = (DATE_RANGES as readonly string[]).includes(str(sp.date) ?? "") ? (str(sp.date) as (typeof DATE_RANGES)[number]) : null;
  const owner = str(sp.owner) === "me" || str(sp.owner) === "others" ? (str(sp.owner) as "me" | "others") : null;
  const today = todayStr();
  const filters: SearchFilters = {
    orgId: org ?? undefined,
    from: date === "7d" ? addDaysStr(today, -7) : date === "30d" ? addDaysStr(today, -30) : date === "year" ? `${today.slice(0, 4)}-01-01` : undefined,
    owner: owner ?? undefined,
  };
  const [first, orgs] = await Promise.all([q ? hybridSearch(q, { filters, limit: 120 }) : Promise.resolve(null), listOrganisationsLite()]);
  // Nothing has every word: show what has some of them, and say so.
  const loose = Boolean(first && !first.hits.length && q.split(/\s+/).length > 1);
  const result = loose ? await hybridSearch(q, { filters, limit: 120, mode: "or", semantic: false }) : first;
  const all = result?.hits ?? [];
  const counts: Partial<Record<EntityType, number>> = {};
  for (const h of all) counts[h.type] = (counts[h.type] ?? 0) + 1;
  const hits = (type ? all.filter((h) => h.type === type) : all).map((h) => ({
    type: h.type,
    id: h.id,
    title: h.title,
    snippet: h.snippet,
    href: h.page && h.type === "document" ? `${h.href}${h.href.includes("?") ? "&" : "?"}page=${h.page}` : h.href,
    page: h.page ?? null,
    occurredAt: h.occurredAt,
    match: h.match,
  }));
  return {
    q,
    type,
    org,
    date,
    owner,
    today,
    hits,
    total: all.length,
    counts,
    order: GROUP_ORDER.filter((t) => counts[t]),
    semantic: (first?.semantic ?? false) || (result?.semantic ?? false),
    loose: loose && all.length > 0,
    meaningAvailable: embeddingsConfigured(),
    aiReady: aiConfigured(),
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, shortName: o.shortName })),
  };
}
export type SearchPageData = Awaited<ReturnType<typeof loadSearchPage>>;

/** "Sor": the question box, the current answer and the questions asked before. */
export async function loadAskPage(sp: SP) {
  const id = str(sp.id);
  const thread = id && UUID.test(id) ? await getAskThread(id) : null;
  const scope = str(sp.scope) === "meetings" ? ("meetings" as const) : ("all" as const);
  const [all, meetings] = await Promise.all([listAskThreads({ scopeType: "all", limit: 60 }), listAskThreads({ scopeType: "meetings", limit: 30 })]);
  const history = [...all, ...meetings].sort((a, b) => Number(b.saved) - Number(a.saved) || b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
  return {
    q: thread ? "" : (str(sp.q) ?? "").trim().slice(0, 1000),
    scope: thread?.scopeType === "meetings" ? ("meetings" as const) : scope,
    thread,
    history: history.map((h) => ({ id: h.id, question: h.question, saved: h.saved, createdAt: h.createdAt, scopeType: h.scopeType })),
    aiReady: aiConfigured(),
  };
}
export type AskPageData = Awaited<ReturnType<typeof loadAskPage>>;
