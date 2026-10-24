"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { acceptProposedTasksAction } from "@/app/actions/common";
import { quickAddContextAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";
import { DateButton } from "./date-menu";

/** One task Claude proposed, plus whether she keeps it. */
export type Proposal = {
  title: string;
  dueDate?: string | null;
  startDate?: string | null;
  ownerName?: string | null;
  ownerOrgId?: string | null;
  priority?: number | null;
  notes?: string | null;
  parentId?: string | null;
  keep: boolean;
};

type Partner = { id: string; name: string; shortName: string | null };

/**
 * The review step for every "Görevleri çıkar": nothing is created until she
 * picks the rows to keep. Titles, owners and dates can be fixed in place.
 */
export function ExtractTasksDialog({
  open,
  onOpenChange,
  title,
  proposals,
  source,
  onDone,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  proposals: Proposal[];
  source: { type: EntityType; id: string } | null;
  onDone?: (ids: string[]) => void;
  /** Override the default "create tasks" step, for example to accept a stored suggestion. */
  onAccept?: (kept: Proposal[]) => Promise<boolean>;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [rows, setRows] = useState(proposals);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    runAction(quickAddContextAction(), { silent: true }).then((r) => r && setPartners(r.partners));
  }, [open]);

  const kept = rows.filter((r) => r.keep && r.title.trim());
  const update = (i: number, patch: Partial<Proposal>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const accept = async () => {
    setBusy(true);
    try {
      if (onAccept) {
        if (await onAccept(kept)) {
          toast(t("extract.added", { count: kept.length }));
          onDone?.([]);
          onOpenChange(false);
        }
        return;
      }
      const res = await runAction(
        acceptProposedTasksAction(
          source,
          kept.map(({ keep, ...rest }) => {
            void keep;
            return rest;
          }),
        ),
      );
      if (res) {
        toast(t("extract.added", { count: res.ids.length }));
        onDone?.(res.ids);
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title ?? t("extract.title")} description={rows.length ? t("extract.body") : undefined} wide>
        {rows.length === 0 ? (
          <p className="text-[15px] text-muted">{t("extract.none")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 border-b border-line pb-2 text-[13px] text-muted">
              <Checkbox
                checked={kept.length === rows.length ? true : kept.length ? "indeterminate" : false}
                onCheckedChange={(v) => setRows((list) => list.map((r) => ({ ...r, keep: v === true })))}
                aria-label={tc("selectAll")}
              />
              <span>{tc("selectedCount", { count: kept.length })}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border px-3 py-2.5 md:flex-row md:items-center",
                    r.keep ? "border-line-strong" : "border-line-soft opacity-60",
                  )}
                >
                  <div className="flex flex-1 items-start gap-3">
                    <span className="pt-2.5">
                      <Checkbox checked={r.keep} onCheckedChange={(v) => update(i, { keep: v === true })} aria-label={r.title} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <input
                        value={r.title}
                        onChange={(e) => update(i, { title: e.target.value })}
                        className="h-10 w-full bg-transparent text-[15px] outline-none"
                        aria-label={tc("title")}
                      />
                      {r.notes ? <span className="line-clamp-2 text-[12.5px] text-muted">{r.notes}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-8 md:pl-0">
                    <Select
                      value={r.ownerOrgId ? `org:${r.ownerOrgId}` : r.ownerName ? "name" : "me"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "me") update(i, { ownerOrgId: null, ownerName: null });
                        else if (v.startsWith("org:")) update(i, { ownerOrgId: v.slice(4), ownerName: null });
                      }}
                      className="h-10 w-[150px] text-[14px]"
                      aria-label={t("owner")}
                    >
                      <option value="me">{t("ownerMe")}</option>
                      {r.ownerName && !r.ownerOrgId ? <option value="name">{r.ownerName}</option> : null}
                      {partners.map((p) => (
                        <option key={p.id} value={`org:${p.id}`}>
                          {p.shortName || p.name}
                        </option>
                      ))}
                    </Select>
                    <DateButton value={r.dueDate ?? null} onChange={(d) => update(i, { dueDate: d })} className="w-[130px]" />
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </Button>
              <Button onClick={accept} disabled={busy || kept.length === 0}>
                {busy ? tc("working") : t("extract.addSelected", { count: kept.length })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
