import "server-only";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { addDaysStr, formatDay, formatDayRange, formatLongDay, istanbulInstant, todayStr, weekRange } from "@/lib/dates";
import { UserError } from "@/server/action";
import { getDb } from "@/server/db/client";
import { briefs, decisions, recipes, tasks } from "@/server/db/schema";
import { isEntityType } from "@/server/entities";
import { PermanentJobError } from "@/server/jobs/queue";
import { sendPush } from "@/server/notifications/push";
import { getSetting } from "@/server/services/settings";
import { createSuggestion, listPendingSuggestions, type ProposedTask } from "@/server/services/suggestions";
import { aiJson, aiStatus, aiText, asMaterial } from "./client";
import { loadEntityText } from "./context";
import { projectMemoryText } from "./memory";
import { MODELS } from "./models";

/**
 * Scheduled helpers (Notion Custom Agents): the daily brief at 08:00 on
 * working days, the Friday weekly review, the monthly partner report check,
 * and her saved recipes. Each writes a brief; any change it suggests goes to
 * Gelen kutusu for her approval.
 */

type BriefKind = "daily" | "weekly" | "partner_check" | "recipe";

async function saveBrief(input: { kind: BriefKind; day: string; title: string; content: string; data?: unknown; recipeId?: string | null; model?: string | null }) {
  const db = await getDb();
  if (input.kind !== "recipe") await db.delete(briefs).where(and(eq(briefs.kind, input.kind), eq(briefs.day, input.day)));
  const [row] = await db
    .insert(briefs)
    .values({ kind: input.kind, day: input.day, title: input.title, content: input.content, data: (input.data ?? null) as object | null, recipeId: input.recipeId ?? null, model: input.model ?? null })
    .returning();
  return row!;
}

async function aiUsable() {
  const s = await aiStatus();
  return s.configured && s.enabled && !s.capReached;
}

/* -------------------------------- Daily brief -------------------------------- */

const BriefSchema = z.object({
  lines: z.array(z.string()).describe("Exactly three short lines in Turkish, friendly 'sen' form. Line 1: the shape of the day. Line 2: the most important thing to do. Line 3: something to watch (a late report, a deadline, a waiting item)."),
});

function plainBrief(d: Awaited<ReturnType<typeof import("@/server/services/today").todayData>>) {
  const lines: string[] = [];
  const meet = d.meetings.filter((m) => m.status !== "canceled").length;
  lines.push(`Bugün ${meet ? `${meet} toplantın` : "toplantın yok"}${d.tasks.length ? ` ve ${d.tasks.length} görevin var` : ", görev listen boş"}.`);
  const top = d.tasks.find((t) => t.overdue) ?? d.tasks.find((t) => t.priority === 1) ?? d.tasks[0];
  if (top) lines.push(top.overdue ? `Önce gecikmiş olanı bitir: ${top.title}.` : `Öncelik: ${top.title}.`);
  const late = d.attention.lateReports[0];
  if (late) lines.push(`${late.orgName} ${late.label} raporu ${late.daysLate} gündür gecikmede.`);
  else if (d.keyDates[0]) lines.push(`Yaklaşan tarih: ${d.keyDates[0].label} (${d.keyDates[0].date}).`);
  else if (d.waitingThisWeek[0]) lines.push(`Bu hafta beklediğin: ${d.waitingThisWeek[0].ownerLabel ?? ""} – ${d.waitingThisWeek[0].title}.`);
  if (d.plannedMinutes > d.workMinutes && d.workMinutes > 0) lines.push("Bugün için fazla iş var; birkaç görevi yarına kaydırabilirsin.");
  return lines.slice(0, 3);
}

export async function dailyBriefJob(payload: Record<string, unknown> = {}) {
  const day = typeof payload.day === "string" ? payload.day : todayStr();
  const { todayData, aiDigest } = await import("@/server/services/today");
  const d = await todayData(day);
  let lines = plainBrief(d);
  let model: string | null = null;
  if (await aiUsable()) {
    try {
      const out = await aiJson({
        helper: "dailyBrief",
        effort: "low",
        thinking: "light",
        maxTokens: 800,
        schema: BriefSchema,
        system: `${await projectMemoryText({ glossary: false, max: 2000 })}\n\nWrite her morning brief for ${formatLongDay(day, "tr")}. Use only the facts given. No greetings, no emoji.`,
        messages: [{ role: "user", content: asMaterial("source", { kind: "today" }, await aiDigest(day)) }],
      });
      const clean = out.lines.map((l) => l.trim()).filter(Boolean).slice(0, 3);
      if (clean.length) {
        lines = clean;
        model = MODELS.haiku;
      }
    } catch {
      // Keep the plain brief; the screen still shows the facts.
    }
  }
  const brief = await saveBrief({ kind: "daily", day, title: formatLongDay(day, "tr"), content: lines.join("\n"), data: { lines }, model });
  if (payload.notify !== false && (await getSetting("notifications")).briefReady) {
    await sendPush(`brief:${day}`, (tr) => ({ title: tr("briefTitle"), body: lines[0] ?? "", url: "/today", tag: "brief" }));
  }
  return brief;
}

