"use client";

import { AlertTriangle, ArrowDown, ArrowUp, MoreHorizontal, PanelRightOpen, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { addDependencyAction, createActivityAction, removeDependencyAction, updateActivityAction } from "@/app/(app)/workplan/actions";
import { useTrash } from "@/components/common/use-trash";
import { DateButton } from "@/components/tasks/date-menu";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { PROVINCES } from "@/lib/provinces";
import { cn } from "@/lib/utils";
import { MultiPick } from "./pickers";
import { compareCodes, groupActivities, STATUSES, workingDays } from "./shared";
import type { ActivityItem, WorkplanData } from "./types";

type SortKey = "code" | "start" | "end" | "status";

/** One editable line: every change saves on its own, like a spreadsheet cell. */
function Row({ a, data, onOpen, readOnly }: { a: ActivityItem; data: WorkplanData; onOpen: (id: string) => void; readOnly: boolean }) {
  const t = useTranslations("workplan");
  const tc = useTranslations("common");
  const trash = useTrash();
  const [code, setCode] = useState(a.code);
  const [title, setTitle] = useState(a.title);
  const [progress, setProgress] = useState(String(a.progress));
  const [seen, setSeen] = useState(`${a.code}|${a.title}|${a.progress}`);
  const key = `${a.code}|${a.title}|${a.progress}`;
  if (seen !== key) {
    setSeen(key);
    setCode(a.code);
    setTitle(a.title);
    setProgress(String(a.progress));
  }
  const save = (patch: Parameters<typeof updateActivityAction>[1]) => runAction(updateActivityAction(a.id, patch));
  const others = data.activities.filter((o) => o.id !== a.id);
  const cell = "border-b border-line-soft px-1.5 py-1.5 align-middle";
  return (
    <tr className="group" data-testid="wp-table-row">
      <td className={cn(cell, "sticky left-0 z-[1] bg-bg pl-3")}>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onOpen(a.id)} aria-label={t("table.open", { code: a.code })} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink">
            <PanelRightOpen size={16} />
          </button>
          <input
            value={code}
            disabled={readOnly}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => code.trim() && code !== a.code && save({ code: code.trim() })}
            aria-label={t("table.code")}
            className="h-10 w-16 rounded-lg bg-transparent px-2 text-[14px] tabular-nums outline-none hover:bg-panel focus:bg-panel"
          />
        </div>
      </td>
      <td className={cell}>
        <div className="flex items-center gap-1.5">
          <input
            value={title}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== a.title && save({ title: title.trim() })}
            aria-label={t("table.title")}
            className={cn("h-10 w-full min-w-[260px] rounded-lg bg-transparent px-2 text-[14px] outline-none hover:bg-panel focus:bg-panel", a.status === "canceled" && "text-faint line-through")}
          />
          {a.late || a.atRisk ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-ink" title={a.late ? undefined : t("flags.atRisk")}>
              <AlertTriangle size={13} />
              {a.late ? t("flags.late") : t("flags.atRiskShort")}
            </span>
          ) : null}
        </div>
      </td>
      <td className={cell}>
        <Select value={a.logframeNodeId ?? ""} disabled={readOnly} onChange={(e) => save({ logframeNodeId: e.target.value || null })} aria-label={t("table.output")} className="h-10 w-[150px] text-[14px]">
          <option value="">—</option>
          {data.outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} {o.title}
            </option>
          ))}
        </Select>
      </td>
      <td className={cell}>
        <MultiPick
          label={t("table.partners")}
          options={data.orgs.map((o) => ({ id: o.id, label: o.shortName || o.name, hint: o.shortName ? o.name : null }))}
          value={a.orgIds}
          disabled={readOnly}
          placeholder={t("table.choose")}
          onToggle={(id, on) => save({ orgIds: on ? [...a.orgIds, id] : a.orgIds.filter((x) => x !== id) })}
          className="w-[150px]"
        />
      </td>
      <td className={cell}>
        <MultiPick
          label={t("table.provinces")}
          searchable
          options={[...new Set([...a.provinces, ...PROVINCES])].map((p) => ({ id: p, label: p }))}
          value={a.provinces}
          disabled={readOnly}
          placeholder={t("table.choose")}
          onToggle={(id, on) => save({ provinces: on ? [...a.provinces, id] : a.provinces.filter((x) => x !== id) })}
          className="w-[150px]"
        />
      </td>
      <td className={cell}>
        <DateButton value={a.startDate} onChange={(d) => save(a.isMilestone ? { startDate: d, endDate: d } : { startDate: d })} disabled={readOnly} className="w-[130px]" />
      </td>
      <td className={cell}>
        {a.isMilestone ? <span className="px-2 text-[13px] text-muted">{t("flags.milestone")}</span> : <DateButton value={a.endDate} onChange={(d) => save({ endDate: d })} disabled={readOnly} overdue={a.late} className="w-[130px]" />}
      </td>
      <td className={cn(cell, "whitespace-nowrap px-2 text-[13px] text-muted tabular-nums")}>{a.startDate && a.endDate ? t("table.workdays", { count: workingDays(a.startDate, a.endDate, data.holidays) }) : "—"}</td>
      <td className={cell}>
        <Select value={a.status} disabled={readOnly} onChange={(e) => save({ status: e.target.value as ActivityItem["status"] })} aria-label={t("table.status")} className="h-10 w-[140px] text-[14px]">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </td>
      <td className={cell}>
        <label className="flex h-10 w-[78px] items-center rounded-lg px-2 hover:bg-panel focus-within:bg-panel">
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={progress}
            disabled={readOnly}
            onChange={(e) => setProgress(e.target.value)}
            onBlur={() => {
              const n = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
              if (n !== a.progress) void save({ progress: n });
            }}
            aria-label={t("table.progress")}
            className="w-full bg-transparent text-right text-[14px] tabular-nums outline-none"
          />
          <span className="pl-0.5 text-[13px] text-muted">%</span>
        </label>
      </td>
      <td className={cell}>
        <MultiPick
          label={t("table.depends")}
          searchable
          options={others.map((o) => ({ id: o.id, label: o.code, hint: o.title }))}
          value={a.dependsOn}
          disabled={readOnly}
          placeholder={t("table.none")}
          onToggle={(id, on) => runAction(on ? addDependencyAction(a.id, id) : removeDependencyAction(a.id, id))}
          className="w-[120px]"
        />
      </td>
      <td className={cn(cell, "px-2")}>
        <button type="button" onClick={() => onOpen(a.id)} className="h-9 rounded-full px-2.5 text-[13px] text-muted tabular-nums hover:bg-panel hover:text-ink">
          {a.openTasks || "—"}
        </button>
      </td>
      <td className={cn(cell, "pr-3")}>
        {!readOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={tc("more")} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted opacity-60 hover:bg-panel hover:text-ink group-hover:opacity-100">
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => onOpen(a.id)}>
                <PanelRightOpen size={15} />
                {t("table.openShort")}
              </DropdownMenuItem>
              <DropdownMenuItem danger onSelect={() => trash("activity", a.id, { title: `${a.code} ${a.title}` })}>
                <Trash2 size={15} />
                {tc("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </td>
    </tr>
  );
}

