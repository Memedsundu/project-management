"use client";

import { Bookmark, ChevronDown, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { deleteSavedViewAction, pinSavedViewAction, saveTaskViewAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/controls";
import { Field, Input } from "@/components/ui/input";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { OrgOption } from "./types";
import { useTaskOps } from "./use-task-ops";

export type TaskFilterState = {
  ownerKind?: "me" | "others";
  orgId?: string;
  tag?: string;
  priority?: number;
  due?: "overdue" | "today" | "week" | "month" | "none";
  text?: string;
};

export type SavedViewItem = { id: string; name: string; pinned: boolean; filters: TaskFilterState };

const PARAM: Record<keyof TaskFilterState, string> = { ownerKind: "owner", orgId: "org", tag: "tag", priority: "p", due: "due", text: "q" };

/** Drive-style filter chips, plus saved filters pinned to the menu (Todoist filters). */
export function FilterBar({
  filters,
  orgs,
  tags,
  savedViews,
  activeViewId,
  showOwner = true,
}: {
  filters: TaskFilterState;
  orgs: OrgOption[];
  tags: { name: string; slug: string; count?: number }[];
  savedViews: SavedViewItem[];
  activeViewId?: string | null;
  showOwner?: boolean;
}) {
  const t = useTranslations("tasks.filters");
  const tt = useTranslations("tasks");
  const tc = useTranslations("common");
  const ops = useTaskOps();
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState(filters.text ?? "");

  const set = (key: keyof TaskFilterState, value: string | number | null) => ops.hrefWith({ [PARAM[key]]: value === null ? null : String(value), view: null, open: null });
  const active = Object.entries(filters).filter(([k, v]) => v !== undefined && v !== "" && !(k === "ownerKind" && v === "me" && !showOwner));
  const anyActive = active.length > 0;
  const org = orgs.find((o) => o.id === filters.orgId);
  const dueLabels = { overdue: t("dueOverdue"), today: t("dueToday"), week: t("dueWeek"), month: t("dueMonth"), none: t("dueNone") } as const;

  return (
    <div className="flex flex-col gap-3">
      {savedViews.length ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label={t("savedViews")}>
          <Bookmark size={15} className="mr-1 text-muted" />
          {savedViews.map((v) =>
            v.id === activeViewId ? (
              <DropdownMenu key={v.id}>
                <DropdownMenuTrigger asChild>
                  <Chip active>
                    {v.name}
                    <ChevronDown size={14} />
                  </Chip>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => runAction(pinSavedViewAction(v.id, !v.pinned))}>
                    {v.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                    {v.pinned ? tc("unpin") : tc("pin")}
                  </DropdownMenuItem>
                  <DropdownMenuItem href="/tasks">
                    <X size={15} />
                    {t("clear")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    danger
                    onSelect={async () => {
                      const ok = await runAction(deleteSavedViewAction(v.id));
                      if (ok !== undefined) router.push("/tasks");
                    }}
                  >
                    <Trash2 size={15} />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link key={v.id} href={`/tasks?view=${v.id}`} className="inline-flex h-9 items-center rounded-full border border-line-strong px-3.5 text-[14px] hover:border-ink">
                {v.name}
              </Link>
            ),
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(set("text", text.trim() || null), { scroll: false });
          }}
          className="flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 focus-within:border-ink"
        >
          <Search size={14} className="text-muted" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tc("filter")}
            className="h-full w-[120px] bg-transparent text-[14px] outline-none placeholder:text-faint"
            aria-label={tc("filter")}
          />
        </form>

        {showOwner ? (
          <Menu label={filters.ownerKind === "others" ? t("ownerOthers") : filters.ownerKind === "me" ? t("ownerMe") : t("owner")} active={Boolean(filters.ownerKind)}>
            <DropdownMenuItem href={set("ownerKind", "me")}>{t("ownerMe")}</DropdownMenuItem>
            <DropdownMenuItem href={set("ownerKind", "others")}>{t("ownerOthers")}</DropdownMenuItem>
            <DropdownMenuItem href={set("ownerKind", "all")}>{t("any")}</DropdownMenuItem>
          </Menu>
        ) : null}

        {orgs.length ? (
          <Menu label={org ? org.shortName || org.name : t("partner")} active={Boolean(org)}>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.id} href={set("orgId", o.id)}>
                {o.shortName || o.name}
              </DropdownMenuItem>
            ))}
            {org ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem href={set("orgId", null)}>{t("any")}</DropdownMenuItem>
              </>
            ) : null}
          </Menu>
        ) : null}

        <Menu label={filters.due ? dueLabels[filters.due] : t("due")} active={Boolean(filters.due)}>
          {(Object.keys(dueLabels) as (keyof typeof dueLabels)[]).map((k) => (
            <DropdownMenuItem key={k} href={set("due", k)}>
              {dueLabels[k]}
            </DropdownMenuItem>
          ))}
          {filters.due ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem href={set("due", null)}>{t("any")}</DropdownMenuItem>
            </>
          ) : null}
        </Menu>

        <Menu label={filters.priority ? `p${filters.priority}` : tt("tokens.priority")} active={Boolean(filters.priority)}>
          {[1, 2, 3, 4].map((p) => (
            <DropdownMenuItem key={p} href={set("priority", p)}>
              {tt(`priority.${p}` as "priority.1")}
            </DropdownMenuItem>
          ))}
          {filters.priority ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem href={set("priority", null)}>{t("any")}</DropdownMenuItem>
            </>
          ) : null}
        </Menu>

        {tags.length ? (
          <Menu label={filters.tag ? `#${tags.find((x) => x.slug === filters.tag)?.name ?? filters.tag}` : t("tag")} active={Boolean(filters.tag)}>
            <div className="max-h-[300px] overflow-y-auto">
              {tags.map((tag) => (
                <DropdownMenuItem key={tag.slug} href={set("tag", tag.slug)}>
                  #{tag.name}
                  {tag.count ? <span className="ml-auto text-[12px] text-faint">{tag.count}</span> : null}
                </DropdownMenuItem>
              ))}
            </div>
            {filters.tag ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem href={set("tag", null)}>{t("any")}</DropdownMenuItem>
              </>
            ) : null}
          </Menu>
        ) : null}

        {anyActive && !activeViewId ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setSaveOpen(true)}>
              <Bookmark size={15} />
              {t("save")}
            </Button>
            <Link href="/tasks" className="inline-flex h-9 items-center px-2 text-[14px] text-muted hover:text-ink">
              {t("clear")}
            </Link>
          </>
        ) : null}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent title={t("save")}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const res = await runAction(saveTaskViewAction(name.trim(), filters, true), { success: t("saved") });
              if (res) {
                setSaveOpen(false);
                router.push(`/tasks?view=${res.id}`);
              }
            }}
          >
            <Field label={t("saveName")} htmlFor="view-name">
              <Input id="view-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("savePlaceholder")} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSaveOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Menu({ label, active, children }: { label: React.ReactNode; active?: boolean; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip active={active} className={cn(!active && "text-ink-2")}>
          {label}
          <ChevronDown size={14} />
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