/* -------------------------------- Weekly review ------------------------------- */

export async function weeklyReviewJob(payload: Record<string, unknown> = {}) {
  const day = typeof payload.day === "string" ? payload.day : todayStr();
  const week = weekRange(day);
  const db = await getDb();
  const { completedBetween, listGrouped, listUpcoming } = await import("@/server/services/tasks");
  const { listMeetings } = await import("@/server/services/meetings");
  const { latePartnerReports } = await import("@/server/services/today");
  const from = istanbulInstant(week.start, "00:00");
  const to = istanbulInstant(addDaysStr(week.end, 1), "00:00");
  const [done, open, meetingsThisWeek, decs, nextMeetings, upcoming, late] = await Promise.all([
    completedBetween(from, to),
    listGrouped({ ownerKind: "me" }, day),
    listMeetings({ from, to, order: "asc" }),
    db.select({ text: decisions.text, decidedOn: decisions.decidedOn }).from(decisions).where(and(isNull(decisions.deletedAt), gte(decisions.decidedOn, week.start), sql`${decisions.decidedOn} <= ${week.end}`)),
    listMeetings({ from: to, to: istanbulInstant(addDaysStr(week.end, 8), "00:00"), order: "asc" }),
    listUpcoming(10, addDaysStr(week.end, 1)),
    latePartnerReports(day),
  ]);
  const slipped = open.today.filter((t) => t.overdue);
  const nextDeadlines = [...upcoming.entries()].flatMap(([d, list]) => list.filter((t) => t.dueDate === d).map((t) => ({ day: d, title: t.title }))).slice(0, 15);
  const facts = [
    `Week ${week.start} to ${week.end}.`,
    `Finished (${done.length}): ${done.slice(0, 30).map((t) => t.title).join("; ") || "none"}`,
    `Slipped, now overdue (${slipped.length}): ${slipped.slice(0, 20).map((t) => `${t.title} (due ${t.dueDate})`).join("; ") || "none"}`,
    `Meetings held: ${meetingsThisWeek.filter((m) => m.status !== "canceled").map((m) => m.title).join("; ") || "none"}`,
    `Decisions: ${decs.map((d) => d.text).join("; ") || "none"}`,
    `Next week meetings: ${nextMeetings.map((m) => `${m.startsAt.toISOString().slice(0, 10)} ${m.title}`).join("; ") || "none"}`,
    `Next week deadlines: ${nextDeadlines.map((t) => `${t.day} ${t.title}`).join("; ") || "none"}`,
    `Late partner reports: ${late.map((r) => `${r.orgName} ${r.label}`).join("; ") || "none"}`,
  ].join("\n");
  let content = [
    "## Bu hafta",
    done.length ? done.slice(0, 20).map((t) => `- ${t.title}`).join("\n") : "- Tamamlanan görev yok.",
    "",
    "## Kayan işler",
    slipped.length ? slipped.slice(0, 15).map((t) => `- ${t.title} (son tarih ${t.dueDate ? formatDay(t.dueDate, "tr") : "yok"})`).join("\n") : "- Kayan iş yok.",
    "",
    "## Gelecek hafta",
    [...nextMeetings.map((m) => `- Toplantı: ${m.title}`), ...nextDeadlines.map((t) => `- ${formatDay(t.day, "tr")}: ${t.title}`)].join("\n") || "- Henüz bir şey planlı değil.",
  ].join("\n");
  let model: string | null = null;
  if (await aiUsable()) {
    try {
      const { text } = await aiText({
        helper: "weeklyReview",
        effort: "low",
        thinking: "light",
        maxTokens: 1500,
        system: `${await projectMemoryText({ glossary: false, max: 2000 })}\n\nWrite her Friday weekly review in Turkish (friendly 'sen' form) as Markdown with these headings: "## Bu hafta", "## Kayan işler", "## Gelecek hafta", "## Önerilen odak". Under "Önerilen odak" give at most three objectives for next week, as Sunsama's weekly objectives. Short bullets, facts only from the material.`,
        messages: [{ role: "user", content: asMaterial("source", { kind: "week" }, facts) }],
      });
      if (text.trim()) {
        content = text.trim();
        model = MODELS.haiku;
      }
    } catch {
      // Plain review stays.
    }
  }
  const brief = await saveBrief({ kind: "weekly", day, title: `Haftalık değerlendirme · ${formatDayRange(week.start, week.end, "tr")}`, content, data: { done: done.length, slipped: slipped.length }, model });
  if (payload.notify !== false && (await getSetting("notifications")).briefReady) {
    await sendPush(`weekly:${day}`, (tr) => ({ title: tr("weeklyTitle"), body: tr("weeklyBody", { done: done.length, slipped: slipped.length }), url: `/briefs/${brief.id}`, tag: "weekly" }));
  }
  return brief;
}

