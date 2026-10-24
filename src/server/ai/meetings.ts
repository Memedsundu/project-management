import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { formatLongDay, todayStr } from "@/lib/dates";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { aiSuggestions } from "@/server/db/schema";
import type { MeetingRecap } from "@/server/db/schema/work";
import { checkForChildData } from "@/server/files/child-guard";
import { getMeeting, updateMeeting } from "@/server/services/meetings";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { createSuggestion } from "@/server/services/suggestions";
import { aiJson, aiText, asMaterial } from "./client";
import { requireAiText } from "./context";
import { projectMemoryText } from "./memory";

/**
 * Granola and Fellow for her meetings: a prep brief before, a recap after
 * (decisions, actions with owner and date, open questions, next steps), a
 * transcript merged into her own notes, and a follow-up email she copies.
 * Everything is a draft or a proposal; nothing is sent or saved on its own.
 */

function guard(text: string) {
  if (checkForChildData({ text }).flag) throw new UserError("Bu toplantı metninde bir çocuğa ait kişisel bilgi olabilir; yapay zekâya gönderilmedi. Önce o bilgiyi çıkar.");
}

async function partnersList() {
  const partners = await listOrganisationsLite();
  return { partners, text: partners.map((p) => `- ${p.id}: ${p.name}${p.shortName ? ` (${p.shortName})` : ""}`).join("\n") || "(none)" };
}

/* --------------------------------- Prep --------------------------------- */

/** "Hazırlık": five lines before the call, from facts the app already holds. */
export async function writePrepBrief(meetingId: string, factsText: string, language: "tr" | "en") {
  const m = await getMeeting(meetingId);
  if (!m) throw new UserError("Toplantı bulunamadı.");
  if (m.aiOff) throw new UserError("Bu toplantı yapay zekâya kapalı.");
  guard(factsText);
  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const { text } = await aiText({
    helper: "prepBrief",
    effort: "low",
    thinking: "light",
    maxTokens: 1200,
    entity: { type: "meeting", id: meetingId },
    system: [
      memory,
      `Write her preparation brief for the meeting below in ${language === "en" ? "English" : "Turkish"}: at most six short bullet lines in Markdown ("- "). Lead with what she must raise or chase (late items, open actions, coming deadlines), then the last decisions that matter for this meeting, then one or two questions to ask. Use only the facts given. No preface.`,
    ].join("\n\n"),
    messages: [{ role: "user", content: asMaterial("meeting", { title: m.title, date: m.startsAt.toISOString().slice(0, 10) }, factsText) }],
  });
  const brief = text.trim();
  await updateMeeting(meetingId, { prepBrief: brief }, "ai");
  return brief;
}

/* --------------------------------- Recap -------------------------------- */

const RecapSchema = z.object({
  summary: z.string().describe("Two to four sentences: what the meeting was about and its outcome."),
  decisions: z.array(z.string()).describe("Each decision as one clear sentence. Only things actually agreed."),
  actions: z.array(
    z.object({
      title: z.string().describe("Short imperative action, in the recap language."),
      ownerName: z.string().nullable().describe("Who does it, as written in the notes. Null when it is her own action."),
      ownerPartnerId: z.string().nullable().describe("Partner id from the list when a partner organisation owns it."),
      dueDate: z.string().nullable().describe("YYYY-MM-DD when a date is stated or clearly implied, else null."),
    }),
  ),
  openQuestions: z.array(z.string()).describe("Questions raised and not answered."),
  nextSteps: z.array(z.string()).describe("Next steps that are not individual actions, such as the next meeting or a follow-up visit."),
});

