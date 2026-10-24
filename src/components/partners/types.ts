import type { LinkItem } from "@/components/common/links-panel";

export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  organisationId: string | null;
  orgName: string | null;
};

export type PartnerCardData = {
  id: string;
  name: string;
  shortName: string | null;
  kind: string;
  provinces: string[];
  statusLine: string | null;
  agreementEnd: string | null;
  openTasks: number;
  waitingOn: number;
  overdue: number;
  nextMeeting: { id: string; title: string; startsAt: string } | null;
  nextReport: { label: string; due: string } | null;
  lateReports: { label: string; daysLate: number }[];
  focal: { id: string; name: string } | null;
  contacts: number;
};

export type OrgFields = {
  id: string;
  name: string;
  shortName: string | null;
  kind: string;
  provinces: string[];
  agreementStart: string | null;
  agreementEnd: string | null;
  focalContactId: string | null;
  reportingRhythm: string;
  reportDueDays: number;
  statusLine: string | null;
  notes: string | null;
  website: string | null;
};

export type PartnerTask = { id: string; title: string; dueDate: string | null; overdue: boolean; owner: string | null };

export type ReportSlotView = {
  label: string;
  periodEnd: string;
  due: string;
  status: "received" | "late" | "due" | "upcoming";
  daysLate: number;
  doc: { id: string; title: string } | null;
};

export type TimelineEntry = {
  key: string;
  type: "meeting" | "document" | "decision" | "task" | "note";
  date: string;
  title: string;
  href: string;
  meta: string | null;
  state?: string | null;
};

export type PartnerPageData = {
  org: OrgFields & { updatedAt: string };
  contacts: ContactRow[];
  waiting: PartnerTask[];
  mine: PartnerTask[];
  upcoming: { id: string; title: string; startsAt: string; status: string }[];
  lastMeeting: { id: string; title: string; startsAt: string; status: string } | null;
  decisions: { id: string; text: string; decidedOn: string; meetingId: string | null; meetingTitle: string | null }[];
  reports: ReportSlotView[];
  timeline: TimelineEntry[];
  filter: TimelineEntry["type"] | null;
  docCount: number;
  links: LinkItem[];
  orgs: { id: string; name: string; shortName: string | null }[];
  today: string;
  highlight: string | null;
};

export const ORG_KINDS = ["partner", "donor", "government", "un", "ngo", "other"] as const;
export const RHYTHMS = ["none", "monthly", "quarterly", "biannual", "annual"] as const;
