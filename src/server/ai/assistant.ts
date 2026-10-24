import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import { addDaysStr, formatLongDay, formatTime, dayOf, istanbulInstant, todayStr } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { aiSuggestions, assistantConversations } from "@/server/db/schema";
import { ENTITIES, isEntityType, resolveEntity, type EntityRef, type EntityType } from "@/server/entities";
import { checkForChildData } from "@/server/files/child-guard";
import { embedQuery } from "@/server/search/embeddings";
import { hybridSearch } from "@/server/search/hybrid";
import { listKeyDates } from "@/server/services/documents";
import { listMeetings } from "@/server/services/meetings";
import { listOrganisationsLite, type OrgLite } from "@/server/services/partners-lite";
import { listPartnerCards } from "@/server/services/partners";
import { createSuggestion, type ProposedTask, type SuggestionKind } from "@/server/services/suggestions";
import { listFiltered, listUpcoming } from "@/server/services/tasks";
import { aiDigest, latePartnerReports } from "@/server/services/today";
import { toInboxSuggestions } from "@/server/views/files";
import { materialFor } from "./ask";
import { AiError, aiErrorMessage, anthropic, asMaterial, assertAiAllowed, failure, modelFor, recordRun, requestShape, systemBlocks } from "./client";
import { aiOffKeys, loadEntityText } from "./context";
import { projectMemoryText } from "./memory";
import { partnerFactsText } from "./partners";

/**
 * The assistant panel (Notion Agent, Peni's right-hand panel). Claude reads
 * what is on her screen, looks things up with read-only tools, and proposes
 * changes as cards she accepts or rejects. It never changes anything itself.
 */

export type ScreenInfo = { kind: string; id?: string | null; title: string; detail?: string | null; selection?: string | null };
export type AssistantSource = { type: EntityType; id: string; title: string; href: string };

/** One saved turn. Tool calls are not kept: the next question starts from the text. */
export type AssistantTurn = {
  role: "user" | "assistant";
  text: string;
  at: string;
  screen?: { kind: string; id?: string | null; title: string } | null;
  proposals?: string[];
  sources?: AssistantSource[];
  steps?: string[];
  stopped?: boolean;
  error?: string | null;
};

export type AssistantEvent =
  | { type: "start"; conversationId: string; title: string }
  | { type: "status"; label: string }
  | { type: "text"; delta: string }
  | { type: "proposal"; suggestion: InboxSuggestion }
  | { type: "sources"; sources: AssistantSource[] }
  | { type: "done"; conversationId: string }
  | { type: "error"; message: string; code?: string };

const MAX_STEPS = 8;
const HISTORY_TURNS = 12;
const SCREEN_TEXT_MAX = 8_000;
const RECORD_TEXT_MAX = 20_000;
const SOURCE_TEXT_MAX = 1_800;

type Locale = "tr" | "en";

/* --------------------------------- Tools --------------------------------- */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const SEARCH_TYPES = ["task", "note", "meeting", "decision", "document", "organisation", "contact", "series", "activity", "indicator"] as const;
const READ_TYPES = ["note", "meeting", "document", "task", "organisation", "activity", "indicator"] as const;
const ABOUT_TYPES = ["meeting", "organisation", "note", "document", "activity", "indicator"] as const;
const about = z.object({ type: z.enum(ABOUT_TYPES), id: uuid }).nullish();

const INPUTS = {
  search_workspace: z.object({ query: z.string().trim().min(1).max(300), types: z.array(z.enum(SEARCH_TYPES)).max(8).nullish() }),
  read_record: z.object({ type: z.enum(READ_TYPES), id: uuid }),
  list_tasks: z.object({
    owner: z.enum(["me", "others", "any"]).nullish(),
    orgId: uuid.nullish(),
    due: z.enum(["overdue", "today", "week", "month", "none", "any"]).nullish(),
    text: z.string().max(200).nullish(),
  }),
  upcoming: z.object({ days: z.number().int().min(1).max(60).nullish() }),
  list_activities: z.object({
    status: z.enum(["late", "planned", "ongoing", "done", "delayed", "any"]).nullish(),
    startsWithinDays: z.number().int().min(1).max(365).nullish(),
    orgId: uuid.nullish(),
    text: z.string().max(200).nullish(),
  }),
  partner_overview: z.object({ orgId: uuid }),
  list_indicators: z.object({ status: z.enum(["behind", "on_track", "ahead", "no_data", "any"]).nullish(), text: z.string().max(200).nullish() }),
  propose_tasks: z.object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(500).nullish(),
    about,
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(300),
          dueDate: day.nullish(),
          startDate: day.nullish(),
          ownerOrgId: uuid.nullish(),
          ownerName: z.string().max(120).nullish(),
          priority: z.number().int().min(1).max(4).nullish(),
          notes: z.string().max(2000).nullish(),
        }),
      )
      .min(1)
      .max(25),
  }),
  propose_note: z.object({ title: z.string().trim().min(1).max(200), markdown: z.string().trim().min(1).max(40_000), summary: z.string().max(500).nullish(), about }),
  propose_agenda: z.object({ meetingId: uuid, items: z.array(z.string().trim().min(1).max(300)).min(1).max(15), summary: z.string().max(500).nullish() }),
  propose_memory: z
    .object({
      lines: z.array(z.string().trim().min(1).max(400)).max(10).nullish(),
      terms: z.array(z.object({ tr: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200), note: z.string().max(300).nullish() })).max(20).nullish(),
    })
    .refine((v) => (v.lines?.length ?? 0) + (v.terms?.length ?? 0) > 0, "Give at least one line or term."),
} as const;

type ToolName = keyof typeof INPUTS;
const PROPOSE: ToolName[] = ["propose_tasks", "propose_note", "propose_agenda", "propose_memory"];

