"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { emptyTrashAction, purgeAction, restoreAction } from "@/app/actions/common";
import { EntityIcon } from "@/components/common/entity-icon";
import { useScreenContext } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDateTime } from "@/lib/dates";
import { foldText } from "@/lib/fold";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";

export type TrashRow = { type: EntityType; id: string; title: string; href: string; deletedAt: string; daysLeft: number; inside: number };

/**
 * Çöp kutusu (Google Drive trash): what she deleted in the last 30 days.
 * Restore puts a thing back where it was; deleting forever asks first.
 */
export function TrashScreen({ items, readOnly }: { items: TrashRow[]; readOnly: boolean }) {
  const t = useTranslations("trash");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [kind, setKind] = useState<EntityType | "all">("all");
  const [q, setQ] = useState("");
  const [purging, setPurging] = useState<TrashRow | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useScreenContext({ kind: "trash", title: t("title"), detail: t("count", { count: items.length }) });

  const kinds = useMemo(() => {
    const counts = new Map<EntityType, number>();
    for (const i of items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const shown = useMemo(() => {
    const needle = foldText(q.trim());
    return items.filter((i) => (kind === "all" || i.type === kind) && (!needle || foldText(i.title).includes(needle)));
  }, [items, kind, q]);

  async function restore(item: TrashRow) {
    setBusy(item.id);
    const res = await runAction(restoreAction(item.type, item.id));
    setBusy(null);
    if (res === undefined) return;
    toast(t("restored", { title: item.title }), { action: { label: t("open"), onClick: () => router.push(item.href) } });
  }

  async function purge(item: TrashRow) {
    setBusy(item.id);
    const res = await runAction(purgeAction(item.type, item.id), { success: t("purged") });
    setBusy(null);
    if (res !== undefined) setPurging(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          items.length && !readOnly ? (
            <Button variant="danger" onClick={() => setEmptying(true)} data-testid="trash-empty">
              <Trash2 size={16} />
              {t("emptyTrash")}
            </Button>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<Trash2 size={22} />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tc("filter")}>
              <Chip active={kind === "all"} aria-pressed={kind === "all"} onClick={() => setKind("all")}>
                {t("all")} · {items.length}
              </Chip>
              {kinds.map(([k, n]) => (
                <Chip key={k} active={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)} data-testid={`trash-kind-${k}`}>
                  {tc(`kindsPlural.${k}` as "kindsPlural.task")} · {n}
                </Chip>
              ))}
            </div>
            {items.length > 8 ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filter")} aria-label={t("filter")} className="h-10 w-full sm:ml-auto sm:w-[240px]" /> : null}
          </div>

          {shown.length === 0 ? <p className="text-[14px] text-muted">{t("noMatch")}</p> : null}
          <ul className="flex flex-col rounded-2xl border border-line" data-testid="trash-list">
            {shown.map((item) => (
              <li key={`${item.type}:${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3 last:border-0 sm:flex-nowrap" data-testid="trash-row">
                <EntityIcon type={item.type} size={18} className="shrink-0 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px]">{item.title}</span>
                  <span className="flex flex-wrap gap-x-1 text-[13px] text-muted">
                    <span>{tc(`kinds.${item.type}` as "kinds.task")}</span>
                    {item.inside ? <span>· {t("inside", { count: item.inside })}</span> : null}
                    <span>· {t("deletedOn", { date: formatDateTime(item.deletedAt, locale) })}</span>
                    <span className={cn(item.daysLeft <= 3 && "text-accent-ink")}>· {item.daysLeft === 0 ? t("lastDay") : t("daysLeft", { count: item.daysLeft })}</span>
                  </span>
                </span>
                {!readOnly ? (
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => restore(item)} disabled={busy === item.id} data-testid="trash-restore">
                      <RotateCcw size={15} />
                      {t("restore")}
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setPurging(item)} disabled={busy === item.id} aria-label={t("purgeNamed", { title: item.title })} title={t("purge")} data-testid="trash-purge">
                      <Trash2 size={15} />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={purging !== null} onOpenChange={(v) => !v && setPurging(null)}>
        <DialogContent title={t("purgeTitle")} description={purging ? t("purgeBody", { title: purging.title }) : undefined}>
          {purging ? (
            <div className="flex flex-col gap-5">
              {purging.inside ? <p className="text-[14px]">{t("purgeInside", { count: purging.inside })}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPurging(null)}>
                  {tc("cancel")}
                </Button>
                <Button variant="danger" onClick={() => purge(purging)} disabled={busy === purging.id} data-testid="trash-purge-confirm">
                  {t("purge")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={emptying} onOpenChange={setEmptying}>
        <DialogContent title={t("emptyTitle")} description={t("emptyConfirmBody", { count: items.length })}>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEmptying(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy === "all"}
              onClick={async () => {
                setBusy("all");
                const res = await runAction(emptyTrashAction(), { success: t("emptied") });
                setBusy(null);
                if (res !== undefined) setEmptying(false);
              }}
              data-testid="trash-empty-confirm"
            >
              {t("emptyTrash")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
