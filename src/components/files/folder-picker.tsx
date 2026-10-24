"use client";

import { ChevronRight, Folder, FolderOpen, Home } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import type { FolderNode } from "./types";

/** "Taşı": pick a folder from the whole tree (Drive's move dialog). */
export function FolderPickerDialog({
  open,
  onOpenChange,
  folders,
  current,
  exclude = [],
  title,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folders: FolderNode[];
  current: string | null;
  exclude?: string[];
  title: string;
  onPick: (folderId: string | null) => void;
}) {
  const t = useTranslations("files.move");
  const [picked, setPicked] = useState<string | null>(current);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const children = useMemo(() => {
    const m = new Map<string | null, FolderNode[]>();
    for (const f of folders) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    return m;
  }, [folders]);
  const blocked = useMemo(() => {
    // A folder cannot move into itself or anything below it.
    const out = new Set(exclude);
    const walk = (id: string) => {
      for (const c of children.get(id) ?? []) {
        out.add(c.id);
        walk(c.id);
      }
    };
    for (const id of exclude) walk(id);
    return out;
  }, [children, exclude]);

  const row = (f: FolderNode, depth: number): React.ReactNode => {
    const kids = (children.get(f.id) ?? []).filter((k) => !blocked.has(k.id));
    const open = expanded.has(f.id);
    if (blocked.has(f.id)) return null;
    return (
      <li key={f.id}>
        <div className={cn("flex min-h-10 items-center gap-1 rounded-xl pr-2", picked === f.id ? "bg-ink text-on-ink" : "hover:bg-panel")} style={{ paddingLeft: 4 + depth * 16 }}>
          <button
            type="button"
            className={cn("flex size-7 items-center justify-center rounded-md", !kids.length && "invisible")}
            onClick={() =>
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(f.id)) n.delete(f.id);
                else n.add(f.id);
                return n;
              })
            }
            aria-label={open ? t("collapse") : t("expand")}
          >
            <ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} />
          </button>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-[14px]" onClick={() => setPicked(f.id)} onDoubleClick={() => onPick(f.id)}>
            {open ? <FolderOpen size={16} /> : <Folder size={16} />}
            <span className="truncate">{f.name}</span>
          </button>
        </div>
        {open && kids.length ? <ul>{kids.map((k) => row(k, depth + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <div className="flex flex-col gap-3">
          <ul className="scrollbar-thin flex max-h-[50vh] flex-col overflow-y-auto" role="tree">
            <li>
              <button
                type="button"
                className={cn("flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-[14px]", picked === null ? "bg-ink text-on-ink" : "hover:bg-panel")}
                onClick={() => setPicked(null)}
              >
                <Home size={16} />
                {t("root")}
              </button>
            </li>
            {(children.get(null) ?? []).map((f) => row(f, 0))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={() => onPick(picked)} disabled={picked === current}>
              {t("here")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
