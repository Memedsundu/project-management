"use client";

import { CalendarDays, ChevronRight, Copy, Inbox, MoreHorizontal, NotebookPen, Pin, PinOff, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { createPageAction, duplicateNoteAction, updateNoteAction } from "@/app/(app)/notes/actions";
import { useTrash } from "@/components/common/use-trash";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { NewPageMenu, type TemplateOption } from "./new-page-menu";

export type TreeNote = { id: string; title: string; icon: string | null; parentId: string | null; pinned: boolean };

const EXPANDED_KEY = "notes.expanded";

function readExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Notion's sidebar: pinned pages, then the page tree. Drag a page onto another to nest it. */
export function NotesTree({
  notes,
  inboxCount,
  memoryId,
  templates,
  readOnly,
  onNavigate,
}: {
  notes: TreeNote[];
  inboxCount: number;
  memoryId: string | null;
  templates: TemplateOption[];
  readOnly: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("notes.tree");
  const pathname = usePathname();
  const router = useRouter();
  const activeId = /^\/notes\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);

  const children = useMemo(() => {
    const map = new Map<string | null, TreeNote[]>();
    for (const n of notes) {
      const key = n.parentId && notes.some((p) => p.id === n.parentId) ? n.parentId : null;
      map.set(key, [...(map.get(key) ?? []), n]);
    }
    return map;
  }, [notes]);

  // Open the saved branches, plus every ancestor of the page on screen.
  useEffect(() => {
    const next = readExpanded();
    let p = notes.find((n) => n.id === activeId)?.parentId ?? null;
    let guard = 0;
    while (p && guard++ < 30) {
      next.add(p);
      p = notes.find((n) => n.id === p)?.parentId ?? null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setExpanded(next);
  }, [activeId, notes]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...n]));
      } catch {
        // Private window: the tree simply forgets.
      }
      return n;
    });

  const move = async (id: string, parentId: string | null) => {
    if (id === parentId) return;
    await runAction(updateNoteAction(id, { parentId }), { success: t("moved") });
    if (parentId) setExpanded((s) => new Set(s).add(parentId));
  };

  const pinned = notes.filter((n) => n.pinned);

  return (
    <nav aria-label={t("label")} className="flex flex-col gap-5 text-[14px]">
      <div className="flex flex-col gap-0.5">
        <Link href="/notes/daily" onClick={onNavigate} className="flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 hover:bg-panel">
          <CalendarDays size={16} className="text-muted" />
          {t("daily")}
        </Link>
        {inboxCount ? (
          <Link href="/inbox#notes" onClick={onNavigate} className="flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 hover:bg-panel">
            <Inbox size={16} className="text-muted" />
            <span className="flex-1">{t("inbox")}</span>
            <span className="text-[12px] text-muted">{inboxCount}</span>
          </Link>
        ) : null}
        {memoryId ? (
          <Link
            href={`/notes/${memoryId}`}
            onClick={onNavigate}
            className={cn("flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 hover:bg-panel", activeId === memoryId && "bg-panel font-medium")}
          >
            <Sparkles size={16} className="text-muted" />
            {t("memory")}
          </Link>
        ) : null}
      </div>

      {pinned.length ? (
        <section className="flex flex-col gap-0.5">
          <h3 className="label-caps px-2.5 pb-1">{t("pinned")}</h3>
          {pinned.map((n) => (
            <Link
              key={n.id}
              href={`/notes/${n.id}`}
              onClick={onNavigate}
              className={cn("flex min-h-9 items-center gap-2 truncate rounded-xl px-2.5 hover:bg-panel", activeId === n.id && "bg-panel font-medium")}
            >
              <PageIcon icon={n.icon} />
              <span className="truncate">{n.title || t("untitled")}</span>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-0.5">
        <div
          className={cn("flex items-center gap-1 rounded-xl pl-2.5", dropId === "root" && "bg-accent-soft")}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            setDropId("root");
          }}
          onDragLeave={() => setDropId(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragId;
            setDragId(null);
            setDropId(null);
            if (id) void move(id, null);
          }}
        >
          <h3 className="label-caps flex-1 py-1">{t("pages")}</h3>
          {!readOnly ? (
            <NewPageMenu
              templates={templates}
              parentId={null}
              onCreated={(id) => {
                onNavigate?.();
                router.push(`/notes/${id}`);
              }}
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={t("newPage")}>
                  <Plus size={16} />
                </Button>
              }
            />
          ) : null}
        </div>
        {(children.get(null) ?? []).length === 0 ? <p className="px-2.5 py-2 text-[13px] text-muted">{t("empty")}</p> : null}
        <ul className="flex flex-col gap-0.5" role="tree">
          {(children.get(null) ?? []).map((n) => (
            <TreeRow
              key={n.id}
              node={n}
              depth={0}
              childrenMap={children}
              expanded={expanded}
              toggle={toggle}
              activeId={activeId}
              readOnly={readOnly}
              dragId={dragId}
              dropId={dropId}
              setDragId={setDragId}
              setDropId={setDropId}
              move={move}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </section>
    </nav>
  );
}

function PageIcon({ icon }: { icon: string | null }) {
  return icon ? <span className="w-4 shrink-0 text-center text-[14px] leading-none">{icon}</span> : <NotebookPen size={15} className="shrink-0 text-muted" />;
}

function TreeRow({
  node,
  depth,
  childrenMap,
  expanded,
  toggle,
  activeId,
  readOnly,
  dragId,
  dropId,
  setDragId,
  setDropId,
  move,
  onNavigate,
}: {
  node: TreeNote;
  depth: number;
  childrenMap: Map<string | null, TreeNote[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  activeId: string | null;
  readOnly: boolean;
  dragId: string | null;
  dropId: string | null;
  setDragId: (id: string | null) => void;
  setDropId: (id: string | null) => void;
  move: (id: string, parentId: string | null) => Promise<void>;
  onNavigate?: () => void;
}) {
  const t = useTranslations("notes.tree");
  const router = useRouter();
  const trash = useTrash();
  const kids = childrenMap.get(node.id) ?? [];
  const open = expanded.has(node.id);
  const active = activeId === node.id;

  return (
    <li role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div
        draggable={!readOnly}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          setDragId(node.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropId(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === node.id) return;
          e.preventDefault();
          setDropId(node.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = dragId;
          setDragId(null);
          setDropId(null);
          if (id && id !== node.id) void move(id, node.id);
        }}
        className={cn(
          "group flex min-h-9 items-center gap-1 rounded-xl pr-1 hover:bg-panel",
          active && "bg-panel font-medium",
          dropId === node.id && "bg-accent-soft ring-1 ring-accent",
          dragId === node.id && "opacity-50",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button
          type="button"
          onClick={() => toggle(node.id)}
          aria-label={open ? t("collapse") : t("expand")}
          className={cn("flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-2", !kids.length && "invisible")}
        >
          <ChevronRight size={14} className={cn("transition-transform", open && "rotate-90")} />
        </button>
        <Link href={`/notes/${node.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2 py-1.5" aria-current={active ? "page" : undefined}>
          <PageIcon icon={node.icon} />
          <span className="truncate">{node.title || t("untitled")}</span>
        </Link>
        {!readOnly ? (
          <span className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t("pageMenu")} className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-ink">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => runAction(updateNoteAction(node.id, { pinned: !node.pinned }))}>
                  {node.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                  {node.pinned ? t("unpin") : t("pin")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    const res = await runAction(duplicateNoteAction(node.id));
                    if (res?.id) router.push(`/notes/${res.id}`);
                  }}
                >
                  <Copy size={15} />
                  {t("duplicate")}
                </DropdownMenuItem>
                {node.parentId ? (
                  <DropdownMenuItem onSelect={() => move(node.id, null)}>
                    <ChevronRight size={15} className="rotate-180" />
                    {t("moveToTop")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  danger
                  onSelect={() => trash("note", node.id, { title: node.title || t("untitled"), redirectTo: active ? "/notes" : undefined })}
                >
                  <Trash2 size={15} />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label={t("addSubPage")}
              onClick={async () => {
                const res = await runAction(createPageAction({ parentId: node.id }));
                if (!res) return;
                if (!open) toggle(node.id);
                onNavigate?.();
                router.push(`/notes/${res.id}`);
              }}
              className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-ink"
            >
              <Plus size={15} />
            </button>
          </span>
        ) : null}
      </div>
      {open && kids.length ? (
        <ul role="group" className="flex flex-col gap-0.5">
          {kids.map((k) => (
            <TreeRow
              key={k.id}
              node={k}
              depth={depth + 1}
              childrenMap={childrenMap}
              expanded={expanded}
              toggle={toggle}
              activeId={activeId}
              readOnly={readOnly}
              dragId={dragId}
              dropId={dropId}
              setDragId={setDragId}
              setDropId={setDropId}
              move={move}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
