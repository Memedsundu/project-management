import "server-only";
import { UserError } from "@/server/action";
import { checkForChildData } from "@/server/files/child-guard";
import { listDecisions } from "@/server/services/meetings";
import { getOrganisation, meetingsWith, partnerReportDocs, reportSlots } from "@/server/services/partners";
import { tasksLinkedTo } from "@/server/services/tasks";
import { todayStr } from "@/lib/dates";
import { aiText, asMaterial } from "./client";
import { projectMemoryText } from "./memory";

/** "Ortak brifi": five lines before a call: what is late, what was decided, what is open. */
export async function writePartnerBrief(orgId: string, language: "tr" | "en") {
  const org = await getOrganisation(orgId);
  if (!org) throw new UserError("Kurum bulunamadı.");
  const today = todayStr();
  const [open, meetings, decs, docs] = await Promise.all([
    tasksLinkedTo({ type: "organisation", id: orgId }, { open: true }),
    meetingsWith(orgId, { limit: 4 }),
    listDecisions({ orgId, limit: 10 }),
    partnerReportDocs([orgId]),
  ]);
  const slots = reportSlots(org, docs, today, { aheadDays: 60 });
  const lines = [
    `Organisation: ${org.name}${org.shortName ? ` (${org.shortName})` : ""}, kind ${org.kind}${org.provinces.length ? `, provinces ${org.provinces.join(", ")}` : ""}.`,
    org.statusLine ? `Her status line: ${org.statusLine}` : "",
    org.agreementEnd ? `Agreement ends ${org.agreementEnd}.` : "",
    `Reports: ${slots.map((s) => `${s.label} due ${s.due}: ${s.status}${s.daysLate ? ` (${s.daysLate} days late)` : ""}`).join("; ") || "no reporting rhythm"}`,
    `Owed by them: ${open.filter((t) => t.ownerKind !== "me").map((t) => `${t.title}${t.dueDate ? ` (due ${t.dueDate}${t.overdue ? ", OVERDUE" : ""})` : ""}`).join("; ") || "nothing"}`,
    `Her open tasks with them: ${open.filter((t) => t.ownerKind === "me").map((t) => `${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`).join("; ") || "none"}`,
    `Meetings: ${meetings.map((m) => `${m.startsAt.toISOString().slice(0, 10)} ${m.title} (${m.status})`).join("; ") || "none"}`,
    `Recent decisions: ${decs.map((d) => `${d.decidedOn}: ${d.text}`).join("; ") || "none"}`,
  ].filter(Boolean);
  const facts = lines.join("\n");
  if (checkForChildData({ text: facts }).flag) throw new UserError("Bu kayıtlarda bir çocuğa ait kişisel bilgi olabilir; yapay zekâya gönderilmedi.");
  const memory = await projectMemoryText({ glossary: true, max: 2000 });
  const { text } = await aiText({
    helper: "partnerBrief",
    effort: "low",
    thinking: "light",
    maxTokens: 1000,
    entity: { type: "organisation", id: orgId },
    system: [
      memory,
      `Today is ${today}. Write her brief on this partner in ${language === "en" ? "English" : "Turkish"}: at most five short Markdown bullet lines ("- "). Lead with what is late or owed, then the decisions that still matter, then what to ask on the next call. Use only the facts given; say plainly when nothing is late. No preface.`,
    ].join("\n\n"),
    messages: [{ role: "user", content: asMaterial("source", { title: `Partner record: ${org.name}` }, facts) }],
  });
  return text.trim();
}
