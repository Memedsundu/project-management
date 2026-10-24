import {
  BarChart3,
  CalendarRange,
  CheckSquare,
  FileText,
  FolderOpen,
  Handshake,
  Inbox,
  Layers,
  NotebookPen,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: string;
  href: string;
  labelKey: string;
  icon: LucideIcon;
  shortcut?: string; // second key after "g"
  count?: "inbox" | "today" | "filesToCheck";
};

export type NavGroup = { labelKey?: string; items: NavItem[] };

/** Bugün · Gelen kutusu · İŞ · PROJE · BELGELER · Raporlar · Ayarlar */
export const NAV: NavGroup[] = [
  {
    items: [
      { key: "today", href: "/today", labelKey: "today", icon: Sun, shortcut: "b" },
      { key: "inbox", href: "/inbox", labelKey: "inbox", icon: Inbox, shortcut: "i", count: "inbox" },
    ],
  },
  {
    labelKey: "groupWork",
    items: [
      { key: "tasks", href: "/tasks", labelKey: "tasks", icon: CheckSquare, shortcut: "t", count: "today" },
      { key: "meetings", href: "/meetings", labelKey: "meetings", icon: Users, shortcut: "m" },
      { key: "notes", href: "/notes", labelKey: "notes", icon: NotebookPen, shortcut: "n" },
    ],
  },
  {
    labelKey: "groupProject",
    items: [
      { key: "partners", href: "/partners", labelKey: "partners", icon: Handshake, shortcut: "o" },
      { key: "workplan", href: "/workplan", labelKey: "workplan", icon: CalendarRange, shortcut: "p" },
      { key: "indicators", href: "/indicators", labelKey: "indicators", icon: BarChart3, shortcut: "g" },
    ],
  },
  {
    labelKey: "groupFiles",
    items: [
      { key: "files", href: "/files", labelKey: "files", icon: FolderOpen, shortcut: "d", count: "filesToCheck" },
      { key: "collections", href: "/collections", labelKey: "collections", icon: Layers, shortcut: "k" },
    ],
  },
  {
    items: [
      { key: "reports", href: "/reports", labelKey: "reports", icon: FileText, shortcut: "r" },
      { key: "settings", href: "/settings", labelKey: "settings", icon: Settings, shortcut: "a" },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

export function activeNavKey(pathname: string) {
  const item = ALL_NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  return item?.key ?? null;
}