/** "Tablo": the workplan as a spreadsheet, sorted and grouped like the timeline. */
export function ActivityTable({ data, onOpen, readOnly }: { data: WorkplanData; onOpen: (id: string) => void; readOnly: boolean }) {
  const t = useTranslations("workplan");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "code", dir: 1 });
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const sorted = useMemo(() => {
    const cmp = (a: ActivityItem, b: ActivityItem) => {
      if (sort.key === "code") return compareCodes(a.code, b.code) * sort.dir;
      if (sort.key === "status") return (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status)) * sort.dir || compareCodes(a.code, b.code);
      const av = sort.key === "start" ? a.startDate : a.endDate;
      const bv = sort.key === "start" ? b.startDate : b.endDate;
      if (av === bv) return compareCodes(a.code, b.code);
      if (!av) return 1;
      if (!bv) return -1;
      return av.localeCompare(bv) * sort.dir;
    };
    return data.activities.slice().sort(cmp);
  }, [data.activities, sort]);
  const groups = groupActivities(sorted, data.group, data.outputs, data.orgs, { noOutput: t("groups.noOutput"), noPartner: t("groups.noPartner"), all: t("groups.all") });

  const head = (key: SortKey | null, label: string, cls?: string) => (
    <th className={cn("label-caps whitespace-nowrap border-b border-line bg-bg px-2 py-2.5 text-left font-medium text-muted", cls)} aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {key ? (
        <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))} className="inline-flex items-center gap-1 uppercase hover:text-ink">
          {label}
          {sort.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
        </button>
      ) : (
        label
      )}
    </th>
  );

  async function add() {
    if (!title.trim()) return;
    const next = code.trim() || nextCode(data.activities.map((a) => a.code));
    // "2.5" belongs under output "2" when there is one.
    const prefix = next.includes(".") ? next.slice(0, next.lastIndexOf(".")) : null;
    const output = data.outputs.find((o) => o.code === prefix) ?? (data.outputs.length === 1 ? data.outputs[0] : undefined);
    const res = await runAction(createActivityAction({ code: next, title: title.trim(), logframeNodeId: output?.id ?? null }));
    if (res) {
      setCode("");
      setTitle("");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line" data-testid="wp-table">
      <div className="scrollbar-thin max-h-[calc(100dvh-240px)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[14px]">
          <thead className="sticky top-0 z-[2]">
            <tr>
              {head("code", t("table.code"), "sticky left-0 z-[3] pl-14")}
              {head(null, t("table.title"))}
              {head(null, t("table.output"))}
              {head(null, t("table.partners"))}
              {head(null, t("table.provinces"))}
              {head("start", t("table.start"))}
              {head("end", t("table.end"))}
              {head(null, t("table.duration"))}
              {head("status", t("table.status"))}
              {head(null, t("table.progress"))}
              {head(null, t("table.depends"))}
              {head(null, t("table.tasks"))}
              <th className="border-b border-line bg-bg" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.key} label={data.group === "none" ? null : g.label} count={g.items.length}>
                {g.items.map((a) => (
                  <Row key={`${g.key}-${a.id}`} a={a} data={data} onOpen={onOpen} readOnly={readOnly} />
                ))}
              </GroupRows>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("table.codePlaceholder")} aria-label={t("table.code")} className="h-10 w-24" />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("table.titlePlaceholder")} aria-label={t("table.title")} className="h-10 min-w-[200px] flex-1" data-testid="wp-table-add" />
          <Button type="submit" size="sm" variant="outline" disabled={!title.trim()}>
            <Plus size={15} />
            {t("table.add")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function GroupRows({ label, count, children }: { label: string | null; count: number; children: React.ReactNode }) {
  return (
    <>
      {label ? (
        <tr>
          <td colSpan={13} className="border-b border-line bg-bg-subtle px-3 py-2">
            <span className="sticky left-3 text-[13px] font-semibold">{label}</span>
            <span className="ml-2 text-[12px] text-faint">{count}</span>
          </td>
        </tr>
      ) : null}
      {children}
    </>
  );
}

/** The next free code after the highest one: 2.3 → 2.4, A7 → A8. */
export function nextCode(codes: string[]) {
  const last = codes.slice().sort(compareCodes).at(-1);
  if (!last) return "1.1";
  const m = /^(.*?)(\d+)$/.exec(last);
  if (!m) return `${last}.1`;
  let candidate = `${m[1]}${Number(m[2]) + 1}`;
  for (let i = 2; codes.includes(candidate); i++) candidate = `${m[1]}${Number(m[2]) + i}`;
  return candidate;
}
