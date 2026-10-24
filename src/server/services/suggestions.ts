import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { aiSuggestions } from "@/server/db/schema";
import type { EntityRef, EntityType } from "@/server/entities";
import { logActivity } from "./activity";

/**
 * Everything Claude proposes lands here first. Nothing changes in the
 * workspace until she accepts (all, some, or an edited version).
 */

export type SuggestionKind =
  | "tasks"
  | "classification"
  | "organize"
  | "indicator_values"
  | "key_dates"
  | "meeting_recap"
  | "link"
  | "note"
  | "agenda"
  | "workplan"
  | "memory";

export type ProposedTask = {
  title: string;
  dueDate?: string | null;
  startDate?: string | null;
  ownerName?: string | null;
  ownerOrgId?: string | null;
  priority?: number | null;
  notes?: string | null;
  parentId?: string | null;
};

export async function createSuggestion(input: {
  kind: SuggestionKind;
  title: string;
  summary?: string | null;
  payload: unknown;
  source?: EntityRef | null;
}) {
  const db = await getDb();
  const [row] = await db
    .insert(aiSuggestions)
    .values({
      kind: input.kind,
      title: input.title.slice(0, 300),
      summary: input.summary ?? null,
      payload: input.payload as object,
      sourceType: input.source?.type ?? null,
      sourceId: input.source?.id ?? null,
    })
    .returning();
  await logActivity({
    action: "suggest",
    entityType: input.source?.type ?? "suggestion",
    entityId: input.source?.id ?? row!.id,
    title: input.title,
    summary: input.kind,
    actor: "ai",
  });
  return row!;
}

export async function listPendingSuggestions(opts: { kinds?: SuggestionKind[]; source?: EntityRef; limit?: number } = {}) {
  const db = await getDb();
  const where = [eq(aiSuggestions.status, "pending")];
  if (opts.kinds?.length) where.push(inArray(aiSuggestions.kind, opts.kinds));
  if (opts.source) {
    where.push(eq(aiSuggestions.sourceType, opts.source.type), eq(aiSuggestions.sourceId, opts.source.id));
  }
  return db
    .select()
    .from(aiSuggestions)
    .where(and(...where))
    .orderBy(desc(aiSuggestions.createdAt))
    .limit(opts.limit ?? 100);
}

export async function getSuggestion(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(aiSuggestions).where(eq(aiSuggestions.id, id)).limit(1);
  return row ?? null;
}

type Applier = (payload: unknown, decision: unknown, source: EntityRef | null, suggestionId: string) => Promise<{ status: "accepted" | "partial"; result?: unknown }>;

const APPLIERS: Record<SuggestionKind, () => Promise<Applier>> = {
  tasks: async () => applyTasks,
  key_dates: async () => applyTasks,
  link: async () => applyLink,
  note: async () => applyNote,
  classification: async () => (await import("@/server/ai/classify")).applyClassification,
  organize: async () => (await import("@/server/ai/organize")).applyOrganize,
  indicator_values: async () => (await import("@/server/ai/indicator-reader")).applyIndicatorValues,
  meeting_recap: async () => (await import("./meetings")).applyMeetingRecap,
  agenda: async () => (await import("./meetings")).applyAgendaSuggestion,
  workplan: async () => applyTasks,
  memory: async () => applyMemory,
};

/** Accept a suggestion. `decision` carries her edits (which items, changed fields). */
export async function acceptSuggestion(id: string, decision?: unknown) {
  const s = await getSuggestion(id);
  if (!s || s.status !== "pending") return null;
  const apply = await APPLIERS[s.kind as SuggestionKind]();
  const source = s.sourceType && s.sourceId ? { type: s.sourceType as EntityType, id: s.sourceId } : null;
  const outcome = await apply(s.payload, decision, source, s.id);
  const db = await getDb();
  await db
    .update(aiSuggestions)
    .set({ status: outcome.status, decision: (decision ?? null) as object | null, decidedAt: new Date() })
    .where(eq(aiSuggestions.id, id));
  await logActivity({
    action: "accept",
    entityType: source?.type ?? "suggestion",
    entityId: source?.id ?? id,
    title: s.title,
    summary: s.kind,
  });
  return outcome;
}

