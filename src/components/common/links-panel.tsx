"use client";

import { Link2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { addLinkAction, removeLinkAction } from "@/app/actions/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runAction } from "@/lib/client/run-action";
import type { EntityType } from "@/server/entities";
import { EntityIcon } from "./entity-icon";
import { EntityPicker } from "./entity-picker";

export type LinkItem = {
  type: EntityType;
  id: string;
  title: string;
  href: string;
  kind: string;
  direction: "out" | "in";
  createdBy: string;
};

/** "Bağlantılar": everything this record links to and everything that links here (backlinks). */
export function LinksPanel({
  self,
  items,
  readOnly,
  compact,
}: {
  self: { type: EntityType; id: string };
  items: LinkItem[];
  readOnly?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("common");
  const tk = useTranslations("common.kinds");
  const visible = items.filter((i) => i.kind !== "collection_item" || i.type === "collection");
  return (
    <section className="flex flex-col gap-2" aria-label={t("links")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="label-caps flex items-center gap-1.5">
          <Link2 size={13} />
          {t("links")}
        </h3>
        {!readOnly ? (
          <EntityPicker
            exclude={[`${self.type}:${self.id}`, ...visible.map((i) => `${i.type}:${i.id}`)]}
            onPick={async (item) => {
              await runAction(addLinkAction(self, { type: item.type, id: item.id }));
            }}
            align="end"
            trigger={
              <Button variant="ghost" size="sm" className="h-8 px-2.5">
                <Plus size={15} />
                {t("addLink")}
              </Button>
            }
          />
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="text-[14px] text-muted">{t("noLinks")}</p>
      ) : (
        <ul className={compact ? "flex flex-wrap gap-1.5" : "flex flex-col"}>
          {visible.map((item) => (
            <li key={`${item.kind}:${item.type}:${item.id}`} className={compact ? "" : "group flex items-center gap-2 border-b border-line-soft py-1.5 last:border-0"}>
              <Link
                href={item.href}
                className={
                  compact
                    ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] hover:border-ink"
                    : "flex min-h-9 min-w-0 flex-1 items-center gap-2 text-[14px] hover:underline"
                }
              >
                <EntityIcon type={item.type} className="shrink-0 text-muted" size={15} />
                <span className="truncate">{item.title}</span>
                {!compact ? <span className="shrink-0 text-[12px] text-faint">{tk(item.type as "task")}</span> : null}
                {!compact && item.direction === "in" && item.kind === "mention" ? (
                  <Badge variant="outline" size="sm">
                    {t("mentionsThis")}
                  </Badge>
                ) : null}
                {!compact && item.createdBy === "ai" ? (
                  <Badge variant="ai" size="sm">
                    {t("aiBadge")}
                  </Badge>
                ) : null}
              </Link>
              {!readOnly && !compact && item.kind !== "mention" ? (
                <button
                  type="button"
                  aria-label={t("removeLink")}
                  onClick={() => runAction(removeLinkAction(self, { type: item.type, id: item.id }))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted opacity-0 hover:bg-panel hover:text-ink focus:opacity-100 group-hover:opacity-100"
                >
                  <X size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
