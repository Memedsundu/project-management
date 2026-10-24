"use server";

import { z } from "zod";
import { markdownToBlocks, type Block } from "@/lib/blocks";
import { istanbulInstant } from "@/lib/dates";
import { cleanTranscript } from "@/lib/transcript";
import { act, UserError } from "@/server/action";
import { logActivity } from "@/server/services/activity";
import {
  addDecision,
  createMeeting,
  createNextInSeries,
  createSeries,
  getMeeting,
  MEETING_KINDS,
  updateDecision,
  updateMeeting,
  updateSeries,
  type MeetingPatch,
} from "@/server/services/meetings";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);

const newMeetingSchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: z.enum(MEETING_KINDS).optional(),
  day,
  time,
  durationMin: z.number().int().min(5).max(12 * 60).default(60),
  location: z.string().max(300).nullish(),
  onlineUrl: z.string().max(500).nullish(),
  orgIds: z.array(uuid).max(20).optional(),
  templateId: z.string().max(80).nullish(),
  repeat: z.object({ rule: z.string().max(200), label: z.string().max(200) }).nullish(),
  seriesId: uuid.nullish(),
  links: z.array(z.object({ type: z.string(), id: uuid })).max(10).optional(),
});

/** "Yeni toplantı": a single meeting, or the first of a series (Fellow's recurring meetings). */
export async function createMeetingAction(input: z.input<typeof newMeetingSchema>) {
  return act(async () => {
    const p = newMeetingSchema.parse(input);
    const startsAt = istanbulInstant(p.day, p.time);
    let agenda: { text: string }[] | undefined;
    if (p.templateId) {
      const { getTemplateItem } = await import("@/server/services/templates");
      const tpl = await getTemplateItem(p.templateId);
      agenda = (tpl?.content.agenda ?? []).map((text) => ({ text }));
    }
    let seriesId = p.seriesId ?? null;
    if (!seriesId && p.repeat) {
      const series = await createSeries({
        title: p.title,
        recurrence: p.repeat.rule,
        recurrenceLabel: p.repeat.label,
        organisationId: p.orgIds?.length === 1 ? p.orgIds[0] : null,
        templateId: p.templateId && !p.templateId.startsWith("builtin:") ? p.templateId : null,
      });
      seriesId = series.id;
    }
    const m = await createMeeting({
      title: p.title,
      kind: p.kind,
      startsAt,
      endsAt: new Date(startsAt.getTime() + p.durationMin * 60_000),
      location: p.location ?? null,
      onlineUrl: p.onlineUrl ?? null,
      orgIds: p.orgIds,
      seriesId,
      agenda,
      links: p.links,
    });
    return { id: m.id };
  });
}

const detailsSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  kind: z.enum(MEETING_KINDS).optional(),
  day: day.optional(),
  time: time.optional(),
  durationMin: z.number().int().min(5).max(12 * 60).optional(),
  location: z.string().max(300).nullish(),
  onlineUrl: z.string().max(500).nullish(),
  orgIds: z.array(uuid).max(20).optional(),
  contactIds: z.array(uuid).max(60).optional(),
  status: z.enum(["planned", "done", "canceled"]).optional(),
  aiOff: z.boolean().optional(),
  followupEmail: z.string().max(40_000).nullish(),
});

export async function updateMeetingAction(id: string, input: z.input<typeof detailsSchema>) {
  return act(async () => {
    const meetingId = uuid.parse(id);
    const p = detailsSchema.parse(input);
    const patch: MeetingPatch = {};
    if (p.title !== undefined) patch.title = p.title;
    if (p.kind !== undefined) patch.kind = p.kind;
    if (p.location !== undefined) patch.location = p.location;
    if (p.onlineUrl !== undefined) patch.onlineUrl = p.onlineUrl;
    if (p.orgIds !== undefined) patch.orgIds = p.orgIds;
    if (p.contactIds !== undefined) patch.contactIds = p.contactIds;
    if (p.status !== undefined) patch.status = p.status;
    if (p.aiOff !== undefined) patch.aiOff = p.aiOff;
    if (p.followupEmail !== undefined) patch.followupEmail = p.followupEmail;
    if (p.day || p.time || p.durationMin) {
      const m = await getMeeting(meetingId);
      if (!m) throw new UserError("Toplantı bulunamadı.");
      const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", ...o }).format(d);
      const curDay = fmt(m.startsAt, { year: "numeric", month: "2-digit", day: "2-digit" });
      const curTime = fmt(m.startsAt, { hour: "2-digit", minute: "2-digit", hour12: false });
      const startsAt = istanbulInstant(p.day ?? curDay, p.time ?? curTime);
      const duration = p.durationMin ?? Math.max(5, Math.round(((m.endsAt?.getTime() ?? m.startsAt.getTime() + 3_600_000) - m.startsAt.getTime()) / 60_000));
      patch.startsAt = startsAt;
      patch.endsAt = new Date(startsAt.getTime() + duration * 60_000);
    }
    await updateMeeting(meetingId, patch);
    return null;
  });
}

