import type { LinkItem } from "@/components/common/links-panel";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";

export type WorkplanViewKind = "timeline" | "table" | "calendar";
export type TimelineScale = "month" | "quarter";
export type GroupBy = "output" | "partner" | "none";

export type ActivityItem = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  logframeNodeId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "planned" | "ongoing" | "done" | "delayed" | "canceled";
  provinces: string[];
  progress: number;
  isMilestone: boolean;
  orgIds: string[];
  dependsOn: string[];
  /** Past its end date and not done. */
  late: boolean;
  /** Waits for a late activity, or starts before the one it waits for ends. */
  atRisk: boolean;
  openTasks: number;
};

export type OutputOption = { id: string; code: string; title: string };
export type OrgOption = { id: string; name: string; shortName: string | null };
export type SeasonItem = { id: string; name: string; crop: string | null; provinces: string[]; startMonth: number; startDay: number; endMonth: number; endDay: number; active: boolean };
export type SeasonBand = { id: string; name: string; start: string; end: string };
export type HolidayItem = { id: string; date: string; nameTr: string; nameEn: string; kind: string; halfDay: boolean };

export type Milestone = {
  id: string;
  date: string;
  label: string;
  kind: "partner_report" | "donor_report" | "key_date";
  href: string;
  status?: "received" | "late" | "due" | "upcoming" | null;
};

export type CalendarEvent = {
  id: string;
  date: string;
  time?: string | null;
  title: string;
  kind: "meeting" | "task" | "activity_start" | "activity_end" | "holiday" | "report" | "milestone";
  href: string | null;
  late?: boolean;
};

export type ActivityTask = { id: string; title: string; dueDate: string | null; status: string; overdue: boolean; ownerLabel: string | null };

export type ActivityDetail = {
  activity: ActivityItem;
  links: LinkItem[];
  tasks: ActivityTask[];
  /** Activities that wait for this one. */
  dependents: string[];
  history: { id: string; at: string; action: string; actor: string; summary: string | null }[];
  prep: InboxSuggestion[];
};

export type WorkplanData = {
  view: WorkplanViewKind;
  scale: TimelineScale;
  group: GroupBy;
  today: string;
  range: { from: string; to: string };
  activities: ActivityItem[];
  outputs: OutputOption[];
  orgs: OrgOption[];
  seasons: SeasonItem[];
  bands: SeasonBand[];
  holidays: HolidayItem[];
  milestones: Milestone[];
  calendar: { mode: "month" | "week"; anchor: string; from: string; to: string; events: CalendarEvent[] } | null;
  detail: ActivityDetail | null;
  aiReady: boolean;
  /** Claude's pending preparation proposals, one card per activity. */
  prep: InboxSuggestion[];
  filters: { partner: string | null; status: string | null };
  project: { startYear: number; endYear: number };
};
