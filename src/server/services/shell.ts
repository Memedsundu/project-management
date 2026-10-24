import "server-only";
import { and, asc, count, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { aiSuggestions, collections, documents, notes, savedViews, tasks } from "@/server/db/schema";
import { getSettings } from "./settings";

export type ShellData = {
  appName: string;
  projectName: string;
  years: string;
  readOnly: boolean;
  /** When the project was closed, for the read-only banner. */
  archivedAt: string | null;
  counts: { inbox: number; today: number; filesToCheck: number };
  pinned: { label: string; href: string; kind: "view" | "collection" | "note" }[];
  aiConfigured: boolean;
};

export async function inboxCount() {
  const db = await getDb();
  const [[s], [t], [n], [d]] = await Promise.all([
    db.select({ n: count() }).from(aiSuggestions).where(eq(aiSuggestions.status, "pending")),
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.inbox, true), isNull(tasks.deletedAt), ne(tasks.status, "done"), ne(tasks.status, "canceled"))),
    db.select({ n: count() }).from(notes).where(and(eq(notes.inbox, true), isNull(notes.deletedAt))),
    db
      .select({ n: count() })
      .from(documents)
      .where(and(isNull(documents.deletedAt), inArray(documents.classificationStatus, ["flagged"]))),
  ]);
  return (s?.n ?? 0) + (t?.n ?? 0) + (n?.n ?? 0) + (d?.n ?? 0);
}

export async function getShellData(): Promise<ShellData> {
  const db = await getDb();
  const today = todayStr();
  const { profile, archive } = await getSettings(["profile", "archive"]);
  const [inbox, [todayRow], [filesRow], views, cols, pinnedNotes] = await Promise.all([
    inboxCount(),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          isNull(tasks.parentId),
          inArray(tasks.status, ["todo", "doing", "waiting"]),
          eq(tasks.ownerKind, "me"),
          or(lte(tasks.startDate, today), lte(tasks.dueDate, today), eq(tasks.planDate, today)),
        ),
      ),
    db
      .select({ n: count() })
      .from(documents)
      .where(and(isNull(documents.deletedAt), inArray(documents.classificationStatus, ["suggested", "flagged"]))),
    db.select().from(savedViews).where(eq(savedViews.pinned, true)).orderBy(asc(savedViews.sort)).limit(8),
    db
      .select()
      .from(collections)
      .where(and(eq(collections.pinned, true), isNull(collections.deletedAt)))
      .limit(8),
    db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(and(eq(notes.pinned, true), isNull(notes.deletedAt)))
      .orderBy(asc(notes.sortOrder))
      .limit(8),
  ]);
  const viewHref = (kind: string, id: string) =>
    kind === "files" ? `/files/views/${id}` : kind === "search" ? `/search?view=${id}` : `/tasks?view=${id}`;
  return {
    appName: profile.appName,
    projectName: profile.projectName,
    years: `${profile.startYear}–${profile.endYear}`,
    readOnly: archive.readOnly,
    archivedAt: archive.readOnly ? archive.archivedAt : null,
    counts: { inbox, today: todayRow?.n ?? 0, filesToCheck: filesRow?.n ?? 0 },
    pinned: [
      ...views.map((v) => ({ label: v.name, href: viewHref(v.kind, v.id), kind: "view" as const })),
      ...cols.map((c) => ({ label: c.name, href: `/collections/${c.id}`, kind: "collection" as const })),
      ...pinnedNotes.map((n) => ({ label: n.title || "—", href: `/notes/${n.id}`, kind: "note" as const })),
    ],
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}
