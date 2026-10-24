import "server-only";
import { z } from "zod";
import { formatLongDay, todayStr } from "@/lib/dates";
import { listOrganisationsLite } from "@/server/services/partners-lite";
import { aiJson } from "./client";

const ParsedSchema = z.object({
  title: z.string().describe("The task title without the date, time, priority and tag words."),
  dueDate: z.string().nullable().describe("Deadline as YYYY-MM-DD, or null."),
  startDate: z.string().nullable().describe("Day she plans to start, as YYYY-MM-DD, or null."),
  dueTime: z.string().nullable().describe("Time as HH:mm (24h), or null."),
  priority: z.number().int().nullable().describe("1 (highest) to 4, or null."),
  tags: z.array(z.string()),
  partnerId: z.string().nullable().describe("Id of the partner the task is about, from the list, or null."),
  ownerPartnerId: z.string().nullable().describe("Id of the partner who must do the task (she waits on them), or null."),
  ownerName: z.string().nullable().describe("Name of another person who must do it, or null."),
  recurrence: z.string().nullable().describe("An iCalendar RRULE body such as FREQ=MONTHLY;BYMONTHDAY=5, or null."),
  estimateMin: z.number().int().nullable(),
});

/** For phrases the local rules miss ("bayramdan sonraki ilk iş günü"). */
export async function aiParseTask(text: string) {
  const today = todayStr();
  const partners = await listOrganisationsLite();
  const list = partners.map((p) => `- ${p.id}: ${p.name}${p.shortName ? ` (${p.shortName})` : ""}`).join("\n");
  const out = await aiJson({
    helper: "parseDate",
    effort: "low",
    maxTokens: 3000,
    schema: ParsedSchema,
    system: `Turn one quick-add line into a task. Today is ${today} (${formatLongDay(today, "en")}), time zone Europe/Istanbul. Turkish public and religious holidays matter. A plain date is the deadline; words like "başla" or "start" mark the start day. Partners:\n${list || "(none)"}`,
    messages: [{ role: "user", content: text }],
  });
  const ids = new Set(partners.map((p) => p.id));
  return {
    ...out,
    partnerId: out.partnerId && ids.has(out.partnerId) ? out.partnerId : null,
    ownerPartnerId: out.ownerPartnerId && ids.has(out.ownerPartnerId) ? out.ownerPartnerId : null,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(out.dueDate ?? "") ? out.dueDate : null,
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(out.startDate ?? "") ? out.startDate : null,
    dueTime: /^\d{2}:\d{2}$/.test(out.dueTime ?? "") ? out.dueTime : null,
    priority: out.priority && out.priority >= 1 && out.priority <= 4 ? out.priority : null,
  };
}
