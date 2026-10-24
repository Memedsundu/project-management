import "server-only";
import { todayStr } from "@/lib/dates";
import { checkForChildData } from "@/server/files/child-guard";
import { indicatorFactsText } from "@/server/services/indicators";
import { listLinks } from "@/server/services/links";
import { decorateActivities, listActivities, openTaskCounts } from "@/server/services/workplan";
import { AiError, aiText, asMaterial } from "./client";
import { loadEntityText } from "./context";
import { projectMemoryText } from "./memory";

const LINKED_MAX = 5;
const LINKED_TEXT_MAX = 3_000;

/**
 * "Neden geride?": the short variance explanation a donor report gives when an
 * indicator is behind target, drafted only from what the workspace records.
 * She copies it or keeps it as a note; nothing is saved by itself.
 */
export async function explainShortfall(indicatorId: string, locale: "tr" | "en" = "tr") {
  const facts = await indicatorFactsText(indicatorId);
  if (!facts) throw new AiError("failed", "Indicator not found.");
  const today = todayStr();
  const [all, counts, links] = await Promise.all([listActivities(), openTaskCounts(), listLinks({ type: "indicator", id: indicatorId })]);
  const activities = facts.nodeId ? decorateActivities(all.filter((a) => a.logframeNodeId === facts.nodeId), counts, today) : [];
  const parts = [asMaterial("source", { title: `Indicator ${facts.title}`, type: "indicator", id: indicatorId }, facts.text)];
  if (activities.length) {
    const lines = activities.map(
      (a) => `- ${a.code} ${a.title}: ${a.startDate ?? "?"} to ${a.endDate ?? "?"}, ${a.status}, ${a.progress}%${a.late ? ", late" : ""}${a.atRisk ? ", at risk" : ""}${a.description ? `. ${a.description.slice(0, 300)}` : ""}`,
    );
    parts.push(asMaterial("source", { title: "Workplan activities under the same output" }, lines.join("\n")));
  }
  for (const l of links.filter((x) => ["meeting", "note", "document", "organisation", "decision"].includes(x.type)).slice(0, LINKED_MAX)) {
    const t = await loadEntityText({ type: l.type, id: l.id }, { max: LINKED_TEXT_MAX });
    if (!t || t.aiOff || !t.text.trim() || checkForChildData({ text: t.text }).flag) continue;
    parts.push(asMaterial(l.type === "meeting" ? "meeting" : l.type === "note" ? "note" : "document", { title: t.title, type: l.type, id: l.id, date: t.date ?? null }, t.text));
  }
  const language = locale === "en" ? "British English" : "Turkish";
  const { text } = await aiText({
    helper: "varianceNote",
    effort: "medium",
    maxTokens: 1200,
    entity: { type: "indicator", id: indicatorId },
    system: [
      await projectMemoryText({ glossary: true, max: 2000 }),
      `Draft the short explanation a donor report gives when an indicator is behind its target, in ${language}.
- Three to five sentences of plain prose, no headings or bullets.
- First the gap in numbers: what was reached against the target so far.
- Then the reasons, only as the material states them (late activities, partner notes, meeting decisions, seasonal work). Name the source in brackets, for example (KÇD Q3 raporu, s. 4).
- Then what is being done to catch up, only if the material says so.
- If the material gives no reason, say the reason is not recorded yet and name the one question to ask the responsible partner.
- Never invent numbers, reasons or plans. Totals only; never mention an individual child.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [{ role: "user", content: `${parts.join("\n\n")}\n\nToday is ${today}. Write the explanation for ${facts.title}.` }],
  });
  return { text };
}
