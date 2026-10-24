import type { LinkItem } from "@/components/common/links-panel";

export type IndicatorStatus = "on_track" | "behind" | "ahead" | "no_data";
export type IndicatorUnit = "number" | "percent" | "text";
export type LogframeLevel = "goal" | "outcome" | "output";

export type PeriodItem = { id: string; label: string; kind: string; startDate: string; endDate: string };

export type IpttCellItem = { periodId: string; target: number | null; actual: number | null; proposed: number; percent: number | null; ended: boolean };

export type IpttItem = {
  id: string;
  code: string;
  name: string;
  unit: IndicatorUnit;
  nodeId: string | null;
  nodeCode: string | null;
  baseline: number | null;
  lopTarget: number | null;
  direction: "increase" | "decrease";
  cumulative: boolean;
  responsibleOrgId: string | null;
  cells: IpttCellItem[];
  toDateTarget: number | null;
  toDateActual: number | null;
  percentToDate: number | null;
  percentOfLop: number | null;
  status: IndicatorStatus;
  proposedCount: number;
};

export type NodeOption = { id: string; code: string; title: string; level: LogframeLevel; parentId: string | null };
export type OrgOption = { id: string; name: string; shortName: string | null; kind: string };

export type IndicatorsData = {
  today: string;
  years: string[];
  year: string;
  periods: PeriodItem[];
  allPeriods: PeriodItem[];
  periodsLocked: boolean;
  rows: IpttItem[];
  codes: string[];
  total: number;
  nodes: NodeOption[];
  orgs: OrgOption[];
  filters: { status: IndicatorStatus | null; partner: string | null };
  aiReady: boolean;
};

export type LogframeIndicator = { id: string; code: string; name: string; unit: IndicatorUnit; status: IndicatorStatus; toDateActual: number | null; toDateTarget: number | null; lopTarget: number | null };
export type LogframeActivity = { id: string; code: string; title: string; status: string; startDate: string | null; endDate: string | null; late: boolean };

export type LogframeItem = {
  id: string;
  parentId: string | null;
  level: LogframeLevel;
  code: string;
  title: string;
  description: string | null;
  indicators: LogframeIndicator[];
  activities: LogframeActivity[];
  children: LogframeItem[];
};

export type LogframeData = {
  roots: LogframeItem[];
  loose: { indicators: LogframeIndicator[]; activities: number };
  orgs: OrgOption[];
  nodes: NodeOption[];
};

export type ValueItem = {
  id: string;
  periodId: string;
  periodLabel: string;
  value: number;
  disaggregation: Record<string, string> | null;
  organisationId: string | null;
  orgName: string | null;
  sourceDocumentId: string | null;
  sourceTitle: string | null;
  sourcePage: number | null;
  sourceNote: string | null;
  status: "approved" | "proposed";
  createdAt: string;
};

export type IndicatorFields = {
  id: string;
  code: string;
  name: string;
  definition: string | null;
  unit: IndicatorUnit;
  disaggregation: string[];
  baseline: number | null;
  baselineDate: string | null;
  lopTarget: number | null;
  dataSource: string | null;
  frequency: string | null;
  responsibleOrgId: string | null;
  meansOfVerification: string | null;
  direction: "increase" | "decrease";
  cumulative: boolean;
  logframeNodeId: string | null;
  nodeCode: string | null;
  nodeTitle: string | null;
};

export type PartnerTotal = { orgId: string | null; orgName: string; total: number | null; byPeriod: Record<string, number> };

export type IndicatorPageData = {
  today: string;
  indicator: IndicatorFields;
  row: IpttItem;
  periods: PeriodItem[];
  values: ValueItem[];
  byPartner: PartnerTotal[];
  nodes: NodeOption[];
  orgs: OrgOption[];
  links: LinkItem[];
  aiReady: boolean;
};