const str = (description: string) => ({ type: "string", description });
const aboutSchema = {
  type: "object",
  description: "The record this comes from or belongs to, if any (a meeting, partner, note, file, workplan activity or indicator). Defaults to the record on her screen.",
  properties: { type: { type: "string", enum: [...ABOUT_TYPES] }, id: str("Record id.") },
  required: ["type", "id"],
};

function toolDefs(readOnly: boolean): Anthropic.Tool[] {
  // Inputs stream as they are written; every input is checked against its schema before it runs.
  const eager = process.env.ANTHROPIC_API_URL ? {} : { eager_input_streaming: true };
  const read: Anthropic.Tool[] = [
    {
      name: "search_workspace",
      description:
        "Search her whole workspace by keyword and meaning: tasks, note pages, meetings, decisions, files (the words inside them, with pages), partners, contacts, workplan activities and indicators. Returns the best matches with short passages, each with its type, id and href. Use a few specific words; Turkish or English both work. Search again with other words if the first try finds nothing.",
      input_schema: {
        type: "object",
        properties: {
          query: str("What to look for."),
          types: { type: "array", items: { type: "string", enum: [...SEARCH_TYPES] }, description: "Only these kinds of records. Leave out to search everything." },
        },
        required: ["query"],
      },
      ...eager,
    },
    {
      name: "read_record",
      description:
        "Read one record in full: a note page, a meeting (agenda, notes, decisions, transcript), a file (its text with [page n] markers), a task, an organisation, a workplan activity or an indicator (definition, targets per period and every value with its source). Use the type and id from search results, lists or the screen.",
      input_schema: {
        type: "object",
        properties: { type: { type: "string", enum: [...READ_TYPES] }, id: str("Record id.") },
        required: ["type", "id"],
      },
      ...eager,
    },
    {
      name: "list_tasks",
      description:
        "List open tasks. owner: 'me' for her own tasks (default), 'others' for what partners or colleagues owe her, 'any' for both. due: overdue, today, week (this week), month, none (no date) or any (default). orgId limits the list to one organisation. text keeps tasks whose title has these words.",
      input_schema: {
        type: "object",
        properties: {
          owner: { type: "string", enum: ["me", "others", "any"] },
          orgId: str("Organisation id from the organisation list."),
          due: { type: "string", enum: ["overdue", "today", "week", "month", "none", "any"] },
          text: str("Words in the task title."),
        },
      },
      ...eager,
    },
    {
      name: "upcoming",
      description:
        "What is coming up in the next days (14 by default): meetings with their ids, tasks due or starting, partner report deadlines, deadlines found in files, and partner reports that are already late.",
      input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 60 } } },
      ...eager,
    },
    {
      name: "list_activities",
      description:
        "The workplan: activities with code, dates, status, progress, partners, what each waits for, and open task counts. status: late (late or at risk), planned, ongoing, done, delayed or any (default). startsWithinDays keeps those starting in the next N days. orgId keeps one partner's activities. text keeps activities whose code or title has these words. Also lists the harvest seasons she drew.",
      input_schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["late", "planned", "ongoing", "done", "delayed", "any"] },
          startsWithinDays: { type: "integer", minimum: 1, maximum: 365 },
          orgId: str("Organisation id from the organisation list."),
          text: str("Words in the activity code or title."),
        },
      },
      ...eager,
    },
    {
      name: "list_indicators",
      description:
        "The IPTT: every indicator with its code, unit, baseline, life-of-project target, the total so far against the target so far, status (behind is under 90%), the latest period's numbers, the responsible partner and values waiting for approval. status keeps one status; text keeps indicators whose code or name has these words. Use read_record with type indicator for one indicator's values and sources.",
      input_schema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["behind", "on_track", "ahead", "no_data", "any"] },
          text: str("Words in the indicator code or name."),
        },
      },
      ...eager,
    },
    {
      name: "partner_overview",
      description:
        "Everything open with one organisation: reports due or late, what they owe her, her tasks with them, recent and next meetings (with ids) and recent decisions.",
      input_schema: { type: "object", properties: { orgId: str("Organisation id from the organisation list.") }, required: ["orgId"] },
      ...eager,
    },
  ];
  if (readOnly) return read;
  const propose: Anthropic.Tool[] = [
    {
      name: "propose_tasks",
      description:
        "Propose new tasks. Nothing is created: she sees a card and accepts all, some, an edited version, or none. For a task a partner owes her, set ownerOrgId from the organisation list; for another person set ownerName; leave both empty for her own tasks. Dates are YYYY-MM-DD; leave them empty rather than guess. Priority 1 is the most urgent, 4 is normal.",
      input_schema: {
        type: "object",
        properties: {
          title: str("Short heading for the card, for example 'Tasks from the KÇD call'."),
          summary: str("One line on why, optional."),
          about: aboutSchema,
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 25,
            items: {
              type: "object",
              properties: {
                title: str("Starts with a verb, for example 'Send the Q3 template to KÇD'."),
                dueDate: str("YYYY-MM-DD"),
                startDate: str("YYYY-MM-DD"),
                ownerOrgId: str("Organisation id when a partner owns it."),
                ownerName: str("A person's name when someone else owns it."),
                priority: { type: "integer", minimum: 1, maximum: 4 },
                notes: str("Details, optional."),
              },
              required: ["title"],
            },
          },
        },
        required: ["title", "tasks"],
      },
      ...eager,
    },
    {
      name: "propose_note",
      description:
        "Propose a new note page in Markdown (headings, bullets, '- [ ]' checklists, bold). She can keep it in Notlar or reject it. Use it for drafts, meeting prep sheets and summaries she wants to keep.",
      input_schema: {
        type: "object",
        properties: { title: str("Page title."), markdown: str("The page body in Markdown, without repeating the title."), summary: str("One line on what it is, optional."), about: aboutSchema },
        required: ["title", "markdown"],
      },
      ...eager,
    },
    {
      name: "propose_agenda",
      description: "Propose agenda items for an existing meeting (use its id from the screen, upcoming or search). She picks which ones join the agenda.",
      input_schema: {
        type: "object",
        properties: {
          meetingId: str("Meeting id."),
          items: { type: "array", minItems: 1, maxItems: 15, items: { type: "string" }, description: "Short agenda items." },
          summary: str("One line on why, optional."),
        },
        required: ["meetingId", "items"],
      },
      ...eager,
    },
    {
      name: "propose_memory",
      description:
        "Propose lasting facts for the assistant's memory page (people's roles, acronyms, reporting rules, writing preferences) and glossary terms (Turkish = English) used in every translation. Only for facts she states as lasting or asks you to remember. Never for personal data.",
      input_schema: {
        type: "object",
        properties: {
          lines: { type: "array", maxItems: 10, items: { type: "string" }, description: "Short facts, one per line." },
          terms: {
            type: "array",
            maxItems: 20,
            items: { type: "object", properties: { tr: str("Turkish term."), en: str("English term."), note: str("When to use it, optional.") }, required: ["tr", "en"] },
          },
        },
      },
      ...eager,
    },
  ];
  return [...read, ...propose];
}

