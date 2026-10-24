"use client";

import { AlertTriangle, BarChart3, ListTree, MoreHorizontal, Network, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createNodeAction, updateNodeAction } from "@/app/(app)/indicators/actions";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { IndicatorDialog } from "./indicator-form";
import { Meter, StatusPill } from "./indicators-screen";
import { fmtRatio, fmtValue, nextNodeCode } from "./shared";
import type { LogframeData, LogframeIndicator, LogframeItem, LogframeLevel, NodeOption } from "./types";

const LEVELS: LogframeLevel[] = ["goal", "outcome", "output"];
const childLevel = (l: LogframeLevel): LogframeLevel | null => (l === "goal" ? "outcome" : l === "outcome" ? "output" : null);

function flatten(items: LogframeItem[]): LogframeItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children)]);
}

type NodeDraft = { id?: string; parentId: string | null; level: LogframeLevel; code: string; title: string; description: string };

/** Where an item can sit: an outcome under the goal, an output under an outcome (or the goal when there are no outcomes). */
function parentOptions(nodes: NodeOption[], level: LogframeLevel, self?: string) {
  if (level === "goal") return [];
  const outcomes = nodes.filter((n) => n.level === "outcome" && n.id !== self);
  if (level === "output" && outcomes.length) return outcomes;
  return nodes.filter((n) => n.level === "goal" && n.id !== self);
}

