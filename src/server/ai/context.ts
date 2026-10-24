import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { decisions, docPassages, documents, meetings, notes, organisations, tasks } from "@/server/db/schema";
import type { EntityRef } from "@/server/entities";
import { AiError } from "./client";

/** True when a folder or any folder above it is marked "Yapay zekâya kapalı". */
export async function folderAiOff(folderId: string | null | undefined) {
  if (!folderId) return false;
  const db = await getDb();
  const res = (await db.execute(sql`
    with recursive chain as (
      select id, parent_id, ai_off from folders where id = ${folderId}::uuid
      union all
      select f.id, f.parent_id, f.ai_off from folders f join chain c on f.id = c.parent_id
    )
    select bool_or(ai_off) as off from chain`)) as unknown as { rows: { off: boolean | null }[] };
  return Boolean(res.rows?.[0]?.off);
}

export async function documentAiOff(doc: { aiOff: boolean; folderId: string | null; childDataFlag?: boolean }) {
  return doc.aiOff || Boolean(doc.childDataFlag) || (await folderAiOff(doc.folderId));
}

export class AiOffError extends AiError {
  constructor() {
    super("ai_off", "This item is kept away from AI.");
  }
}

export type EntityText = { title: string; text: string; aiOff: boolean; kind: string; date?: string | null };

const MAX = 60_000;

/** The text of a record, as Claude may read it. Honours every AI-off switch. */
export async function loadEntityText(ref: EntityRef, opts: { max?: number } = {}): Promise<EntityText | null> {
  const db = await getDb();
  const max = opts.max ?? MAX;
  if (ref.type === "note") {
    const [n] = await db.select().from(notes).where(eq(notes.id, ref.id)).limit(1);
    if (!n || n.deletedAt) return null;
    return { title: n.title || "Not", text: n.plainText.slice(0, max), aiOff: n.aiOff, kind: n.kind, date: n.dailyDate };
  }
  if (ref.type === "meeting") {
    const [m] = await db.select().from(meetings).where(eq(meetings.id, ref.id)).limit(1);
    if (!m || m.deletedAt) return null;
    const agenda = (m.agenda ?? []).map((a) => `- ${a.text}${a.notes ? `: ${a.notes}` : ""}`).join("\n");
    const decs = await db.select().from(decisions).where(and(eq(decisions.meetingId, m.id), isNull(decisions.deletedAt)));
    const parts = [
      agenda ? `Agenda:\n${agenda}` : "",
      m.notesText ? `Notes:\n${m.notesText}` : "",
      decs.length ? `Decisions:\n${decs.map((d) => `- ${d.text}`).join("\n")}` : "",
      m.transcript ? `Transcript:\n${m.transcript}` : "",
    ].filter(Boolean);
    return { title: m.title, text: parts.join("\n\n").slice(0, max), aiOff: m.aiOff, kind: "meeting", date: m.startsAt.toISOString().slice(0, 10) };
  }
  if (ref.type === "document") {
    const [d] = await db.select().from(documents).where(eq(documents.id, ref.id)).limit(1);
    if (!d || d.deletedAt) return null;
    const off = await documentAiOff(d);
    if (off) return { title: d.title, text: "", aiOff: true, kind: "document" };
    const passages = d.currentVersionId
      ? await db
          .select({ page: docPassages.page, text: docPassages.text })
          .from(docPassages)
          .where(eq(docPassages.versionId, d.currentVersionId))
          .orderBy(asc(docPassages.page), asc(docPassages.chunk))
      : [];
    let text = "";
    let lastPage: number | null = null;
    for (const p of passages) {
      if (p.page !== lastPage && p.page != null) text += `\n[page ${p.page}]\n`;
      lastPage = p.page;
      text += p.text + "\n";
      if (text.length > max) break;
    }
    return { title: d.title, text: text.slice(0, max), aiOff: false, kind: "document", date: d.createdAt.toISOString().slice(0, 10) };
  }
  if (ref.type === "task") {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, ref.id)).limit(1);
    if (!t || t.deletedAt) return null;
    return { title: t.title, text: [t.title, t.notes].filter(Boolean).join("\n\n"), aiOff: false, kind: "task", date: t.dueDate };
  }
  if (ref.type === "organisation") {
    const [o] = await db.select().from(organisations).where(eq(organisations.id, ref.id)).limit(1);
    if (!o || o.deletedAt) return null;
    return { title: o.name, text: [o.statusLine, o.notes].filter(Boolean).join("\n\n"), aiOff: false, kind: "organisation" };
  }
  return null;
}

/** Load text and refuse when the record is kept away from AI. */
export async function requireAiText(ref: EntityRef, opts: { max?: number } = {}) {
  const t = await loadEntityText(ref, opts);
  if (!t) throw new AiError("failed", "Record not found.");
  if (t.aiOff) throw new AiOffError();
  return t;
}