export async function rejectSuggestion(id: string) {
  const db = await getDb();
  const [row] = await db
    .update(aiSuggestions)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.status, "pending")))
    .returning();
  if (row?.kind === "classification") {
    // She turned the filing down: the file leaves Kontrol and keeps its current details.
    const documentId = String((row.payload as { documentId?: string }).documentId ?? "");
    if (documentId) {
      const { documents } = await import("@/server/db/schema");
      await db
        .update(documents)
        .set({ classificationStatus: "skipped" })
        .where(and(eq(documents.id, documentId), eq(documents.classificationStatus, "suggested")));
    }
  }
  if (row) {
    await logActivity({
      action: "reject",
      entityType: row.sourceType ?? "suggestion",
      entityId: row.sourceId ?? id,
      title: row.title,
      summary: row.kind,
    });
  }
  return row ?? null;
}

/* ----------------------------- Built-in appliers ----------------------------- */

type TasksPayload = { tasks: ProposedTask[] };
type TasksDecision = { tasks?: ProposedTask[]; indexes?: number[] };

async function applyTasks(payload: unknown, decision: unknown, source: EntityRef | null) {
  const { createTask } = await import("./tasks");
  const p = payload as TasksPayload;
  const d = (decision ?? {}) as TasksDecision;
  const chosen = d.tasks ?? (d.indexes ? d.indexes.map((i) => p.tasks[i]).filter(Boolean) : p.tasks);
  const created = [];
  for (const t of chosen as ProposedTask[]) {
    if (!t?.title?.trim()) continue;
    created.push(
      await createTask(
        {
          title: t.title,
          notes: t.notes ?? null,
          dueDate: t.dueDate ?? null,
          startDate: t.startDate ?? null,
          ownerOrgId: t.ownerOrgId ?? null,
          ownerName: t.ownerOrgId ? null : (t.ownerName ?? null),
          priority: t.priority ?? undefined,
          parentId: t.parentId ?? null,
          sourceType: source?.type ?? null,
          sourceId: source?.id ?? null,
        },
        "ai",
      ),
    );
  }
  return { status: created.length === p.tasks.length ? ("accepted" as const) : ("partial" as const), result: created.map((t) => t.id) };
}

async function applyLink(payload: unknown) {
  const { addLink } = await import("./links");
  const p = payload as { from: EntityRef; to: EntityRef };
  await addLink(p.from, p.to, "related", "ai");
  return { status: "accepted" as const };
}

async function applyNote(payload: unknown, decision: unknown) {
  const { createNote } = await import("./notes");
  const p = { ...(payload as { title: string; markdown: string; parentId?: string | null }), ...((decision ?? {}) as object) } as {
    title: string;
    markdown: string;
    parentId?: string | null;
  };
  const note = await createNote({ title: p.title, markdown: p.markdown, parentId: p.parentId ?? null }, "ai");
  return { status: "accepted" as const, result: note.id };
}

export type MemoryPayload = { lines: string[]; terms: { tr: string; en: string; note?: string | null }[] };

/** Lines go to the end of "Asistanın hafızası"; terms join the glossary (same Turkish term: updated). */
async function applyMemory(payload: unknown, decision: unknown) {
  const { getMemoryNote, updateNote } = await import("./notes");
  const { markdownToBlocks } = await import("@/lib/blocks");
  const p = payload as MemoryPayload;
  const d = (decision ?? {}) as { indexes?: number[] };
  const all = [...p.lines.map((text) => ({ kind: "line" as const, text })), ...p.terms.map((term) => ({ kind: "term" as const, term }))];
  const chosen = d.indexes ? d.indexes.map((i) => all[i]).filter(Boolean) : all;
  const lines = chosen.flatMap((c) => (c?.kind === "line" ? [c.text] : []));
  const terms = chosen.flatMap((c) => (c?.kind === "term" ? [c.term] : []));
  if (lines.length) {
    const note = await getMemoryNote();
    const content = [...((note.content as unknown[]) ?? []), ...markdownToBlocks(lines.map((l) => `- ${l.replace(/^[-*•]\s*/, "")}`).join("\n"))];
    await updateNote(note.id, { content }, "ai");
  }
  if (terms.length) {
    const { saveGlossaryTerm } = await import("./glossary");
    for (const t of terms) await saveGlossaryTerm({ tr: t.tr, en: t.en, note: t.note ?? null });
  }
  return { status: chosen.length === all.length ? ("accepted" as const) : ("partial" as const) };
}
