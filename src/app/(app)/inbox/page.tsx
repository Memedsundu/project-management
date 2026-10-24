import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { InboxScreen } from "@/components/inbox/inbox-screen";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import { getDb } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { resolveEntities, type EntityRef, type EntityType } from "@/server/entities";
import { listAllFolders } from "@/server/services/documents";
import { listInboxNotes } from "@/server/services/notes";
import { listContactsLite, listOrganisationsLite } from "@/server/services/partners-lite";
import { listPendingSuggestions } from "@/server/services/suggestions";
import { listInboxTasks } from "@/server/services/tasks";
import { loadTaskDetail } from "@/server/views/task-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("inbox");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function InboxPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = await getDb();
  const [tasks, notes, pending, [toCheck], [flagged], folders, orgs, contacts, detail] = await Promise.all([
    listInboxTasks(),
    listInboxNotes(),
    listPendingSuggestions({ limit: 100 }),
    db.select({ n: count() }).from(documents).where(and(isNull(documents.deletedAt), eq(documents.classificationStatus, "suggested"))),
    db.select({ n: count() }).from(documents).where(and(isNull(documents.deletedAt), inArray(documents.classificationStatus, ["flagged"]))),
    listAllFolders(),
    listOrganisationsLite(),
    listContactsLite(),
    loadTaskDetail(typeof sp.open === "string" ? sp.open : null),
  ]);
  const suggestions = pending.filter((s) => s.kind !== "classification");
  // Titles for sources and for link proposals, in one pass.
  const refs: EntityRef[] = [];
  for (const s of suggestions) {
    if (s.sourceType && s.sourceId) refs.push({ type: s.sourceType as EntityType, id: s.sourceId });
    if (s.kind === "link") {
      const p = s.payload as { from: EntityRef; to: EntityRef };
      refs.push(p.from, p.to);
    }
  }
  const resolved = await resolveEntities(refs);
  const items: InboxSuggestion[] = suggestions.map((s) => {
    const src = s.sourceType && s.sourceId ? resolved.get(`${s.sourceType}:${s.sourceId}`) : undefined;
    let display: string | null = null;
    if (s.kind === "link") {
      const p = s.payload as { from: EntityRef; to: EntityRef };
      display = `${resolved.get(`${p.from.type}:${p.from.id}`)?.title ?? "—"} ↔ ${resolved.get(`${p.to.type}:${p.to.id}`)?.title ?? "—"}`;
    }
    return {
      id: s.id,
      kind: s.kind,
      title: s.title,
      summary: s.summary,
      createdAt: s.createdAt.toISOString(),
      source: src ? { type: src.type, id: src.id, title: src.title, href: src.href } : null,
      payload: s.payload,
      display,
    };
  });
  return (
    <InboxScreen
      tasks={tasks}
      notes={notes.map((n) => ({ id: n.id, title: n.title, preview: n.plainText.slice(0, 220), createdAt: n.createdAt.toISOString() }))}
      suggestions={items}
      filesToCheck={Number(toCheck?.n ?? 0)}
      flagged={Number(flagged?.n ?? 0)}
      folderNames={Object.fromEntries(folders.map((f) => [f.id, f.name]))}
      orgs={orgs}
      contacts={contacts}
      detail={detail}
    />
  );
}
