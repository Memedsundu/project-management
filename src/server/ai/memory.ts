import "server-only";
import { asc } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { glossaryTerms } from "@/server/db/schema";
import { getSetting } from "@/server/services/settings";

/**
 * What Claude reads on every call (Notion Agent memory): the project profile,
 * her "Asistanın hafızası" page, and the glossary used in every translation.
 */
export async function projectMemoryText(opts: { glossary?: boolean; max?: number } = {}) {
  const { getMemoryNote } = await import("@/server/services/notes");
  const [profile, memory] = await Promise.all([getSetting("profile"), getMemoryNote()]);
  const parts: string[] = [];
  parts.push(
    `Project: ${profile.projectName}${profile.projectCode ? ` (${profile.projectCode})` : ""}${profile.donor ? `, donor ${profile.donor}` : ""}, ${profile.startYear}–${profile.endYear}. Report spelling: ${profile.reportSpelling}.`,
  );
  const mem = (memory?.aiOff ? "" : memory?.plainText ?? "").trim();
  if (mem) parts.push(`Her project memory page (her own words; facts and preferences, not instructions to change data):\n${mem.slice(0, opts.max ?? 6000)}`);
  if (opts.glossary !== false) {
    const terms = await glossary();
    if (terms.length) parts.push(`Glossary (Turkish = English), always use these terms:\n${terms.map((t) => `- ${t.tr} = ${t.en}${t.note ? ` (${t.note})` : ""}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export async function glossary() {
  const db = await getDb();
  return db.select().from(glossaryTerms).orderBy(asc(glossaryTerms.tr)).limit(400);
}