/** The notes editor saves as she types; the screen does not reload. */
export async function saveMeetingNotesAction(id: string, content: Block[]) {
  return act(
    async () => {
      const row = await updateMeeting(uuid.parse(id), { notesContent: z.array(z.any()).max(5000).parse(content) });
      return { updatedAt: row?.updatedAt.toISOString() ?? null };
    },
    { refresh: false },
  );
}

const agendaSchema = z.array(z.object({ id: z.string().max(60).optional(), text: z.string().max(500), done: z.boolean().optional(), carriedFrom: z.string().nullish(), notes: z.string().max(4000).optional() })).max(60);

export async function saveAgendaAction(id: string, agenda: z.input<typeof agendaSchema>) {
  return act(
    async () => {
      await updateMeeting(uuid.parse(id), { agenda: agendaSchema.parse(agenda) });
      return null;
    },
    { refresh: false },
  );
}

export async function saveTranscriptAction(id: string, transcript: string | null) {
  return act(async () => {
    const text = z.string().max(600_000).nullable().parse(transcript);
    const clean = text?.trim() ? cleanTranscript(text) : null;
    await updateMeeting(uuid.parse(id), { transcript: clean });
    return { chars: clean?.length ?? 0 };
  });
}

/** A transcript file from Teams or Zoom (.vtt, .srt, .txt or .docx). Only its text is kept. */
export async function uploadTranscriptAction(id: string, form: FormData) {
  return act(async () => {
    const meetingId = uuid.parse(id);
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Dosya bulunamadı.");
    if (file.size > 8 * 1024 * 1024) throw new UserError("Döküm dosyası en fazla 8 MB olabilir.");
    const name = file.name.toLowerCase();
    let text: string;
    if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })).value;
    } else if (/\.(vtt|srt|txt|md)$/.test(name) || file.type.startsWith("text/")) {
      text = await file.text();
    } else {
      throw new UserError("Döküm için .vtt, .srt, .txt ya da .docx dosyası seç.");
    }
    const clean = cleanTranscript(text).slice(0, 600_000);
    if (!clean.trim()) throw new UserError("Dosyada okunacak metin yok.");
    await updateMeeting(meetingId, { transcript: clean });
    return { chars: clean.length };
  });
}

export async function addDecisionAction(input: { meetingId?: string | null; text: string; organisationId?: string | null; decidedOn?: string | null }) {
  return act(async () => {
    const p = z.object({ meetingId: uuid.nullish(), text: z.string().trim().min(1).max(2000), organisationId: uuid.nullish(), decidedOn: day.nullish() }).parse(input);
    const row = await addDecision({ meetingId: p.meetingId ?? null, text: p.text, organisationId: p.organisationId ?? null, decidedOn: p.decidedOn ?? undefined });
    return { id: row.id };
  });
}

export async function updateDecisionAction(id: string, patch: { text?: string; organisationId?: string | null; decidedOn?: string }) {
  return act(async () => {
    const p = z.object({ text: z.string().trim().min(1).max(2000).optional(), organisationId: uuid.nullish(), decidedOn: day.optional() }).parse(patch);
    await updateDecision(uuid.parse(id), p);
    return null;
  });
}

/** "Sonraki toplantıyı oluştur": next date from the series rule, open agenda items carried over. */
export async function createNextInSeriesAction(seriesId: string) {
  return act(async () => {
    const m = await createNextInSeries(uuid.parse(seriesId));
    if (!m) throw new UserError("Seri bulunamadı.");
    return { id: m.id };
  });
}

