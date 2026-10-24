import type { LinkItem } from "@/components/common/links-panel";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import type { TaskState } from "@/components/notes/note-blocks";
import type { Block } from "@/lib/blocks";
import type { PartnerRef } from "@/lib/parse-task";
import type { AgendaItem, MeetingRecap } from "@/server/db/schema/work";

export type { AgendaItem, MeetingRecap };

export type Org = { id: string; name: string; shortName: string | null };
export type Contact = { id: string; name: string; organisationId: string | null; role: string | null };

export type PrepItem = { id: string; title: string; dueDate: string | null; owner: string | null; overdue: boolean };

/** Fellow's prep: what is open with these partners, what was decided last time, what is coming. */
export type PrepFacts = {
  previous: { id: string; title: string; startsAt: string; decisions: { id: string; text: string }[] } | null;
  openActions: PrepItem[];
  waiting: PrepItem[];
  myTasks: PrepItem[];
  late: { label: string; due: string; daysLate: number; orgId: string }[];
  coming: { date: string; label: string; kind: "report" | "file" | "task"; href: string }[];
};

export type MeetingPageData = {
  meeting: {
    id: string;
    title: string;
    kind: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    onlineUrl: string | null;
    status: string;
    aiOff: boolean;
    agenda: AgendaItem[];
    notesContent: Block[];
    transcript: string | null;
    recap: MeetingRecap | null;
    prepBrief: string | null;
    followupEmail: string | null;
    updatedAt: string;
  };
  series: { id: string; title: string; recurrenceLabel: string | null } | null;
  previous: { id: string; title: string; startsAt: string } | null;
  next: { id: string; title: string; startsAt: string } | null;
  orgIds: string[];
  contactIds: string[];
  orgs: Org[];
  contacts: Contact[];
  decisions: { id: string; text: string; decidedOn: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null; owner: string | null; overdue: boolean }[];
  prep: PrepFacts;
  recapSuggestion: InboxSuggestion | null;
  suggestions: InboxSuggestion[];
  links: LinkItem[];
  templates: { id: string; name: string; agenda: string[] }[];
  today: string;
  partners: PartnerRef[];
  taskStates: Record<string, TaskState>;
};

/** One row of the meetings list. */
export type MeetingRow = {
  id: string;
  title: string;
  kind: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  location: string | null;
  online: boolean;
  seriesId: string | null;
  orgIds: string[];
  hasNotes: boolean;
  hasRecap: boolean;
  pendingRecap: boolean;
};

export type DecisionRow = {
  id: string;
  text: string;
  decidedOn: string;
  meetingId: string | null;
  meetingTitle: string | null;
  orgIds: string[];
};

export type SeriesRow = {
  id: string;
  title: string;
  recurrenceLabel: string | null;
  organisationId: string | null;
  count: number;
  next: { id: string; startsAt: string } | null;
  last: { id: string; startsAt: string } | null;
};

/** Notes language for Claude's recap and the follow-up email: Turkish letters decide. */
export function guessLanguage(text: string, fallback: "tr" | "en"): "tr" | "en" {
  const sample = text.slice(0, 4000);
  if (sample.replace(/\s/g, "").length < 40) return fallback;
  const turkish = (sample.match(/[çğıöşüÇĞİÖŞÜ]/g) ?? []).length;
  const words = sample.split(/\s+/).length;
  return turkish / Math.max(words, 1) > 0.05 ? "tr" : "en";
}

/** Only web links open from the app, never `javascript:` or file links. */
export function safeUrl(url: string | null | undefined) {
  if (!url) return null;
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(u)) return `https://${u}`;
  return null;
}