/* --------------------------------- Prompt --------------------------------- */

function assistantSystem(memory: string, orgs: OrgLite[], readOnly: boolean) {
  const orgLines = orgs.length
    ? orgs.map((o) => `- ${o.shortName ? `${o.shortName} = ` : ""}${o.name} (${o.kind}, id ${o.id})`).join("\n")
    : "- none yet";
  return `${memory}

Organisations in her workspace (use these ids):
${orgLines}

You are the assistant panel inside her workspace app. She is the project manager; the app holds her tasks, notes, meetings, files, partners, workplan and indicators.
How you work:
- Look things up with the tools instead of guessing. A few targeted calls beat many. Each message starts with a <context> block saying what is on her screen; the screen's record is often attached already.
${
  readOnly
    ? "- The project is archived and the workspace is read-only. You can read and answer, but propose no changes."
    : `- You never change anything yourself. To add tasks, a note page, agenda items or a memory line, call a propose_ tool. Each proposal appears as a card she can accept, edit or reject, and it also waits in Gelen kutusu. Afterwards say in one line what you proposed; do not list the items again.
- Propose when she asks for it, or when it is the plain next step of what she asked ("prepare for Thursday's meeting with KÇD" means agenda items and tasks). Never propose the same thing twice in a conversation.`
}
- When you mention a record, link it in Markdown with the href the tools gave you: [title](/path). Never make up an href.
- Keep answers short and easy to scan: a sentence or two, then bullets when there is a list. Use a heading only in long answers. Do not narrate your tool calls; the panel shows them.
- Reply in the language of her last message (Turkish or English). Write dates as "12 Kasım" or "12 November", times in Istanbul time.
- If a record is kept away from AI or was withheld, say plainly that you cannot read it. Never ask her for personal data about children.`;
}

function kindWord(type: string) {
  return type === "document" ? "file" : type === "organisation" ? "partner record" : type;
}

function materialTag(type: string): "note" | "meeting" | "file" | "source" {
  return type === "note" ? "note" : type === "meeting" ? "meeting" : type === "document" ? "file" : "source";
}

/** What is on her screen, as context for the newest message. */
async function screenContext(screen: ScreenInfo | null | undefined, locale: Locale) {
  const today = todayStr();
  const lines = [`Today is ${formatLongDay(today, "en")}, ${today} (Europe/Istanbul). Her app is in ${locale === "en" ? "English" : "Turkish"}.`];
  const material: string[] = [];
  if (screen) {
    const ref: EntityRef | null = screen.id && isEntityType(screen.kind) ? { type: screen.kind, id: screen.id } : null;
    if (ref?.type === "organisation") {
      const found = await partnerFactsText(ref.id, { ids: true });
      if (found) {
        lines.push(`She is on the partner page of ${found.org.name} (organisation id ${ref.id}, href /partners/${ref.id}). Its record is attached.`);
        if (!checkForChildData({ text: found.facts }).flag) material.push(asMaterial("source", { title: `Partner record: ${found.org.name}` }, found.facts));
      }
    } else if (ref && (READ_TYPES as readonly string[]).includes(ref.type)) {
      const t = await loadEntityText(ref, { max: SCREEN_TEXT_MAX });
      if (t?.aiOff) {
        lines.push(`She is looking at a ${kindWord(ref.type)} marked "Yapay zekâya kapalı" (kept away from AI). You cannot read it; say so if she asks about it.`);
      } else if (t) {
        const href = ENTITIES[ref.type].href(ref.id);
        lines.push(`She is looking at the ${kindWord(ref.type)} "${t.title}" (type ${ref.type}, id ${ref.id}, href ${href}). Its text is attached${t.text.length >= SCREEN_TEXT_MAX ? " (the start only; use read_record for all of it)" : ""}.`);
        if (checkForChildData({ text: t.text }).flag) lines.push("Its text was withheld because it may contain personal data about a child.");
        else material.push(asMaterial(materialTag(ref.type), { title: t.title, type: ref.type, id: ref.id, date: t.date ?? null }, t.text || "(empty)"));
      }
    } else if (ref) {
      lines.push(`She is on the ${screen.kind} page "${screen.title}" (id ${ref.id}).`);
    } else {
      lines.push(`She is on the "${screen.title}" screen (${screen.kind})${screen.detail ? `, showing ${screen.detail}` : ""}.`);
      if (screen.kind === "today") material.push(asMaterial("source", { title: "Her day" }, await aiDigest(today)));
      if (screen.kind === "indicators") {
        const { ipttText } = await import("@/server/services/indicators");
        const text = await ipttText();
        if (text && !checkForChildData({ text }).flag) material.push(asMaterial("source", { title: "The IPTT on her screen" }, text.slice(0, SCREEN_TEXT_MAX)));
      }
      if (screen.kind === "logframe") {
        const { listLogframe } = await import("@/server/services/indicators");
        const out: string[] = [];
        const walk = (n: Awaited<ReturnType<typeof listLogframe>>[number], depth: number) => {
          out.push(`${"  ".repeat(depth)}- ${n.level} ${n.code}: ${n.title} · indicators: ${n.indicators.map((i) => `${i.code} ${i.name}`).join("; ") || "none"} · activities: ${n.activities.map((a) => a.code).join(", ") || "none"}`);
          n.children.forEach((c) => walk(c, depth + 1));
        };
        (await listLogframe()).forEach((n) => walk(n, 0));
        const text = out.join("\n");
        if (text && !checkForChildData({ text }).flag) material.push(asMaterial("source", { title: "The logframe on her screen" }, text.slice(0, SCREEN_TEXT_MAX)));
      }
    }
    if (screen.selection?.trim()) {
      lines.push("She has selected some text on the screen; it is attached as \"Selected text\". Questions like \"this\" usually mean the selection.");
      material.push(asMaterial("source", { title: "Selected text" }, screen.selection.trim().slice(0, 6000)));
    }
  }
  return [`<context>\n${lines.join("\n")}\n</context>`, ...material].join("\n\n");
}

