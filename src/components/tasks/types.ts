/** The task shape the client components receive (dates as strings or Date). */
export type TaskItem = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  startDate: string | null;
  dueDate: string | null;
  dueTime: string | null;
  estimateMin: number | null;
  ownerKind: string;
  ownerOrgId: string | null;
  ownerContactId: string | null;
  ownerName: string | null;
  ownerLabel: string | null;
  parentId: string | null;
  recurrence: string | null;
  recurrenceLabel: string | null;
  planDate: string | null;
  planOrder: number | null;
  reminderAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  sourceType: string | null;
  sourceId: string | null;
  inbox: boolean;
  tags: { name: string; slug: string }[];
  subtaskCount: number;
  subtaskDone: number;
  subtasks?: { id: string; title: string; status: string }[];
  overdue: boolean;
  orgIds: string[];
};

export type OrgOption = { id: string; name: string; shortName: string | null; kind?: string };
export type ContactOption = { id: string; name: string; organisationId: string | null };