/** "Özet çıkar": the recap as a proposal she reviews in the meeting. */
export async function recapMeeting(meetingId: string, language: "tr" | "en") {
  const m = await getMeeting(meetingId);
  if (!m) throw new UserError("Toplantı bulunamadı.");
  const material = await requireAiText({ type: "meeting", id: meetingId }, { max: 120_000 });
  if (!material.text.trim()) throw new UserError("Önce birkaç not yaz ya da bir döküm ekle.");
  guard(material.text);
  const { partners, text: partnerText } = await partnersList();
  const day = m.startsAt.toISOString().slice(0, 10);
  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const out = await aiJson({
    helper: "meetingRecap",
    effort: "low",
    maxTokens: 5000,
    schema: RecapSchema,
    entity: { type: "meeting", id: meetingId },
    system: [
      memory,
      `Write the recap of this meeting in ${language === "en" ? "British English" : "Turkish"}. The meeting was on ${day} (${formatLongDay(day, "en")}); resolve relative dates against it. Today is ${todayStr()}. Her notes are short and rough; the transcript, if present, fills gaps. Keep names of organisations; never include personal data about children. Partners:\n${partnerText}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: asMaterial("meeting", { title: m.title, date: day }, material.text) }],
  });
  const ids = new Set(partners.map((p) => p.id));
  const recap: MeetingRecap = {
    summary: out.summary.trim(),
    decisions: out.decisions.map((d) => d.trim()).filter(Boolean).slice(0, 30),
    actions: out.actions.slice(0, 40).map((a) => ({
      title: a.title.slice(0, 300),
      owner: a.ownerPartnerId && ids.has(a.ownerPartnerId) ? (partners.find((p) => p.id === a.ownerPartnerId)?.shortName ?? partners.find((p) => p.id === a.ownerPartnerId)?.name ?? null) : a.ownerName,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate ?? "") ? a.dueDate : null,
    })),
    openQuestions: out.openQuestions.slice(0, 20),
    nextSteps: out.nextSteps.slice(0, 20),
    language,
  };
  const tasks = out.actions.slice(0, 40).map((a) => ({
    title: a.title.slice(0, 300),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate ?? "") ? a.dueDate : null,
    ownerOrgId: a.ownerPartnerId && ids.has(a.ownerPartnerId) ? a.ownerPartnerId : null,
    ownerName: a.ownerPartnerId && ids.has(a.ownerPartnerId) ? null : a.ownerName,
  }));
  // A new recap replaces an older proposal she has not reviewed yet.
  const db = await getDb();
  await db
    .update(aiSuggestions)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(and(eq(aiSuggestions.kind, "meeting_recap"), eq(aiSuggestions.status, "pending"), eq(aiSuggestions.sourceType, "meeting"), eq(aiSuggestions.sourceId, meetingId)));
  return createSuggestion({
    kind: "meeting_recap",
    title: language === "en" ? `Recap: ${m.title}` : `Özet: ${m.title}`,
    summary: recap.summary.slice(0, 300),
    payload: { recap, tasks },
    source: { type: "meeting", id: meetingId },
  });
}

/* ------------------------------ Transcript ------------------------------ */

/** Granola: her rough notes stay the backbone; the transcript fills in details. */
export async function mergeTranscript(meetingId: string, notesMarkdown: string) {
  const m = await getMeeting(meetingId);
  if (!m) throw new UserError("Toplantı bulunamadı.");
  if (m.aiOff) throw new UserError("Bu toplantı yapay zekâya kapalı.");
  const transcript = (m.transcript ?? "").trim();
  if (!transcript) throw new UserError("Önce bir döküm ekle.");
  guard(`${notesMarkdown}\n${transcript}`);
  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const { text } = await aiText({
    helper: "transcript",
    effort: "medium",
    maxTokens: 12000,
    entity: { type: "meeting", id: meetingId },
    system: [
      memory,
      "Merge the meeting transcript into her notes. Keep her headings, order and wording; they show what mattered to her. Under each of her points add the missing facts from the transcript: numbers, dates, who said what (organisation and role, not private details), and anything agreed. Add a short section for important topics she did not note. Mark decisions with **Karar:** (or **Decision:** in English notes) and actions with - [ ] check-list items. Write in the language of her notes. Never include personal data about children. Answer with the merged notes in Markdown only.",
    ].join("\n\n"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: asMaterial("note", { title: `${m.title}: her notes` }, notesMarkdown || "(no notes yet)") },
          { type: "text", text: asMaterial("source", { title: `${m.title}: transcript` }, transcript.slice(0, 400_000)) },
        ],
      },
    ],
  });
  return text.trim();
}

/* ---------------------------- Follow-up email ---------------------------- */

/** Fellow's follow-up: a draft she copies into Outlook. The app never sends email. */
export async function draftFollowupEmail(meetingId: string, language: "tr" | "en") {
  const m = await getMeeting(meetingId);
  if (!m) throw new UserError("Toplantı bulunamadı.");
  const material = await requireAiText({ type: "meeting", id: meetingId }, { max: 60_000 });
  const recap = m.recap
    ? [
        `Summary: ${m.recap.summary}`,
        m.recap.decisions.length ? `Decisions:\n${m.recap.decisions.map((d) => `- ${d}`).join("\n")}` : "",
        m.recap.actions.length ? `Actions:\n${m.recap.actions.map((a) => `- ${a.title}${a.owner ? ` (${a.owner})` : ""}${a.dueDate ? `, by ${a.dueDate}` : ""}`).join("\n")}` : "",
        m.recap.nextSteps.length ? `Next steps:\n${m.recap.nextSteps.map((s) => `- ${s}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const body = [recap, material.text].filter(Boolean).join("\n\n");
  if (!body.trim()) throw new UserError("Önce birkaç not yaz ya da özet çıkar.");
  guard(body);
  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const { text } = await aiText({
    helper: "followupEmail",
    effort: "low",
    thinking: "light",
    maxTokens: 2500,
    entity: { type: "meeting", id: meetingId },
    system: [
      memory,
      language === "en"
        ? "Draft a short, warm and professional follow-up email in British English to the meeting participants. Start with 'Subject: ' on the first line. Thank them, list the decisions and the actions with owner and date, and say when the next meeting is if known. No placeholders for facts that are not in the material; use [name] only for the greeting."
        : "Toplantı katılımcılarına kısa, sıcak ve profesyonel bir takip e-postası taslağı yaz. Resmî 'siz' dilini kullan. İlk satır 'Konu: ' ile başlasın. Teşekkür et, kararları ve sorumlusu ile tarihi olan işleri listele, biliniyorsa bir sonraki toplantıyı belirt. Malzemede olmayan bilgi uydurma; yalnızca selamlama için [ad] kullan.",
    ].join("\n\n"),
    messages: [{ role: "user", content: asMaterial("meeting", { title: m.title, date: m.startsAt.toISOString().slice(0, 10) }, body) }],
  });
  const draft = text.trim();
  await updateMeeting(meetingId, { followupEmail: draft }, "ai");
  return draft;
}
