"use client";

import { useTranslations } from "next-intl";
import { Kbd } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { ALL_NAV_ITEMS } from "./nav-items";

export function ShortcutsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("settings.shortcuts");
  const tn = useTranslations("nav");
  const general: [string[], string][] = [
    [["⌘", "K"], t("search")],
    [["/"], t("search")],
    [["N"], t("quickAdd")],
    [["⌘", "."], t("assistant")],
    [["?"], t("help")],
    [["Esc"], t("close")],
  ];
  const lists: [string[], string][] = [
    [["J"], t("down")],
    [["K"], t("up")],
    [["X"], t("select")],
    [["Enter"], t("openItem")],
    [["D"], t("setDate")],
    [["P"], t("setPriority")],
    [["E"], t("complete")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} wide>
        <div className="grid gap-8 md:grid-cols-3">
          <Section title={t("general")} rows={general} />
          <Section
            title={t("goTo")}
            rows={ALL_NAV_ITEMS.filter((i) => i.shortcut).map((i) => [["G", i.shortcut!.toUpperCase()], tn(i.labelKey as "today")])}
          />
          <Section title={t("lists")} rows={lists} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, rows }: { title: string; rows: [string[], string][] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="label-caps">{title}</h3>
      <ul className="flex flex-col">
        {rows.map(([keys, label], i) => (
          <li key={i} className="flex items-center justify-between gap-3 border-b border-line-soft py-2 text-[14px]">
            <span>{label}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
