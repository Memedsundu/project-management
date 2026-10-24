"use client";

import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/overlay";
import type { TemplateOption } from "./new-page-menu";
import { NotesTree, type TreeNote } from "./notes-tree";

/** Notes keep their page tree beside every page on a laptop, and in a side sheet on a phone. */
export function NotesShell({
  tree,
  inboxCount,
  memoryId,
  templates,
  children,
}: {
  tree: TreeNote[];
  inboxCount: number;
  memoryId: string | null;
  templates: TemplateOption[];
  children: React.ReactNode;
}) {
  const t = useTranslations("notes.tree");
  const { readOnly } = useShell();
  const [open, setOpen] = useState(false);
  const treeEl = (onNavigate?: () => void) => (
    <NotesTree notes={tree} inboxCount={inboxCount} memoryId={memoryId} templates={templates} readOnly={readOnly} onNavigate={onNavigate} />
  );
  return (
    <div className="flex gap-8 xl:gap-12">
      <aside className="hidden w-[248px] shrink-0 lg:block" aria-label={t("label")}>
        <div className="scrollbar-thin sticky top-6 max-h-[calc(100dvh-48px)] overflow-y-auto pb-6">{treeEl()}</div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-4 lg:hidden">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <PanelLeft size={16} />
            {t("pages")}
          </Button>
        </div>
        {children}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent side="left" title={t("pages")}>
          <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">{treeEl(() => setOpen(false))}</div>
        </SheetContent>
      </Dialog>
    </div>
  );
}
