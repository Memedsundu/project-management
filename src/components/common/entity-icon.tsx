import {
  BarChart3,
  Building2,
  CalendarClock,
  CheckSquare,
  FileText,
  Folder,
  Gavel,
  Layers,
  LayoutTemplate,
  ListTree,
  NotebookPen,
  PieChart,
  Repeat,
  ScrollText,
  Target,
  User,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  note: NotebookPen,
  meeting: CalendarClock,
  series: Repeat,
  decision: Gavel,
  document: FileText,
  folder: Folder,
  organisation: Building2,
  contact: User,
  activity: ListTree,
  indicator: Target,
  logframe: Layers,
  report: ScrollText,
  collection: Layers,
  template: LayoutTemplate,
  visual: PieChart,
  chart: BarChart3,
};

export function EntityIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  const Icon = ICONS[type] ?? FileText;
  return <Icon size={size} className={className} aria-hidden />;
}