/* --------------------------- Monthly partner report check --------------------------- */

export async function partnerReportCheckJob(payload: Record<string, unknown> = {}) {
  const day = typeof payload.day === "string" ? payload.day : todayStr();
  const { latePartnerReports } = await import("@/server/services/today");
  const late = await latePartnerReports(day);
  const db = await getDb();
  const content = late.length
    ? late.map((r) => `- **${r.orgName}**: ${r.label} raporu ${formatDay(r.due, "tr", true)} tarihinde bekleniyordu (${r.daysLate} gün gecikme).`).join("\n")
    : "Bütün ortak raporları zamanında ya da henüz vakti gelmedi.";
  // Suggest one waiting-on task per late report, unless one is already open or proposed.
  const open = await db
    .select({ title: tasks.title, ownerOrgId: tasks.ownerOrgId })
    .from(tasks)
    .where(and(isNull(tasks.deletedAt), sql`${tasks.status} in ('todo','doing','waiting')`));
  const pending = await listPendingSuggestions({ kinds: ["tasks"] });
  const pendingTitles = new Set(pending.flatMap((p) => ((p.payload as { tasks?: ProposedTask[] }).tasks ?? []).map((t) => t.title)));
  const proposals: ProposedTask[] = [];
  for (const r of late) {
    const title = `${r.orgName} ${r.label} raporu`;
    const exists = open.some((t) => t.ownerOrgId === r.orgId && t.title.includes(r.label)) || pendingTitles.has(title);
    if (!exists) proposals.push({ title, ownerOrgId: r.orgId, dueDate: r.due, priority: 2, notes: `Rapor ${formatDay(r.due, "tr", true)} tarihinde bekleniyordu.` });
  }
  if (proposals.length) {
    await createSuggestion({ kind: "tasks", title: "Geciken ortak raporları için takip", summary: `${proposals.length} ortak raporu gecikmede.`, payload: { tasks: proposals } });
  }
  return saveBrief({ kind: "partner_check", day, title: "Aylık ortak raporu kontrolü", content, data: { late } });
}

/* ---------------------------------- Recipes ---------------------------------- */

export const BUILTIN_RECIPES = [
  {
    builtinKey: "partner_brief",
    name: "Ortak brifi",
    instructions:
      "Prepare a one-page brief about the partner in context, in Turkish: current status, open tasks and what we wait for from them, last meetings and decisions, next report due, and three points to raise at the next call.",
    model: MODELS.haiku,
    schedule: null,
  },
  {
    builtinKey: "weekly_update",
    name: "Haftalık güncelleme",
    instructions:
      "Write a short weekly update email in English for her line manager: three highlights, risks or delays, and support needed. Use only facts from the material. Keep it under 200 words.",
    model: MODELS.haiku,
    schedule: null,
  },
  {
    builtinKey: "meeting_prep",
    name: "Toplantıya hazırla",
    instructions:
      "For the meeting in context: list open items from earlier meetings with the same partner, tasks we wait for from them, decisions to follow up and a draft agenda of at most six items, in Turkish.",
    model: MODELS.haiku,
    schedule: null,
  },
] as const;

export async function ensureBuiltinRecipes() {
  const db = await getDb();
  const existing = await db.select({ key: recipes.builtinKey }).from(recipes);
  const have = new Set(existing.map((r) => r.key));
  const missing = BUILTIN_RECIPES.filter((r) => !have.has(r.builtinKey));
  if (missing.length) await db.insert(recipes).values(missing.map((r) => ({ ...r, schedule: r.schedule as string | null })));
}

export async function listRecipes() {
  await ensureBuiltinRecipes();
  const db = await getDb();
  return db.select().from(recipes).orderBy(asc(recipes.name));
}

export const recipeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(5).max(6000),
  model: z.enum([MODELS.haiku, MODELS.sonnet, MODELS.opus]).default(MODELS.haiku),
  schedule: z.enum(["daily_0800", "friday_1600", "monthly_first_workday"]).nullish(),
  enabled: z.boolean().default(true),
});

export async function saveRecipe(id: string | null, raw: z.input<typeof recipeSchema>) {
  const input = recipeSchema.parse(raw);
  const db = await getDb();
  if (id) {
    const [row] = await db.update(recipes).set({ ...input, schedule: input.schedule ?? null, updatedAt: new Date() }).where(eq(recipes.id, id)).returning();
    return row ?? null;
  }
  const [row] = await db.insert(recipes).values({ ...input, schedule: input.schedule ?? null }).returning();
  return row!;
}