/** Earlier turns as plain text, with what became of each proposal. */
async function historyMessages(turns: AssistantTurn[]): Promise<Anthropic.MessageParam[]> {
  const recent = turns.slice(-HISTORY_TURNS);
  const ids = recent.flatMap((t) => t.proposals ?? []);
  const db = await getDb();
  const rows = ids.length ? await db.select({ id: aiSuggestions.id, title: aiSuggestions.title, status: aiSuggestions.status }).from(aiSuggestions).where(inArray(aiSuggestions.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Anthropic.MessageParam[] = [];
  for (const t of recent) {
    let text = t.text.trim();
    if (t.role === "assistant") {
      const props = (t.proposals ?? []).map((id) => byId.get(id)).filter(Boolean);
      if (props.length) text += `\n\n[Proposals shown: ${props.map((p) => `"${p!.title}" (${p!.status === "pending" ? "still waiting for her" : p!.status})`).join(", ")}]`;
      if (t.stopped) text += "\n\n[She stopped this answer.]";
    }
    if (!text) text = t.role === "assistant" ? "(no answer)" : "(empty)";
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  // The history must start with her and end with the assistant; the new message follows.
  while (out[0]?.role === "assistant") out.shift();
  if (out[out.length - 1]?.role === "user") out.push({ role: "assistant", content: "(no answer)" });
  return out;
}

/* --------------------------------- Running --------------------------------- */

type RunCtx = {
  locale: Locale;
  screenRef: EntityRef | null;
  orgs: OrgLite[];
  sources: Map<string, AssistantSource>;
  proposals: string[];
  emit: (e: AssistantEvent) => void;
};

type ToolOutcome = { content: string; isError?: boolean };

function withheldIfChildData(text: string) {
  return checkForChildData({ text }).flag ? "This result was withheld because it may contain personal data about a child." : text;
}

function statusLabel(name: ToolName, input: Record<string, unknown>, locale: Locale, extra?: string) {
  const tr = locale !== "en";
  switch (name) {
    case "search_workspace":
      return tr ? `Arıyor: “${String(input.query ?? "")}”` : `Searching: “${String(input.query ?? "")}”`;
    case "read_record":
      return tr ? `Okuyor: ${extra ?? "kayıt"}` : `Reading: ${extra ?? "a record"}`;
    case "list_tasks":
      return tr ? "Görevlere bakıyor" : "Checking tasks";
    case "upcoming":
      return tr ? "Yaklaşanlara bakıyor" : "Checking what is coming up";
    case "list_activities":
      return tr ? "İş planına bakıyor" : "Checking the workplan";
    case "partner_overview":
      return tr ? `Ortak kaydına bakıyor: ${extra ?? ""}`.trim() : `Checking the partner record: ${extra ?? ""}`.trim();
    case "list_indicators":
      return tr ? "Göstergelere bakıyor" : "Checking the indicators";
    default:
      return tr ? "Öneri hazırlıyor" : "Preparing a proposal";
  }
}

async function validAbout(a: { type: (typeof ABOUT_TYPES)[number]; id: string } | null | undefined, fallback: EntityRef | null): Promise<EntityRef | null> {
  const ref = a ?? (fallback && (ABOUT_TYPES as readonly string[]).includes(fallback.type) ? fallback : null);
  if (!ref) return null;
  const found = await resolveEntity(ref);
  return found && !found.deleted ? { type: ref.type, id: ref.id } : null;
}

async function propose(ctx: RunCtx, kind: SuggestionKind, title: string, summary: string | null | undefined, payload: unknown, source: EntityRef | null) {
  const row = await createSuggestion({ kind, title, summary: summary ?? null, payload, source });
  const [card] = await toInboxSuggestions([row]);
  ctx.proposals.push(row.id);
  if (card) ctx.emit({ type: "proposal", suggestion: card });
  return row;
}

async function runTool(name: ToolName, raw: unknown, ctx: RunCtx): Promise<ToolOutcome> {
  const parsed = INPUTS[name].safeParse(raw ?? {});
  if (!parsed.success) {
    ctx.emit({ type: "status", label: statusLabel(name, {}, ctx.locale) });
    return { isError: true, content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 6) }) };
  }
  const input = parsed.data as Record<string, unknown>;

  if (name === "search_workspace") {
    const { query, types } = INPUTS.search_workspace.parse(input);
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
    const vec = await embedQuery(query);
    const { hits } = await hybridSearch(query, { filters: types?.length ? { types: [...types] } : undefined, limit: 16, vector: vec, mode: "or" });
    const found = (await materialFor(hits.slice(0, 12).map((h) => ({ type: h.type, id: h.id })), query, vec, { perDoc: 2 })).slice(0, 8);
    if (!found.length) return { content: "Nothing matched. Try other or fewer words, or another language." };
    for (const m of found) ctx.sources.set(`${m.type}:${m.id}`, { type: m.type, id: m.id, title: m.title, href: m.href });
    return {
      content: found
        .map((m) => {
          const body = m.blocks.map((b) => `${b.page ? `[page ${b.page}] ` : ""}${b.text}`).join("\n\n");
          return asMaterial("source", { type: m.type, id: m.id, title: m.title, href: m.href, context: m.context }, body.length > SOURCE_TEXT_MAX ? `${body.slice(0, SOURCE_TEXT_MAX)}…` : body);
        })
        .join("\n\n"),
    };
  }

  if (name === "read_record") {
    const { type, id } = INPUTS.read_record.parse(input);
    const ref = { type, id } as EntityRef;
    const resolved = await resolveEntity(ref);
    const t = await loadEntityText(ref, { max: RECORD_TEXT_MAX });
    if (!t || !resolved || resolved.deleted) {
      ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
      return { isError: true, content: "Not found. It may have been deleted, or the id is wrong." };
    }
    if (t.aiOff) {
      ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
      return { content: `This ${kindWord(type)} is marked "Yapay zekâya kapalı" (kept away from AI). You cannot read it; tell her so.` };
    }
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale, t.title) });
    if (checkForChildData({ text: t.text }).flag) return { content: "Its text was withheld because it may contain personal data about a child." };
    ctx.sources.set(`${type}:${id}`, { type, id, title: t.title, href: resolved.href });
    const text = type === "organisation" ? ((await partnerFactsText(id, { ids: true }))?.facts ?? t.text) : t.text;
    return { content: asMaterial(materialTag(type), { type, id, title: t.title, href: resolved.href, date: t.date ?? null }, withheldIfChildData(text) || "(empty)") };
  }

  if (name === "list_tasks") {
    const f = INPUTS.list_tasks.parse(input);
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
    const owner = f.owner ?? "me";
    const list = await listFiltered({
      ownerKind: owner === "any" ? undefined : owner,
      orgId: f.orgId ?? undefined,
      due: f.due && f.due !== "any" ? f.due : undefined,
      text: f.text || undefined,
      status: "open",
    });
    if (!list.length) return { content: "No open tasks match." };
    const lines = list.slice(0, 40).map((t) => {
      const due = t.dueDate ? `due ${t.dueDate}${t.overdue ? " (OVERDUE)" : ""}` : "no date";
      const who = t.ownerKind === "me" ? "hers" : `owner ${t.ownerLabel ?? "someone else"}`;
      return `- ${t.title} · ${due} · ${who} · p${t.priority} · ${t.status} · href /tasks?open=${t.id}`;
    });
    if (list.length > 40) lines.push(`(and ${list.length - 40} more)`);
    return { content: withheldIfChildData(lines.join("\n")) };
  }

  if (name === "upcoming") {
    const days = INPUTS.upcoming.parse(input).days ?? 14;
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
    const today = todayStr();
    const end = addDaysStr(today, days);
    const [meetings, byDay, cards, late, keyDates] = await Promise.all([
      listMeetings({ from: istanbulInstant(today, "00:00"), to: istanbulInstant(addDaysStr(end, 1), "00:00"), order: "asc", limit: 40 }),
      listUpcoming(days, today),
      listPartnerCards(),
      latePartnerReports(today),
      listKeyDates(today, end),
    ]);
    const hidden = await aiOffKeys([...meetings.map((m) => ({ type: "meeting" as const, id: m.id })), ...keyDates.map((k) => ({ type: "document" as const, id: k.documentId }))]);
    const out: string[] = [`From ${today} to ${end}:`];
    out.push(`Meetings (${meetings.length}):`);
    for (const m of meetings) {
      out.push(
        hidden.has(`meeting:${m.id}`)
          ? `- ${dayOf(m.startsAt)} ${formatTime(m.startsAt)} (a meeting kept away from AI)`
          : `- ${dayOf(m.startsAt)} ${formatTime(m.startsAt)} ${m.title}${m.status !== "planned" ? ` (${m.status})` : ""} · id ${m.id} · href /meetings/${m.id}`,
      );
    }
    const seen = new Set<string>();
    out.push("Tasks due or starting:");
    for (const [d, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const t of list) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(`- ${d}: ${t.title}${t.ownerKind !== "me" ? ` (owed by ${t.ownerLabel ?? "someone else"})` : ""} · href /tasks?open=${t.id}`);
      }
    }
    const reports = cards.filter((c) => c.nextReport && c.nextReport.due <= end);
    if (reports.length) {
      out.push("Partner reports due:");
      for (const c of reports) out.push(`- ${c.nextReport!.due}: ${c.shortName || c.name} ${c.nextReport!.label}`);
    }
    if (late.length) {
      out.push("Partner reports already late:");
      for (const r of late) out.push(`- ${r.orgName} ${r.label}, due ${r.due} (${r.daysLate} days late)`);
    }
    const { activitiesInRange } = await import("@/server/services/workplan");
    const acts = (await activitiesInRange(today, end)).filter((a) => (a.startDate && a.startDate >= today) || (a.endDate && a.endDate <= end));
    if (acts.length) {
      out.push("Workplan activities starting or ending:");
      for (const a of acts) {
        const starts = a.startDate && a.startDate >= today && a.startDate <= end;
        out.push(`- ${starts ? `${a.startDate} starts` : `${a.endDate} ends`}: ${a.code} ${a.title} (${a.status}) · href /workplan?open=${a.id}`);
      }
    }
    const dates = keyDates.filter((k) => !hidden.has(`document:${k.documentId}`));
    if (dates.length) {
      out.push("Deadlines found in files:");
      for (const k of dates) out.push(`- ${k.date}: ${k.label} (${k.title}, href /files/d/${k.documentId})`);
    }
    return { content: withheldIfChildData(out.join("\n")) };
  }

  if (name === "list_activities") {
    const f = INPUTS.list_activities.parse(input);
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
    const { decorateActivities, listActivities, listSeasons, openTaskCounts } = await import("@/server/services/workplan");
    const today = todayStr();
    const [all, counts, seasons] = await Promise.all([listActivities(), openTaskCounts(), listSeasons()]);
    const items = decorateActivities(all, counts, today);
    const code = new Map(items.map((a) => [a.id, a.code]));
    const words = f.text?.trim().toLocaleLowerCase("tr");
    const horizon = f.startsWithinDays ? addDaysStr(today, f.startsWithinDays) : null;
    const list = items.filter((a) => {
      if (f.status === "late" && !(a.late || a.atRisk)) return false;
      if (f.status && f.status !== "late" && f.status !== "any" && a.status !== f.status) return false;
      if (horizon && !(a.startDate && a.startDate >= today && a.startDate <= horizon)) return false;
      if (f.orgId && !a.orgIds.includes(f.orgId)) return false;
      if (words && !`${a.code} ${a.title}`.toLocaleLowerCase("tr").includes(words)) return false;
      return true;
    });
    const orgLabel = (id: string) => ctx.orgs.find((o) => o.id === id)?.shortName || ctx.orgs.find((o) => o.id === id)?.name || "?";
    const lines = list.slice(0, 60).map(
      (a) =>
        `- ${a.code} ${a.title} · ${a.startDate ?? "?"} → ${a.endDate ?? "?"} · ${a.status} ${a.progress}%${a.late ? " · LATE" : ""}${a.atRisk ? " · AT RISK" : ""}${a.orgIds.length ? ` · ${a.orgIds.map(orgLabel).join(", ")}` : ""}${a.provinces.length ? ` · ${a.provinces.join(", ")}` : ""}${a.dependsOn.length ? ` · waits for ${a.dependsOn.map((d) => code.get(d) ?? "?").join(", ")}` : ""} · ${a.openTasks} open tasks · id ${a.id} · href /workplan?open=${a.id}`,
    );
    if (list.length > 60) lines.push(`(and ${list.length - 60} more)`);
    const active = seasons.filter((x) => x.active);
    if (active.length) lines.push("", "Harvest seasons:", ...active.map((x) => `- ${x.name}: ${x.startDay}.${x.startMonth} to ${x.endDay}.${x.endMonth}${x.provinces.length ? ` (${x.provinces.join(", ")})` : ""}`));
    return { content: list.length ? withheldIfChildData(lines.join("\n")) : `No activities match.${active.length ? `\n${lines.join("\n")}` : ""}` };
  }

  if (name === "list_indicators") {
    const f = INPUTS.list_indicators.parse(input);
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
    const { ipttTable } = await import("@/server/services/indicators");
    const today = todayStr();
    const { periods, rows } = await ipttTable({ today });
    const label = new Map(periods.map((p) => [p.id, p.label]));
    const words = f.text?.trim().toLocaleLowerCase("tr");
    const list = rows.filter((r) => (!f.status || f.status === "any" || r.status === f.status) && (!words || `${r.code} ${r.name}`.toLocaleLowerCase("tr").includes(words)));
    if (!list.length) return { content: rows.length ? "No indicators match." : "No indicators are set up yet." };
    const orgName = (id: string | null) => (id ? ctx.orgs.find((o) => o.id === id)?.shortName || ctx.orgs.find((o) => o.id === id)?.name || "?" : null);
    const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
    const lines = list.slice(0, 60).map((r) => {
      const last = [...r.cells].reverse().find((c) => c.actual !== null);
      return `- ${r.code} ${r.name} [${r.unit}${r.cumulative ? ", cumulative" : ", latest value"}] · baseline ${r.baseline ?? "-"} · LoP target ${r.lopTarget ?? "-"} · to date ${r.toDateActual ?? "-"} of ${r.toDateTarget ?? "-"} (${pct(r.percentToDate)}, ${r.status.replace("_", " ")})${last ? ` · last reported ${label.get(last.periodId)}: ${last.actual} of ${last.target ?? "-"}` : ""}${orgName(r.responsibleOrgId) ? ` · ${orgName(r.responsibleOrgId)}` : ""}${r.proposedCount ? ` · ${r.proposedCount} values waiting for approval` : ""} · id ${r.id} · href /indicators/${r.id}`;
    });
    if (list.length > 60) lines.push(`(and ${list.length - 60} more)`);
    return { content: withheldIfChildData(lines.join("\n")) };
  }

  if (name === "partner_overview") {
    const { orgId } = INPUTS.partner_overview.parse(input);
    const org = ctx.orgs.find((o) => o.id === orgId);
    ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale, org?.shortName || org?.name) });
    const found = await partnerFactsText(orgId, { ids: true });
    if (!found) return { isError: true, content: "No organisation with this id. Use an id from the organisation list." };
    ctx.sources.set(`organisation:${orgId}`, { type: "organisation", id: orgId, title: found.org.shortName || found.org.name, href: `/partners/${orgId}` });
    return { content: asMaterial("source", { title: `Partner record: ${found.org.name}`, href: `/partners/${orgId}` }, withheldIfChildData(found.facts)) };
  }

  // Proposals.
  ctx.emit({ type: "status", label: statusLabel(name, input, ctx.locale) });
  if (name === "propose_tasks") {
    const p = INPUTS.propose_tasks.parse(input);
    const orgIds = new Set(ctx.orgs.map((o) => o.id));
    const tasks: ProposedTask[] = p.tasks.map((t) => {
      const org = t.ownerOrgId && orgIds.has(t.ownerOrgId) ? t.ownerOrgId : null;
      return {
        title: t.title,
        dueDate: t.dueDate ?? null,
        startDate: t.startDate ?? null,
        ownerOrgId: org,
        ownerName: org ? null : (t.ownerName?.trim() || null),
        priority: t.priority ?? null,
        notes: t.notes?.trim() || null,
      };
    });
    if (checkForChildData({ text: tasks.map((t) => `${t.title}\n${t.notes ?? ""}`).join("\n") }).flag) {
      return { isError: true, content: "Not proposed: the tasks may contain personal data about a child. Leave such details out." };
    }
    const source = await validAbout(p.about, ctx.screenRef);
    await propose(ctx, "tasks", p.title, p.summary, { tasks }, source);
    return { content: `A card with ${tasks.length} proposed task${tasks.length === 1 ? "" : "s"} is now in front of her. She decides; do not list them again.` };
  }
  if (name === "propose_note") {
    const p = INPUTS.propose_note.parse(input);
    if (checkForChildData({ text: p.markdown }).flag) return { isError: true, content: "Not proposed: the page may contain personal data about a child. Leave such details out." };
    const source = await validAbout(p.about, ctx.screenRef);
    await propose(ctx, "note", p.title, p.summary, { title: p.title, markdown: p.markdown }, source);
    return { content: `The page "${p.title}" is proposed as a card. She can keep it in Notlar or reject it; do not repeat its text.` };
  }
  if (name === "propose_agenda") {
    const p = INPUTS.propose_agenda.parse(input);
    const meeting = await resolveEntity({ type: "meeting", id: p.meetingId });
    if (!meeting || meeting.deleted) return { isError: true, content: "No meeting with this id. Find it with upcoming or search_workspace first." };
    const keys = await aiOffKeys([{ type: "meeting", id: p.meetingId }]);
    if (keys.size) return { isError: true, content: "This meeting is kept away from AI; you cannot add to it." };
    await propose(ctx, "agenda", ctx.locale === "en" ? `Agenda for ${meeting.title}` : `${meeting.title} için gündem`, p.summary, { items: p.items }, { type: "meeting", id: p.meetingId });
    return { content: `${p.items.length} agenda item${p.items.length === 1 ? "" : "s"} for "${meeting.title}" are proposed as a card. Do not list them again.` };
  }
  if (name === "propose_memory") {
    const p = INPUTS.propose_memory.parse(input);
    const lines = p.lines ?? [];
    const terms = (p.terms ?? []).map((t) => ({ tr: t.tr, en: t.en, note: t.note ?? null }));
    if (checkForChildData({ text: [...lines, ...terms.map((t) => `${t.tr} ${t.en}`)].join("\n") }).flag) return { isError: true, content: "Not proposed: it may contain personal data about a child." };
    await propose(ctx, "memory", ctx.locale === "en" ? "Add to the assistant's memory" : "Asistanın hafızasına ekle", null, { lines, terms }, null);
    return { content: "The memory addition is proposed as a card. She decides." };
  }
  return { isError: true, content: "Unknown tool." };
}