/** Turn a single meeting into the first of a series. */
export async function makeSeriesAction(meetingId: string, repeat: { rule: string; label: string }) {
  return act(async () => {
    const id = uuid.parse(meetingId);
    const r = z.object({ rule: z.string().min(5).max(200), label: z.string().max(200) }).parse(repeat);
    const m = await getMeeting(id);
    if (!m) throw new UserError("Toplantı bulunamadı.");
    if (m.seriesId) return { seriesId: m.seriesId };
    const s = await createSeries({ title: m.title, recurrence: r.rule, recurrenceLabel: r.label, organisationId: m.orgIds.length === 1 ? m.orgIds[0] : null });
    await updateMeeting(id, { seriesId: s.id });
    return { seriesId: s.id };
  });
}

export async function updateSeriesAction(id: string, patch: { title?: string; recurrence?: string | null; recurrenceLabel?: string | null }) {
  return act(async () => {
    const p = z
      .object({ title: z.string().trim().min(1).max(300).optional(), recurrence: z.string().max(200).nullish(), recurrenceLabel: z.string().max(200).nullish() })
      .parse(patch);
    const row = await updateSeries(uuid.parse(id), p);
    if (!row) throw new UserError("Seri bulunamadı.");
    return null;
  });
}

/* --------------------------------- AI --------------------------------- */

export async function prepBriefAction(id: string, language: "tr" | "en") {
  return act(async () => {
    const meetingId = uuid.parse(id);
    const { prepFacts, prepFactsText } = await import("@/server/views/meeting-page");
    const { writePrepBrief } = await import("@/server/ai/meetings");
    const { listOrganisationsLite } = await import("@/server/services/partners-lite");
    const m = await getMeeting(meetingId);
    if (!m) throw new UserError("Toplantı bulunamadı.");
    const [facts, orgs] = await Promise.all([prepFacts(meetingId), listOrganisationsLite()]);
    const names = orgs.filter((o) => m.orgIds.includes(o.id)).map((o) => o.shortName || o.name);
    const agenda = (m.agenda ?? []).map((a) => `- ${a.text}`).join("\n");
    const text = `${prepFactsText(facts, names)}${agenda ? `\n\nAgenda so far:\n${agenda}` : ""}`;
    return { text: await writePrepBrief(meetingId, text, z.enum(["tr", "en"]).parse(language)) };
  });
}

export async function recapAction(id: string, language: "tr" | "en") {
  return act(async () => {
    const { recapMeeting } = await import("@/server/ai/meetings");
    const row = await recapMeeting(uuid.parse(id), z.enum(["tr", "en"]).parse(language));
    return { suggestionId: row.id };
  });
}

export async function mergeTranscriptAction(id: string, notesMarkdown: string) {
  return act(
    async () => {
      const { mergeTranscript } = await import("@/server/ai/meetings");
      return { markdown: await mergeTranscript(uuid.parse(id), z.string().max(200_000).parse(notesMarkdown)) };
    },
    { write: false },
  );
}

/** She approved the merged notes: they replace the old ones, which stay in the history for undo. */
export async function applyMergedNotesAction(id: string, markdown: string) {
  return act(async () => {
    const meetingId = uuid.parse(id);
    const m = await getMeeting(meetingId);
    if (!m) throw new UserError("Toplantı bulunamadı.");
    const previous = (m.notesContent as Block[]) ?? [];
    const blocks = markdownToBlocks(z.string().max(200_000).parse(markdown));
    await updateMeeting(meetingId, { notesContent: blocks });
    await logActivity({ action: "merge_transcript", entityType: "meeting", entityId: meetingId, title: m.title, data: { previous } });
    return { previous, content: blocks };
  });
}

export async function restoreNotesAction(id: string, content: Block[]) {
  return act(async () => {
    await updateMeeting(uuid.parse(id), { notesContent: z.array(z.any()).max(5000).parse(content) });
    return null;
  });
}

export async function followupEmailAction(id: string, language: "tr" | "en") {
  return act(async () => {
    const { draftFollowupEmail } = await import("@/server/ai/meetings");
    return { text: await draftFollowupEmail(uuid.parse(id), z.enum(["tr", "en"]).parse(language)) };
  });
}