export async function deleteRecipe(id: string) {
  const db = await getDb();
  await db.delete(recipes).where(and(eq(recipes.id, id), isNull(recipes.builtinKey)));
}

/** Run a recipe now. `entity` is the screen it was started from (a partner, a meeting ...). */
export async function runRecipe(recipeId: string, entity?: { type: string; id: string } | null) {
  const db = await getDb();
  const [r] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
  if (!r) throw new PermanentJobError("recipe missing");
  const { aiDigest } = await import("@/server/services/today");
  const parts: string[] = [asMaterial("source", { kind: "today" }, await aiDigest())];
  if (entity && isEntityType(entity.type)) {
    const t = await loadEntityText({ type: entity.type, id: entity.id }, { max: 30_000 });
    if (t && !t.aiOff) parts.push(asMaterial(entity.type === "meeting" ? "meeting" : entity.type === "note" ? "note" : "source", { kind: entity.type, title: t.title }, t.text));
    if (entity.type === "organisation") {
      const { partnerFactsText } = await import("./partners");
      const found = await partnerFactsText(entity.id);
      if (found) parts.push(asMaterial("source", { kind: "partner_context" }, found.facts));
    }
  }
  const { text } = await aiText({
    helper: "recipe",
    model: r.model,
    effort: "medium",
    maxTokens: 3000,
    entity: entity ?? null,
    system: `${await projectMemoryText()}\n\nRecipe "${r.name}". Follow these saved instructions:\n${r.instructions}\nAnswer in Markdown.`,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  await db.update(recipes).set({ lastRunAt: new Date() }).where(eq(recipes.id, r.id));
  return saveBrief({ kind: "recipe", day: todayStr(), title: r.name, content: text, recipeId: r.id, model: r.model, data: entity ? { entity } : null });
}

export async function runRecipeJob(payload: Record<string, unknown>) {
  const recipeId = String(payload.recipeId ?? "");
  if (!(await aiUsable())) throw new PermanentJobError("AI unavailable");
  const entity = payload.entity as { type: string; id: string } | undefined;
  const brief = await runRecipe(recipeId, entity ?? null);
  if ((await getSetting("notifications")).briefReady) {
    await sendPush(`recipe:${brief.id}`, (tr) => ({ title: tr("recipeTitle", { name: brief.title }), body: plainLine(brief.content), url: `/briefs/${brief.id}`, tag: `recipe:${recipeId}` }));
  }
}

const plainLine = (markdown: string) =>
  markdown
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/[*_`>]+/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-•]\s+/, "").trim())
    .find(Boolean)
    ?.slice(0, 160) ?? "";

/** "Şimdi hazırla" on Özetler: a helper's brief for today, written now. */
export async function makeBriefNow(kind: "daily" | "weekly" | "partner_check") {
  const day = todayStr();
  if (kind === "daily") return dailyBriefJob({ day, notify: false });
  if (kind === "weekly") return weeklyReviewJob({ day, notify: false });
  return partnerReportCheckJob({ day });
}

/** "Yeniden hazırla": the same helper again for the same day; a recipe runs again on the same page and replaces its result. */
export async function remakeBrief(id: string) {
  const db = await getDb();
  const [b] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  if (!b) throw new UserError("Özet bulunamadı.");
  if (b.kind === "daily") {
    if (b.day !== todayStr()) throw new UserError("Geçmiş bir günün özeti yeniden yazılamaz.");
    return dailyBriefJob({ day: b.day, notify: false });
  }
  if (b.kind === "weekly") return weeklyReviewJob({ day: b.day, notify: false });
  if (b.kind === "partner_check") return partnerReportCheckJob({ day: b.day });
  const [r] = b.recipeId ? await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, b.recipeId)).limit(1) : [];
  if (!r) throw new UserError("Bu sonucu yazan hazır talimat silinmiş.");
  const entity = (b.data as { entity?: { type: string; id: string } } | null)?.entity ?? null;
  const fresh = await runRecipe(r.id, entity);
  await db.delete(briefs).where(eq(briefs.id, b.id));
  return fresh;
}

/* --------------------------------- Scheduling --------------------------------- */

/** Days the brief and helpers run: her working days, skipping public holidays. */
export async function isWorkday(day: string) {
  const { isWorkingDay } = await import("@/server/services/workplan");
  return isWorkingDay(day);
}

export async function scheduledRecipesDue(slot: "daily_0800" | "friday_1600" | "monthly_first_workday") {
  const db = await getDb();
  const since = istanbulInstant(todayStr(), "00:00");
  return db
    .select({ id: recipes.id })
    .from(recipes)
    .where(and(eq(recipes.enabled, true), eq(recipes.schedule, slot), sql`(${recipes.lastRunAt} is null or ${recipes.lastRunAt} < ${since})`));
}