function NodeDialog({ draft, nodes, onClose }: { draft: NodeDraft; nodes: NodeOption[]; onClose: () => void }) {
  const t = useTranslations("indicators.logframe");
  const tl = useTranslations("indicators.levels");
  const tc = useTranslations("common");
  const [level, setLevel] = useState(draft.level);
  const [parentId, setParentId] = useState(draft.parentId ?? "");
  // Keep the place it has now in the list, so saving never moves it by accident.
  const current = nodes.find((n) => n.id === draft.parentId && n.level !== "output");
  const base = parentOptions(nodes, level, draft.id);
  const parents = current && level !== "goal" && !base.some((n) => n.id === current.id) ? [current, ...base] : base;
  const [code, setCode] = useState(draft.code);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [busy, setBusy] = useState(false);
  const valid = code.trim() && title.trim();

  async function save() {
    if (!valid) return;
    setBusy(true);
    const parent = parents.some((n) => n.id === parentId) ? parentId : null;
    const input = { level, parentId: parent, code: code.trim(), title: title.trim(), description: description.trim() || null };
    const res = draft.id ? await runAction(updateNodeAction(draft.id, input)) : await runAction(createNodeAction(input));
    setBusy(false);
    if (res !== undefined) onClose();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={draft.id ? t("editTitle") : t("addTitle", { level: tl(level) })} description={draft.id ? undefined : t("addDescription")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label={t("level")}>
              <Select value={level} onChange={(e) => setLevel(e.target.value as LogframeLevel)}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {tl(l)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("code")}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={30} />
            </Field>
          </div>
          {parents.length ? (
            <Field label={t("parent")}>
              <Select value={parents.some((n) => n.id === parentId) ? parentId : ""} onChange={(e) => setParentId(e.target.value)} data-testid="node-parent">
                <option value="">{t("noParent")}</option>
                {parents.map((n) => (
                  <option key={n.id} value={n.id}>
                    {tl(n.level)} {n.code} · {n.title.length > 70 ? `${n.title.slice(0, 70)}…` : n.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("statement")}>
            <Textarea value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} required autoFocus placeholder={t(`placeholders.${level}`)} className="min-h-20" data-testid="node-title" />
          </Field>
          <Field label={t("description")}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} placeholder={t("descriptionPlaceholder")} className="min-h-16" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !valid} data-testid="node-save">
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function IndicatorLine({ i }: { i: LogframeIndicator }) {
  const t = useTranslations("indicators.table");
  const locale = useLocale();
  const ratio = i.toDateTarget ? (i.toDateActual ?? 0) / i.toDateTarget : null;
  return (
    <li>
      <Link href={`/indicators/${i.id}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 hover:bg-panel md:grid-cols-[minmax(0,1fr)_160px_auto]", i.status === "behind" && "bg-accent-soft/40")} data-testid="lf-indicator">
        <span className="flex min-w-0 items-baseline gap-2">
          <BarChart3 size={14} className="shrink-0 translate-y-0.5 text-muted" />
          <span className="shrink-0 text-[13px] tabular-nums text-muted">{i.code}</span>
          <span className="min-w-0 text-[14px]">{i.name}</span>
        </span>
        <span className="col-start-1 row-start-2 flex items-center gap-2 pl-6 md:col-start-2 md:row-start-1 md:pl-0">
          <span className="w-[72px] shrink-0 text-right text-[13px] tabular-nums md:order-2">
            {fmtValue(i.toDateActual, i.unit, locale)}
            {i.toDateTarget !== null ? <span className="text-muted"> {t("of", { target: fmtValue(i.toDateTarget, i.unit, locale) })}</span> : null}
          </span>
          <Meter ratio={ratio} behind={i.status === "behind"} className="w-16 md:order-1" label={fmtRatio(ratio, locale)} />
        </span>
        <StatusPill status={i.status} className="row-span-2 self-center md:row-span-1" />
      </Link>
    </li>
  );
}

function NodeBlock({ item, depth, readOnly, onAdd, onEdit, onAddIndicator }: { item: LogframeItem; depth: number; readOnly: boolean; onAdd: (parent: LogframeItem) => void; onEdit: (item: LogframeItem) => void; onAddIndicator: (item: LogframeItem) => void }) {
  const t = useTranslations("indicators.logframe");
  const tl = useTranslations("indicators.levels");
  const tc = useTranslations("common");
  const locale = useLocale();
  const trash = useTrash();
  const next = childLevel(item.level);
  const late = item.activities.filter((a) => a.late).length;
  return (
    <section id={`n-${item.id}`} className={cn("flex scroll-mt-24 flex-col gap-3", depth > 0 && "border-l border-line pl-4 md:pl-6")} data-testid="lf-node" data-level={item.level}>
      <div className={cn("flex flex-col gap-2 rounded-2xl border border-line px-4 py-3.5", item.level === "goal" && "bg-bg-subtle")}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="label-caps">
              {tl(item.level)} {item.code}
            </span>
            <h2 className={cn("text-[16px] leading-snug", item.level === "goal" ? "font-display text-[22px]" : "font-semibold")}>{item.title}</h2>
            {item.description ? <p className="line-clamp-3 whitespace-pre-line text-[14px] text-muted">{item.description}</p> : null}
          </div>
          {!readOnly ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("menu", { code: item.code })}>
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[220px]">
                {next ? (
                  <DropdownMenuItem onSelect={() => onAdd(item)}>
                    <Plus size={15} />
                    {t("addChild", { level: tl(next) })}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => onAddIndicator(item)}>
                  <BarChart3 size={15} />
                  {t("addIndicator")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(item)}>
                  <Pencil size={15} />
                  {tc("edit")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem danger onSelect={() => trash("logframe", item.id, { title: `${item.code} ${item.title}` })}>
                  <Trash2 size={15} />
                  {tc("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {item.indicators.length ? (
          <ul className="-mx-1 flex flex-col">
            {item.indicators.map((i) => (
              <IndicatorLine key={i.id} i={i} />
            ))}
          </ul>
        ) : item.level !== "goal" ? (
          <p className="text-[13px] text-faint">{t("noIndicators")}</p>
        ) : null}

        {item.activities.length ? (
          <details className="group/acts">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-[13px] text-muted hover:text-ink">
              <ListTree size={14} />
              {t("activities", { count: item.activities.length })}
              {late ? (
                <span className="inline-flex items-center gap-1 font-medium text-overdue">
                  <AlertTriangle size={12} />
                  {t("late", { count: late })}
                </span>
              ) : null}
            </summary>
            <ul className="flex flex-col pt-1">
              {item.activities.map((a) => (
                <li key={a.id}>
                  <Link href={`/workplan?open=${a.id}`} className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-[14px] hover:bg-panel">
                    <span className="w-12 shrink-0 text-[13px] tabular-nums text-muted">{a.code}</span>
                    <span className={cn("min-w-0 flex-1", a.status === "done" && "text-muted line-through", a.status === "canceled" && "text-faint line-through")}>{a.title}</span>
                    <span className={cn("shrink-0 text-[12px] tabular-nums", a.late ? "font-medium text-overdue" : "text-muted")}>
                      {a.startDate ? formatDay(a.startDate, locale, true) : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      {item.children.length ? (
        <div className="flex flex-col gap-4">
          {item.children.map((c) => (
            <NodeBlock key={c.id} item={c} depth={depth + 1} readOnly={readOnly} onAdd={onAdd} onEdit={onEdit} onAddIndicator={onAddIndicator} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Mantıksal çerçeve (ActivityInfo): goal → outcomes → outputs, each with its indicators and activities. */
export function LogframeScreen({ data }: { data: LogframeData }) {
  const t = useTranslations("indicators");
  const tl = useTranslations("indicators.logframe");
  const tlv = useTranslations("indicators.levels");
  const shell = useShell();
  const readOnly = shell.readOnly;
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  const [indicatorFor, setIndicatorFor] = useState<string | null | undefined>(undefined);
  // The goal first, then outcomes and outputs that sit at the top (an imported workplan brings its outputs there).
  const roots = [...data.roots].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const all = flatten(roots);
  const codes = [...all.flatMap((n) => n.indicators.map((i) => i.code)), ...data.loose.indicators.map((i) => i.code)];
  const indicatorCount = codes.length;
  useScreenContext({ kind: "logframe", title: tl("title"), detail: `${all.length} logframe items, ${indicatorCount} indicators` });

  const add = (parent: LogframeItem | null, level?: LogframeLevel) => {
    const lv = level ?? (parent ? (childLevel(parent.level) ?? "output") : all.some((n) => n.level === "goal") ? "outcome" : "goal");
    setDraft({ parentId: parent?.id ?? null, level: lv, code: nextNodeCode(all, lv, parent), title: "", description: "" });
  };
  const goal = data.roots.find((r) => r.level === "goal");
  const tabs = [
    { key: "iptt", label: t("tabs.iptt"), href: "/indicators" },
    { key: "logframe", label: t("tabs.logframe"), href: "/indicators/logframe" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        subtitle={all.length ? tl("summary", { items: all.length, indicators: indicatorCount }) : tl("subtitle")}
        actions={
          !readOnly && all.length ? (
            <Button variant="outline" onClick={() => (goal ? add(goal) : add(null))} data-testid="lf-add">
              <Plus size={16} />
              {goal ? tl("addChild", { level: tlv("outcome") }) : tl("addRoot")}
            </Button>
          ) : null
        }
      />
      <SegmentedLinks items={tabs} active="logframe" />

      {all.length === 0 ? (
        <EmptyState
          icon={<Network size={22} />}
          title={tl("empty.title")}
          body={tl("empty.body")}
          action={
            !readOnly ? (
              <Button onClick={() => add(null, "goal")} data-testid="lf-add-goal">
                <Plus size={16} />
                {tl("empty.action")}
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-4" data-testid="logframe">
          {roots.map((r) => (
            <NodeBlock
              key={r.id}
              item={r}
              depth={0}
              readOnly={readOnly}
              onAdd={(p) => add(p)}
              onEdit={(n) => setDraft({ id: n.id, parentId: n.parentId, level: n.level, code: n.code, title: n.title, description: n.description ?? "" })}
              onAddIndicator={(n) => setIndicatorFor(n.id)}
            />
          ))}
        </div>
      )}

      {data.loose.indicators.length || data.loose.activities ? (
        <section className="flex flex-col gap-2" aria-labelledby="lf-loose">
          <h2 id="lf-loose" className="label-caps">
            {tl("loose")}
          </h2>
          {data.loose.indicators.length ? (
            <ul className="flex flex-col rounded-2xl border border-dashed border-line-strong p-1.5">
              {data.loose.indicators.map((i) => (
                <IndicatorLine key={i.id} i={i} />
              ))}
            </ul>
          ) : null}
          {data.loose.activities ? (
            <p className="text-[14px] text-muted">
              {tl("looseActivities", { count: data.loose.activities })}{" "}
              <Link href="/workplan?view=table" className="text-ink underline-offset-4 hover:underline">
                {tl("openWorkplan")}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {draft ? <NodeDialog key={draft.id ?? `${draft.parentId}:${draft.level}`} draft={draft} nodes={data.nodes} onClose={() => setDraft(null)} /> : null}
      {indicatorFor !== undefined ? (
        <IndicatorDialog open onOpenChange={(v) => !v && setIndicatorFor(undefined)} nodes={data.nodes} orgs={data.orgs} codes={codes} defaultNodeId={indicatorFor} />
      ) : null}
    </div>
  );
}