/**
 * A cache point on the newest block, so each round of the loop re-reads the
 * earlier rounds from the prompt cache instead of paying for them again.
 */
function withCachePoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return messages;
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  const end = blocks[blocks.length - 1];
  if (!end || (end.type !== "text" && end.type !== "tool_result")) return messages;
  blocks[blocks.length - 1] = { ...end, cache_control: { type: "ephemeral" } };
  return [...messages.slice(0, -1), { ...last, content: blocks }];
}

/* ------------------------------ Conversations ------------------------------ */

function titleFrom(message: string) {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length > 70 ? `${one.slice(0, 67)}…` : one;
}

const CHILD_DATA = {
  tr: "Bu mesajda bir çocuğa ait kişisel bilgi olabilir; Claude'a gönderilmedi. Ad, yaş ya da okul gibi ayrıntıları çıkarıp tekrar dener misin?",
  en: "This message may contain personal data about a child, so it was not sent to Claude. Could you leave out names, ages or schools and try again?",
};

/**
 * One question to the assistant: Claude may call tools up to eight times,
 * streaming its answer as it goes. The turn is saved even when she stops it.
 */
export async function runAssistant(input: {
  conversationId?: string | null;
  message: string;
  screen?: ScreenInfo | null;
  locale: Locale;
  readOnly: boolean;
  signal?: AbortSignal;
  emit: (e: AssistantEvent) => void;
}) {
  const { emit, locale } = input;
  const db = await getDb();
  const message = input.message.trim().slice(0, 8000);
  let conv = input.conversationId
    ? (await db.select().from(assistantConversations).where(eq(assistantConversations.id, input.conversationId)).limit(1))[0]
    : undefined;
  if (!conv) {
    [conv] = await db
      .insert(assistantConversations)
      .values({ title: titleFrom(message), context: input.screen ? { kind: input.screen.kind, id: input.screen.id ?? null, title: input.screen.title } : null, messages: [] })
      .returning();
  }
  const conversation = conv!;
  emit({ type: "start", conversationId: conversation.id, title: conversation.title });

  const turns = (conversation.messages as AssistantTurn[]) ?? [];
  const userTurn: AssistantTurn = {
    role: "user",
    text: message,
    at: new Date().toISOString(),
    screen: input.screen ? { kind: input.screen.kind, id: input.screen.id ?? null, title: input.screen.title } : null,
  };
  const reply: AssistantTurn = { role: "assistant", text: "", at: "", proposals: [], sources: [], steps: [] };
  const sources = new Map<string, AssistantSource>();
  const save = async () => {
    reply.at = new Date().toISOString();
    reply.text = reply.text.trim();
    reply.sources = [...sources.values()].slice(0, 8);
    await db
      .update(assistantConversations)
      .set({ messages: [...turns, userTurn, reply], updatedAt: new Date() })
      .where(eq(assistantConversations.id, conversation.id));
  };

  try {
    if (checkForChildData({ text: `${message}\n${input.screen?.selection ?? ""}` }).flag) {
      reply.error = "child_data";
      reply.text = CHILD_DATA[locale];
      await save();
      emit({ type: "error", message: CHILD_DATA[locale], code: "child_data" });
      return;
    }
    await assertAiAllowed();
    const model = await modelFor("assistant");
    const orgs = await listOrganisationsLite();
    const system = assistantSystem(await projectMemoryText({ glossary: true, max: 4000 }), orgs, input.readOnly);
    const screenRef = input.screen?.id && isEntityType(input.screen.kind) ? { type: input.screen.kind, id: input.screen.id } : null;
    const messages: Anthropic.MessageParam[] = [
      ...(await historyMessages(turns)),
      { role: "user", content: `${await screenContext(input.screen, locale)}\n\n${message}` },
    ];
    const tools = toolDefs(input.readOnly);
    const ctx: RunCtx = { locale, screenRef, orgs, sources, proposals: reply.proposals!, emit };
    let jsonRetries = 0;

    for (let step = 0; step <= MAX_STEPS; step++) {
      if (input.signal?.aborted) {
        reply.stopped = true;
        break;
      }
      if (step > 0) await assertAiAllowed();
      const started = Date.now();
      let newStep = true;
      let msg: Anthropic.Message;
      try {
        const stream = anthropic().messages.stream(
          {
            model,
            max_tokens: 8000,
            system: systemBlocks(system),
            messages: withCachePoint(messages),
            tools,
            // The last round must answer in words.
            ...(step === MAX_STEPS ? { tool_choice: { type: "none" as const } } : {}),
            ...requestShape(model, "medium", "light"),
          },
          { signal: input.signal },
        );
        stream.on("text", (delta) => {
          if (newStep && reply.text && !reply.text.endsWith("\n")) {
            reply.text += "\n\n";
            emit({ type: "text", delta: "\n\n" });
          }
          newStep = false;
          reply.text += delta;
          emit({ type: "text", delta });
        });
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (input.signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
          reply.stopped = true;
          break;
        }
        // A tool input that could not be parsed at all: ask again, at most twice.
        if (!(err instanceof Anthropic.APIError) && !(err instanceof AiError) && jsonRetries++ < 2) continue;
        const e = failure(err);
        await recordRun({ helper: "assistant", model, status: "error", error: e.message, durationMs: Date.now() - started });
        throw e;
      }
      await recordRun({ helper: "assistant", model, usage: msg.usage, durationMs: Date.now() - started });
      if (msg.stop_reason === "refusal") throw new AiError("refused");
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!uses.length) break;
      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        if (msg.stop_reason === "max_tokens") {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "Your input was cut off at the output limit. Make it shorter (fewer items, or a shorter page) and try again." });
          continue;
        }
        if (!(use.name in INPUTS) || (input.readOnly && PROPOSE.includes(use.name as ToolName))) {
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "This tool is not available." });
          continue;
        }
        let outcome: ToolOutcome;
        try {
          outcome = await runTool(use.name as ToolName, use.input, ctx);
        } catch (err) {
          console.error("[assistant tool]", use.name, err);
          outcome = { isError: true, content: "The tool failed. Try another way or tell her you could not look this up." };
        }
        reply.steps!.push(use.name);
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
    await save();
    if (sources.size) emit({ type: "sources", sources: [...sources.values()].slice(0, 8) });
    emit({ type: "done", conversationId: conversation.id });
  } catch (err) {
    const e = failure(err);
    reply.error = e.code;
    await save().catch(() => undefined);
    emit({ type: "error", message: aiErrorMessage(e, locale), code: e.code });
  }
}

