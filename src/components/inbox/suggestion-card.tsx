"use client";

import { ArrowRight, Check, FolderPlus, Pencil, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/actions/suggestions";
import { ExtractTasksDialog, type Proposal } from "@/components/tasks/extract-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";

export type InboxSuggestion = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  createdAt: string;
  source: { type: string; id: string; title: string; href: string } | null;
  payload: unknown;
  /** Server-made text for kinds whose payload holds only ids (links). */
  display?: string | null;
};

type TaskPayload = { tasks: Proposal[] };
type OrganizePayload = {
  newFolders: { key: string; name: string }[];
  items: { documentId: string; currentTitle: string; title: string | null; target: { folderId: string | null } | { newFolderKey: string } | null; reason: string }[];
  duplicates: { documentIds: string[]; reason: string }[];
};
type IndicatorPayload = { values: { indicatorLabel: string; periodLabel: string; value: number; disaggregation: Record<string, string> | null; page: number | null; quote: string }[]; notes: string; documentId: string };

type MemoryPayload = { lines: string[]; terms: { tr: string; en: string; note?: string | null }[] };

/** One Claude proposal in Gelen kutusu. Nothing changes until she accepts. */
export function SuggestionCard({
  s,
  readOnly,
  folderNames,
  onDone,
}: {
  s: InboxSuggestion;
  readOnly: boolean;
  folderNames: Record<string, string>;
  /** Called after she accepts or rejects (the assistant panel keeps a short note in place). */
  onDone?: (status: "accepted" | "rejected") => void;
}) {
  const t = useTranslations("inbox");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(allIndexes(s)));

  if (gone) return null;

  const accept = async (decision?: unknown) => {
    setBusy(true);
    const res = await runAction(acceptSuggestionAction(s.id, decision), { success: t("accepted") });
    setBusy(false);
    if (res) {
      setGone(true);
      onDone?.("accepted");
    }
    return Boolean(res);
  };
  const reject = async () => {
    setBusy(true);
    const res = await runAction(rejectSuggestionAction(s.id));
    setBusy(false);
    if (res !== undefined) {
      setGone(true);
      onDone?.("rejected");
    }
  };
  const toggle = (i: number, v: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (v) n.add(i);
      else n.delete(i);
      return n;
    });

  let body: React.ReactNode = null;
  let primary: React.ReactNode = (
    <Button size="sm" onClick={() => accept()} disabled={busy || readOnly}>
      <Check size={14} />
      {tc("accept")}
    </Button>
  );

  if (s.kind === "tasks" || s.kind === "key_dates" || s.kind === "workplan") {
    const tasks = (s.payload as TaskPayload).tasks ?? [];
    body = (
      <ul className="flex flex-col gap-1">
        {tasks.map((task, i) => (
          <li key={i} className="flex items-start gap-3">
            <Checkbox checked={picked.has(i)} onCheckedChange={(v) => toggle(i, v === true)} disabled={readOnly} aria-label={task.title} className="mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px]">{task.title}</span>
              <span className="text-[13px] text-muted">
                {[task.dueDate ? relativeDayLabel(task.dueDate, locale) : null, task.ownerName].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
    primary = (
      <>
        <Button size="sm" onClick={() => accept({ indexes: [...picked].sort((a, b) => a - b) })} disabled={busy || readOnly || picked.size === 0}>
          <Check size={14} />
          {t("addTasks", { count: picked.size })}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={busy || readOnly}>
          <Pencil size={14} />
          {t("editFirst")}
        </Button>
      </>
    );
  } else if (s.kind === "organize") {
    const p = s.payload as OrganizePayload;
    const newName = (key: string) => p.newFolders.find((f) => f.key === key)?.name ?? key;
    body = (
      <div className="flex flex-col gap-3">
        {p.newFolders.length ? (
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] text-muted">
            <FolderPlus size={14} />
            {t("organize.newFolders")}: {p.newFolders.map((f) => f.name).join(", ")}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {p.items.map((item, i) => (
            <li key={item.documentId} className="flex items-start gap-3">
              <Checkbox checked={picked.has(i)} onCheckedChange={(v) => toggle(i, v === true)} disabled={readOnly} aria-label={item.currentTitle} className="mt-0.5" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px]">
                  {item.title ? (
                    <>
                      <span className="text-muted line-through">{item.currentTitle}</span> <ArrowRight size={12} className="inline" /> {item.title}
                    </>
                  ) : (
                    item.currentTitle
                  )}
                </span>
                <span className="text-[13px] text-muted">
                  {item.target ? `${t("organize.moveTo")} ${"newFolderKey" in item.target ? newName(item.target.newFolderKey) : (folderNames[item.target.folderId ?? ""] ?? t("organize.root"))} · ` : ""}
                  {item.reason}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {p.duplicates.length ? (
          <div className="rounded-xl bg-panel px-3 py-2 text-[13px] text-ink-2">
            <strong className="font-semibold">{t("organize.duplicates")}</strong> {p.duplicates.map((d) => d.reason).join(" · ")}
          </div>
        ) : null}
      </div>
    );
    primary = (
      <Button size="sm" onClick={() => accept({ indexes: [...picked].sort((a, b) => a - b) })} disabled={busy || readOnly || picked.size === 0}>
        <Check size={14} />
        {t("organize.apply", { count: picked.size })}
      </Button>
    );
  } else if (s.kind === "indicator_values") {
    const p = s.payload as IndicatorPayload;
    body = (
      <div className="flex flex-col gap-2">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th className="w-8 py-1" />
                <th className="py-1 pr-3 font-medium">{t("values.indicator")}</th>
                <th className="py-1 pr-3 font-medium">{t("values.period")}</th>
                <th className="py-1 pr-3 text-right font-medium">{t("values.value")}</th>
                <th className="py-1 font-medium">{t("values.source")}</th>
              </tr>
            </thead>
            <tbody>
              {p.values.map((v, i) => (
                <tr key={i} className="border-t border-line-soft align-top">
                  <td className="py-1.5">
                    <Checkbox checked={picked.has(i)} onCheckedChange={(x) => toggle(i, x === true)} disabled={readOnly} aria-label={v.indicatorLabel} />
                  </td>
                  <td className="py-1.5 pr-3">
                    {v.indicatorLabel}
                    {v.disaggregation ? <span className="block text-[12px] text-muted">{Object.entries(v.disaggregation).map(([k, g]) => `${k}: ${g}`).join(", ")}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3">{v.periodLabel}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{v.value.toLocaleString(locale === "en" ? "en-GB" : "tr-TR")}</td>
                  <td className="py-1.5 text-[13px] text-muted">
                    {v.page ? (
                      <Link href={`/files/d/${p.documentId}?page=${v.page}`} className="underline-offset-4 hover:underline">
                        {t("values.page", { page: v.page })}
                      </Link>
                    ) : null}
                    {v.quote ? <span className="block italic">“{v.quote}”</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.notes ? <p className="text-[13px] text-muted">{p.notes}</p> : null}
      </div>
    );
    primary = (
      <Button size="sm" onClick={() => accept({ indexes: [...picked].sort((a, b) => a - b) })} disabled={busy || readOnly || picked.size === 0}>
        <Check size={14} />
        {t("values.approve", { count: picked.size })}
      </Button>
    );
  } else if (s.kind === "note") {
    const p = s.payload as { title: string; markdown: string };
    body = <p className="line-clamp-4 whitespace-pre-line text-[14px] text-ink-2">{p.markdown}</p>;
  } else if (s.kind === "link") {
    body = s.display ? <p className="text-[14px] text-ink-2">{s.display}</p> : null;
  } else if (s.kind === "agenda") {
    const items = (s.payload as { items?: string[] }).items ?? [];
    body = (
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <Checkbox checked={picked.has(i)} onCheckedChange={(v) => toggle(i, v === true)} disabled={readOnly} aria-label={item} className="mt-0.5" />
            <span className="text-[15px]">{item}</span>
          </li>
        ))}
      </ul>
    );
    primary = (
      <Button size="sm" onClick={() => accept({ items: items.filter((_, i) => picked.has(i)) })} disabled={busy || readOnly || picked.size === 0}>
        <Check size={14} />
        {t("agenda.add", { count: picked.size })}
      </Button>
    );
  } else if (s.kind === "memory") {
    const p = s.payload as MemoryPayload;
    const rows = [...(p.lines ?? []).map((l) => ({ main: l, sub: null as string | null })), ...(p.terms ?? []).map((term) => ({ main: `${term.tr} = ${term.en}`, sub: term.note ?? t("memory.term") }))];
    body = (
      <ul className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-3">
            <Checkbox checked={picked.has(i)} onCheckedChange={(v) => toggle(i, v === true)} disabled={readOnly} aria-label={r.main} className="mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px]">{r.main}</span>
              {r.sub ? <span className="text-[13px] text-muted">{r.sub}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    );
    primary = (
      <Button size="sm" onClick={() => accept({ indexes: [...picked].sort((a, b) => a - b) })} disabled={busy || readOnly || picked.size === 0}>
        <Check size={14} />
        {t("memory.add")}
      </Button>
    );
  } else if (s.kind === "meeting_recap" && s.source) {
    primary = (
      <Button size="sm" asChild>
        <Link href={s.source.href}>{t("reviewInMeeting")}</Link>
      </Button>
    );
  }

  return (
    <article id={`s-${s.id}`} className="flex flex-col gap-3 rounded-2xl border border-line px-5 py-4">
      <header className="flex flex-wrap items-start gap-2">
        <Badge variant="ai" size="sm">
          <Sparkles size={12} />
          {t(`kinds.${kindKey(s.kind)}`)}
        </Badge>
        <span className="flex-1" />
        <span className="text-[12px] text-faint">{relativeDayLabel(s.createdAt.slice(0, 10), locale)}</span>
      </header>
      <div className="flex flex-col gap-1">
        <h3 className="text-[16px] font-semibold leading-snug">{s.title}</h3>
        {s.summary ? <p className="text-[14px] text-muted">{s.summary}</p> : null}
        {s.source ? (
          <Link href={s.source.href} className="self-start text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
            {t("from", { title: s.source.title })}
          </Link>
        ) : null}
      </div>
      {body}
      {!readOnly ? (
        <footer className={cn("flex flex-wrap gap-2 pt-1")}>
          {primary}
          <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>
            <X size={14} />
            {tc("reject")}
          </Button>
        </footer>
      ) : null}
      {s.kind === "tasks" || s.kind === "key_dates" || s.kind === "workplan" ? (
        <ExtractTasksDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title={s.title}
          proposals={((s.payload as TaskPayload).tasks ?? []).map((p, i) => ({ ...p, keep: picked.has(i) }))}
          source={s.source ? { type: s.source.type as EntityType, id: s.source.id } : null}
          onAccept={async (kept) => accept({ tasks: kept })}
        />
      ) : null}
    </article>
  );
}

function allIndexes(s: InboxSuggestion) {
  const p = s.payload as { tasks?: unknown[]; items?: unknown[]; values?: unknown[]; lines?: unknown[]; terms?: unknown[] };
  const n = s.kind === "memory" ? (p?.lines?.length ?? 0) + (p?.terms?.length ?? 0) : (p?.tasks?.length ?? p?.items?.length ?? p?.values?.length ?? 0);
  return Array.from({ length: n }, (_, i) => i);
}

function kindKey(kind: string) {
  return ["tasks", "key_dates", "workplan", "organize", "indicator_values", "note", "link", "meeting_recap", "agenda", "classification", "memory"].includes(kind) ? kind : "other";
}
