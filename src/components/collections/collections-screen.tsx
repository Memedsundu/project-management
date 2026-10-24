"use client";

import { Filter, Layers, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { updateCollectionAction } from "@/app/(app)/collections/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { dayOf, formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { CollectionCard, CollectionsData } from "@/server/views/collections";
import { CollectionDialog, type CollectionDraft } from "./collection-dialog";

const EMPTY: CollectionDraft = { name: "", description: null, pinned: false, smartFilter: null };

/** One collection as a card: what it is for and the first things in it (Dropbox Dash Stacks). */
function CollectionTile({ c, onEdit }: { c: CollectionCard; onEdit: () => void }) {
  const t = useTranslations("collections");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const trash = useTrash();
  return (
    <li className="group relative">
      <Link href={`/collections/${c.id}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line px-5 py-4 transition-colors hover:border-ink" data-testid="collection-card">
        <span className="flex min-w-0 items-start gap-2.5 pr-10">
          <span className="mt-1 text-muted">{c.smartFilter ? <Filter size={17} /> : <Layers size={17} />}</span>
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-2 font-display text-[26px] leading-tight">{c.name}</span>
            {c.description ? <span className="line-clamp-2 text-[14px] text-muted">{c.description}</span> : null}
          </span>
        </span>
        {c.preview.length ? (
          <span className="flex flex-col gap-1.5">
            {c.preview.map((p) => (
              <span key={`${p.type}:${p.id}`} className="flex min-w-0 items-center gap-2 text-[14px] text-ink-2">
                <EntityIcon type={p.type} size={14} className="shrink-0 text-muted" />
                <span className="truncate">{p.title}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-[14px] text-muted">{t("card.empty")}</span>
        )}
        <span className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3 text-[13px] text-muted">
          <span>{c.count >= 100 ? t("card.many") : t("card.items", { count: c.count })}</span>
          {c.smartFilter ? (
            <Badge variant="outline" size="sm">
              {t("card.smart")}
            </Badge>
          ) : null}
          {c.pinned ? (
            <span className="inline-flex items-center gap-1">
              <Pin size={12} />
              {t("card.pinned")}
            </span>
          ) : null}
          <span className="ml-auto">{t("card.updated", { date: formatDay(dayOf(c.updatedAt), locale) })}</span>
        </span>
      </Link>
      {!shell.readOnly ? (
        <span className="absolute right-3 top-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("card.menu", { name: c.name })}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => runAction(updateCollectionAction(c.id, { pinned: !c.pinned }), { success: c.pinned ? t("unpinned") : t("pinnedToast") })}>
                {c.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                {c.pinned ? t("unpin") : t("pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil size={15} />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={() => trash("collection", c.id, { title: c.name })}>
                <Trash2 size={15} />
                {tc("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
    </li>
  );
}

/** "Koleksiyonlar": sets of files, notes and meetings gathered for one purpose, each one a notebook to ask. */
export function CollectionsScreen({ data }: { data: CollectionsData }) {
  const t = useTranslations("collections");
  const shell = useShell();
  const [draft, setDraft] = useState<CollectionDraft | null>(null);
  useScreenContext({ kind: "collections", title: t("title") });
  const examples = [t("examples.0"), t("examples.1"), t("examples.2")];
  const pinned = data.collections.filter((c) => c.pinned);
  const others = data.collections.filter((c) => !c.pinned);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          !shell.readOnly ? (
            <Button onClick={() => setDraft(EMPTY)} data-testid="collection-new">
              <Plus size={16} />
              {t("new")}
            </Button>
          ) : undefined
        }
      />

      {data.collections.length === 0 ? (
        <EmptyState
          title={t("empty.title")}
          body={t("empty.body")}
          icon={<Layers size={22} />}
          action={
            !shell.readOnly ? (
              <div className="flex flex-wrap gap-2">
                {examples.map((ex) => (
                  <Button key={ex} variant="outline" onClick={() => setDraft({ ...EMPTY, name: ex })}>
                    <Plus size={15} />
                    {ex}
                  </Button>
                ))}
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          {[
            { key: "pinned", list: pinned },
            { key: "all", list: others },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.key} className="flex flex-col gap-3" aria-labelledby={`c-${g.key}`}>
                {pinned.length && others.length ? (
                  <h2 id={`c-${g.key}`} className="label-caps">
                    {g.key === "pinned" ? t("groups.pinned") : t("groups.others")}
                  </h2>
                ) : (
                  <h2 id={`c-${g.key}`} className="sr-only">
                    {t("title")}
                  </h2>
                )}
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.list.map((c) => (
                    <CollectionTile key={c.id} c={c} onEdit={() => setDraft({ id: c.id, name: c.name, description: c.description, pinned: c.pinned, smartFilter: c.smartFilter })} />
                  ))}
                </ul>
              </section>
            ))}
          <p className="hidden text-[13px] text-muted md:block">{t("footnote")}</p>
        </>
      )}

      {draft ? <CollectionDialog key={draft.id ?? draft.name} open onOpenChange={(v) => !v && setDraft(null)} options={data.options} initial={draft} /> : null}
    </div>
  );
}