/* ------------------------------ Saved chats ------------------------------ */

export type ConversationListItem = { id: string; title: string; updatedAt: string };

export async function listConversations(limit = 30): Promise<ConversationListItem[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: assistantConversations.id, title: assistantConversations.title, updatedAt: assistantConversations.updatedAt })
    .from(assistantConversations)
    .orderBy(desc(assistantConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title || "—", updatedAt: r.updatedAt.toISOString() }));
}

export type ConversationView = {
  id: string;
  title: string;
  turns: AssistantTurn[];
  proposals: Record<string, InboxSuggestion & { status: string }>;
};

export async function getConversation(id: string): Promise<ConversationView | null> {
  const db = await getDb();
  const [c] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id)).limit(1);
  if (!c) return null;
  const turns = (c.messages as AssistantTurn[]) ?? [];
  const ids = turns.flatMap((t) => t.proposals ?? []);
  const rows = ids.length ? await db.select().from(aiSuggestions).where(inArray(aiSuggestions.id, ids)) : [];
  const cards = await toInboxSuggestions(rows);
  const status = new Map(rows.map((r) => [r.id, r.status]));
  return {
    id: c.id,
    title: c.title,
    turns,
    proposals: Object.fromEntries(cards.map((s) => [s.id, { ...s, status: status.get(s.id) ?? "pending" }])),
  };
}

export async function deleteConversation(id: string) {
  const db = await getDb();
  await db.delete(assistantConversations).where(eq(assistantConversations.id, id));
}
