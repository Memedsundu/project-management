"use client";

import {
  AlertCircle,
  CalendarClock,
  Check,
  ClipboardCopy,
  FileUp,
  Gavel,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/actions/suggestions";
import {
  addDecisionAction,
  followupEmailAction,
  saveAgendaAction,
  saveTranscriptAction,
  updateDecisionAction,
  updateMeetingAction,
  uploadTranscriptAction,
} from "@/app/(app)/meetings/actions";
import { setTaskDoneAction } from "@/app/(app)/tasks/actions";
import { useTrash } from "@/components/common/use-trash";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import { ExtractTasksDialog } from "@/components/tasks/extract-dialog";
import { InlineAdd } from "@/components/tasks/inline-add";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Chip } from "@/components/ui/controls";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { formatDay, relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { PartnerRef } from "@/lib/parse-task";
import { cn } from "@/lib/utils";
import type { AgendaItem, Contact, MeetingPageData, MeetingRecap, Org, PrepFacts, PrepItem } from "./types";

/* --------------------------------- Agenda --------------------------------- */

/** Fellow's agenda: tick items off in the meeting; open ones carry into the next one in a series. */
export function AgendaEditor({
  meetingId,
  initial,
  readOnly,
  templates,
}: {
  meetingId: string;
  initial: AgendaItem[];
  readOnly: boolean;
  templates: MeetingPageData["templates"];
}) {
  const t = useTranslations("meetings.agenda");
  const [items, setItems] = useState<AgendaItem[]>(initial);
  const [draft, setDraft] = useState("");
  const timer = useRef<number | null>(null);
  const latest = useRef(items);
  const addRef = useRef<HTMLInputElement>(null);

  const persist = (next: AgendaItem[], delay = 0) => {
    latest.current = next;
    setItems(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void runAction(saveAgendaAction(meetingId, latest.current), { silent: true });
    }, delay);
  };
  // A text edit still waiting to save goes out when she leaves the page.
  useEffect(
    () => () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        void saveAgendaAction(meetingId, latest.current);
      }
    },
    [meetingId],
  );

  const patch = (id: string, p: Partial<AgendaItem>, delay = 0) => persist(latest.current.map((x) => (x.id === id ? { ...x, ...p } : x)), delay);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const list = [...latest.current];
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    persist(list);
    requestAnimationFrame(() => document.getElementById(`agenda-${list[j]!.id}`)?.focus());
  };
  const add = (text: string) => {
    if (!text.trim()) return;
    persist([...latest.current, { id: crypto.randomUUID(), text: text.trim(), done: false, carriedFrom: null, notes: "" }]);
    setDraft("");
  };
  const done = items.filter((a) => a.done).length;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="agenda-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="agenda-title" className="label-caps">
          {t("title")}
        </h2>
        {items.length ? <span className="text-[13px] text-muted">{t("progress", { done, total: items.length })}</span> : null}
      </div>
      {items.length === 0 && !readOnly && templates.length ? (
        <div className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
          {t("fromTemplate")}
          {templates.map((tpl) => (
            <Chip
              key={tpl.id}
              onClick={() => persist(tpl.agenda.map((text) => ({ id: crypto.randomUUID(), text, done: false, carriedFrom: null, notes: "" })))}
            >
              {tpl.name}
            </Chip>
          ))}
        </div>
      ) : null}
      {items.length === 0 && readOnly ? <p className="text-[14px] text-muted">{t("empty")}</p> : null}
      <ol className="flex flex-col">
        {items.map((a, i) => (
          <li key={a.id} className="group flex items-start gap-3 border-b border-line-soft last:border-0">
            <Checkbox
              checked={a.done}
              disabled={readOnly}
              onCheckedChange={(v) => patch(a.id, { done: v === true })}
              aria-label={t("tick", { text: a.text })}
              className="mt-3"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <input
                id={`agenda-${a.id}`}
                value={a.text}
                readOnly={readOnly}
                onChange={(e) => patch(a.id, { text: e.target.value }, 700)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    move(i, e.key === "ArrowUp" ? -1 : 1);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    addRef.current?.focus();
                  } else if (e.key === "Backspace" && !a.text) {
                    e.preventDefault();
                    persist(latest.current.filter((x) => x.id !== a.id));
                    addRef.current?.focus();
                  }
                }}
                aria-label={t("item", { n: i + 1 })}
                className={cn("h-11 w-full bg-transparent text-[15px] outline-none", a.done && "text-muted line-through")}
              />
              {a.carriedFrom ? (
                <Link href={`/meetings/${a.carriedFrom}`} className="-mt-2 self-start pb-1.5 text-[12px] text-muted hover:text-ink">
                  {t("carried")}
                </Link>
              ) : null}
            </div>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => persist(latest.current.filter((x) => x.id !== a.id))}
                className="mt-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-panel hover:text-ink focus:opacity-100 group-hover:opacity-100"
                aria-label={t("remove", { text: a.text })}
              >
                <X size={15} />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {!readOnly ? (
        <form
          className="flex items-center gap-3 rounded-xl px-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
        >
          <Plus size={18} className="shrink-0 text-muted" />
          <input
            ref={addRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("addPlaceholder")}
            aria-label={t("add")}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </form>
      ) : null}
      {items.length > 1 && !readOnly ? <p className="text-[12px] text-faint">{t("reorderHint")}</p> : null}
    </section>
  );
}

/* ------------------------------ Recap review ------------------------------ */

type RecapPayload = {
  recap: MeetingRecap;
  tasks: { title: string; dueDate: string | null; ownerOrgId: string | null; ownerName: string | null }[];
};

/** Claude's recap as a proposal: she keeps the decisions and tasks she wants, nothing is saved before. */
export function RecapReview({ s, meetingId, readOnly, orgs }: { s: InboxSuggestion; meetingId: string; readOnly: boolean; orgs: Org[] }) {
  const t = useTranslations("meetings.recap");
  const tc = useTranslations("common");
  const locale = useLocale();
  const p = s.payload as RecapPayload;
  const [summary, setSummary] = useState(p.recap.summary);
  const [decisions, setDecisions] = useState(() => new Set(p.recap.decisions.map((_, i) => i)));
  const [tasks, setTasks] = useState(() => new Set(p.tasks.map((_, i) => i)));
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const orgName = (id: string | null) => (id ? (orgs.find((o) => o.id === id)?.shortName ?? orgs.find((o) => o.id === id)?.name ?? null) : null);
  const toggle = (set: Set<number>, i: number, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(i);
    else n.delete(i);
    return n;
  };
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

  const accept = async (decision: unknown) => {
    setBusy(true);
    const res = await runAction(acceptSuggestionAction(s.id, decision), { success: t("saved") });
    setBusy(false);
    return Boolean(res);
  };
  const reject = async () => {
    setBusy(true);
    await runAction(rejectSuggestionAction(s.id), { success: t("dropped") });
    setBusy(false);
  };

  return (
    <section id="recap-review" className="flex scroll-mt-6 flex-col gap-4 rounded-2xl border border-ink/70 px-5 py-4" aria-labelledby="recap-review-title">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="ai" size="sm">
          <Sparkles size={12} />
          {tc("aiSuggestion")}
        </Badge>
        <h2 id="recap-review-title" className="text-[16px] font-semibold">
          {t("reviewTitle")}
        </h2>
        <span className="flex-1" />
        <span className="text-[12px] text-faint">{relativeDayLabel(s.createdAt.slice(0, 10), locale)}</span>
      </header>
      <p className="-mt-2 text-[14px] text-muted">{t("reviewHint")}</p>

      <Field label={t("summary")} htmlFor="recap-summary">
        <Textarea id="recap-summary" value={summary} rows={4} disabled={readOnly} onChange={(e) => setSummary(e.target.value)} />
      </Field>

      {p.recap.decisions.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[14px] font-medium">{t("decisions")}</h3>
          <ul className="flex flex-col gap-1.5">
            {p.recap.decisions.map((d, i) => (
              <li key={i} className="flex items-start gap-3">
                <Checkbox checked={decisions.has(i)} disabled={readOnly} onCheckedChange={(v) => setDecisions((x) => toggle(x, i, v === true))} aria-label={d} className="mt-0.5" />
                <span className="text-[15px]">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.tasks.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[14px] font-medium">{t("actions")}</h3>
          <ul className="flex flex-col gap-1.5">
            {p.tasks.map((task, i) => (
              <li key={i} className="flex items-start gap-3">
                <Checkbox checked={tasks.has(i)} disabled={readOnly} onCheckedChange={(v) => setTasks((x) => toggle(x, i, v === true))} aria-label={task.title} className="mt-0.5" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px]">{task.title}</span>
                  <span className="text-[13px] text-muted">
                    {[orgName(task.ownerOrgId) ?? task.ownerName ?? t("me"), task.dueDate ? relativeDayLabel(task.dueDate, locale) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RecapLists recap={p.recap} />

      {!readOnly ? (
        <footer className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => accept({ summary: summary.trim() || p.recap.summary, decisions: sorted(decisions), actions: sorted(tasks) })}
            disabled={busy}
            data-testid="recap-accept"
          >
            <Check size={14} />
            {t("save", { decisions: decisions.size, tasks: tasks.size })}
          </Button>
          {p.tasks.length ? (
            <Button size="sm" variant="outline" onClick={() => setEdit(true)} disabled={busy}>
              <Pencil size={14} />
              {t("editTasks")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>
            <X size={14} />
            {tc("reject")}
          </Button>
        </footer>
      ) : null}

      <ExtractTasksDialog
        open={edit}
        onOpenChange={setEdit}
        title={t("editTasks")}
        proposals={p.tasks.map((x, i) => ({ ...x, keep: tasks.has(i) }))}
        source={{ type: "meeting", id: meetingId }}
        onAccept={async (kept) =>
          accept({
            summary: summary.trim() || p.recap.summary,
            decisions: sorted(decisions),
            tasks: kept.map((k) => ({ title: k.title, dueDate: k.dueDate ?? null, ownerOrgId: k.ownerOrgId ?? null, ownerName: k.ownerName ?? null })),
          })
        }
      />
    </section>
  );
}

function RecapLists({ recap }: { recap: Pick<MeetingRecap, "openQuestions" | "nextSteps"> }) {
  const t = useTranslations("meetings.recap");
  return (
    <>
      {recap.openQuestions.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium">{t("openQuestions")}</h3>
          <ul className="list-disc pl-5 text-[15px] marker:text-faint">
            {recap.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {recap.nextSteps.length ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium">{t("nextSteps")}</h3>
          <ul className="list-disc pl-5 text-[15px] marker:text-faint">
            {recap.nextSteps.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** The kept recap at the top of a finished meeting. */
export function RecapCard({
  recap,
  canFollowup,
  canRedo,
  busy,
  onFollowup,
  onRedo,
}: {
  recap: MeetingRecap;
  canFollowup: boolean;
  canRedo: boolean;
  busy: boolean;
  onFollowup: () => void;
  onRedo: () => void;
}) {
  const t = useTranslations("meetings.recap");
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-panel px-5 py-4" aria-labelledby="recap-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="recap-title" className="label-caps">
          {t("title")}
        </h2>
        <span className="flex-1" />
        {canFollowup ? (
          <Button size="sm" variant="outline" onClick={onFollowup}>
            <Mail size={14} />
            {t("followup")}
          </Button>
        ) : null}
        {canRedo ? (
          <Button size="sm" variant="ghost" onClick={onRedo} disabled={busy}>
            <RefreshCw size={14} />
            {t("again")}
          </Button>
        ) : null}
      </div>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{recap.summary}</p>
      <RecapLists recap={recap} />
    </section>
  );
}

/* ----------------------------- Follow-up email ----------------------------- */

function splitSubject(text: string) {
  const [first, ...rest] = text.split("\n");
  const m = /^(subject|konu)\s*:\s*(.*)$/i.exec(first ?? "");
  return m ? { subject: m[2]!.trim(), body: rest.join("\n").replace(/^\n+/, "") } : { subject: "", body: text };
}

/** Fellow's follow-up: Claude drafts, she edits and copies it into Outlook. The app never sends email. */
export function FollowupDialog({
  open,
  onOpenChange,
  meetingId,
  initial,
  defaultLanguage,
  aiReady,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meetingId: string;
  initial: string | null;
  defaultLanguage: "tr" | "en";
  aiReady: boolean;
}) {
  const t = useTranslations("meetings.followup");
  const tc = useTranslations("common");
  const [text, setText] = useState(initial ?? "");
  const [lang, setLang] = useState(defaultLanguage);
  const [busy, setBusy] = useState(false);
  const saved = useRef(initial ?? "");

  const draft = async () => {
    setBusy(true);
    const res = await runAction(followupEmailAction(meetingId, lang));
    setBusy(false);
    if (res) {
      setText(res.text);
      saved.current = res.text;
    }
  };
  const close = (v: boolean) => {
    if (!v && text !== saved.current) {
      saved.current = text;
      void runAction(updateMeetingAction(meetingId, { followupEmail: text.trim() || null }), { silent: true });
    }
    onOpenChange(v);
  };
  const { subject, body } = splitSubject(text);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title={t("title")} description={t("hint")} wide>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={lang} onChange={(e) => setLang(e.target.value as "tr" | "en")} className="h-10 w-auto" aria-label={t("language")}>
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
            </Select>
            {aiReady ? (
              <Button size="sm" variant={text ? "ghost" : "primary"} onClick={draft} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {text ? t("redraft") : t("draft")}
              </Button>
            ) : null}
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} placeholder={t("placeholder")} aria-label={t("title")} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {text.trim() ? (
              <>
                <Button variant="outline" asChild>
                  <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
                    <Mail size={16} />
                    {t("openInMail")}
                  </a>
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                      toast(tc("copied"));
                    } catch {
                      toast.error(tc("error"));
                    }
                  }}
                >
                  <ClipboardCopy size={16} />
                  {tc("copy")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- Prep ---------------------------------- */

/** Bullets and **bold** from Claude's short Markdown, nothing else. */
export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
  return (
    <ul className="flex flex-col gap-1.5 text-[14px] leading-snug">
      {lines.map((l, i) => {
        const bullet = /^[-*•]\s+/.test(l);
        return (
          <li key={i} className={cn(bullet && "relative pl-3.5 before:absolute before:left-0 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-ink/40")}>
            {inline(l.replace(/^[-*•]\s+/, "").replace(/^#+\s*/, ""))}
          </li>
        );
      })}
    </ul>
  );
}

function PrepList({ title, items, empty }: { title: string; items: React.ReactNode[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-medium text-muted">{title}</h3>
      {items.length ? <ul className="flex flex-col gap-1.5">{items}</ul> : <p className="text-[13px] text-faint">{empty}</p>}
    </div>
  );
}

function PrepTask({ item }: { item: PrepItem }) {
  const locale = useLocale();
  return (
    <li className="flex flex-col text-[14px] leading-snug">
      <Link href={`/tasks?open=${item.id}`} className="hover:underline">
        {item.title}
      </Link>
      {item.owner || item.dueDate ? (
        <span className={cn("text-[12px]", item.overdue ? "font-medium text-overdue" : "text-muted")}>
          {[item.owner, item.dueDate ? relativeDayLabel(item.dueDate, locale) : null].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </li>
  );
}

/** "Hazırlık": everything open with these partners, and Claude's five lines if she wants them. */
export function PrepPanel({
  prep,
  brief,
  aiReady,
  readOnly,
  busy,
  onBrief,
}: {
  prep: PrepFacts;
  brief: string | null;
  aiReady: boolean;
  readOnly: boolean;
  busy: boolean;
  onBrief: () => void;
}) {
  const t = useTranslations("meetings.prep");
  const locale = useLocale();
  const nothing = !prep.previous && !prep.openActions.length && !prep.waiting.length && !prep.myTasks.length && !prep.late.length && !prep.coming.length;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="prep-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="prep-title" className="label-caps">
          {t("title")}
        </h2>
        {aiReady && !readOnly && !nothing ? (
          <Button size="sm" variant={brief ? "ghost" : "outline"} onClick={onBrief} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : brief ? <RefreshCw size={14} /> : <Sparkles size={14} />}
            {brief ? t("refresh") : t("brief")}
          </Button>
        ) : null}
      </div>
      {brief ? (
        <div className="rounded-2xl bg-panel px-4 py-3">
          <MiniMarkdown text={brief} />
        </div>
      ) : null}
      {nothing ? <p className="text-[14px] text-muted">{t("nothing")}</p> : null}
      {prep.late.length ? (
        <PrepList
          title={t("late")}
          items={prep.late.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-[14px] leading-snug">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-overdue" />
              <Link href={`/partners/${r.orgId}`} className="hover:underline">
                {r.label}
                <span className="block text-[12px] font-medium text-overdue">{t("daysLate", { days: r.daysLate })}</span>
              </Link>
            </li>
          ))}
        />
      ) : null}
      {prep.previous ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-medium text-muted">{t("previous")}</h3>
          <Link href={`/meetings/${prep.previous.id}`} className="text-[14px] font-medium hover:underline">
            {prep.previous.title}
            <span className="ml-1.5 font-normal text-muted">{formatDay(prep.previous.startsAt.slice(0, 10), locale)}</span>
          </Link>
          {prep.previous.decisions.length ? (
            <ul className="flex flex-col gap-1">
              {prep.previous.decisions.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-[14px] leading-snug">
                  <Gavel size={13} className="mt-0.5 shrink-0 text-muted" />
                  {d.text}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <PrepList title={t("openActions")} items={prep.openActions.map((x) => <PrepTask key={x.id} item={x} />)} />
      <PrepList title={t("waiting")} items={prep.waiting.map((x) => <PrepTask key={x.id} item={x} />)} />
      <PrepList title={t("myTasks")} items={prep.myTasks.map((x) => <PrepTask key={x.id} item={x} />)} />
      <PrepList
        title={t("coming")}
        items={prep.coming.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-[14px] leading-snug">
            <CalendarClock size={14} className="mt-0.5 shrink-0 text-muted" />
            <Link href={c.href} className="hover:underline">
              <span className="tabular-nums text-muted">{formatDay(c.date, locale)}</span> {c.label}
            </Link>
          </li>
        ))}
      />
    </section>
  );
}

/* -------------------------------- Attendees -------------------------------- */

export function Attendees({
  meetingId,
  orgIds,
  contacts,
  contactIds,
  readOnly,
}: {
  meetingId: string;
  orgIds: string[];
  contacts: Contact[];
  contactIds: string[];
  readOnly: boolean;
}) {
  const t = useTranslations("meetings.attendees");
  const [ids, setIds] = useState(contactIds);
  const list = contacts.filter((c) => (c.organisationId && orgIds.includes(c.organisationId)) || contactIds.includes(c.id));
  if (!orgIds.length && !list.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="attendees-title">
      <h2 id="attendees-title" className="label-caps">
        {t("title")}
      </h2>
      {list.length ? (
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => {
            const on = ids.includes(c.id);
            return (
              <Chip
                key={c.id}
                active={on}
                aria-pressed={on}
                disabled={readOnly}
                title={c.role ?? undefined}
                onClick={() => {
                  const next = on ? ids.filter((x) => x !== c.id) : [...ids, c.id];
                  setIds(next);
                  void runAction(updateMeetingAction(meetingId, { contactIds: next }), { silent: true });
                }}
              >
                {on ? <Check size={13} /> : null}
                {c.name}
              </Chip>
            );
          })}
        </div>
      ) : (
        <p className="text-[13px] text-muted">
          {t("none")}{" "}
          {orgIds[0] ? (
            <Link href={`/partners/${orgIds[0]}`} className="underline underline-offset-4 hover:text-ink">
              {t("addOnPartner")}
            </Link>
          ) : null}
        </p>
      )}
    </section>
  );
}

/* -------------------------------- Decisions -------------------------------- */

export function DecisionsSection({ meetingId, decisions, readOnly }: { meetingId: string; decisions: MeetingPageData["decisions"]; readOnly: boolean }) {
  const t = useTranslations("meetings.decisions");
  const tc = useTranslations("common");
  const trash = useTrash();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="decisions-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="decisions-title" className="label-caps">
          {t("title")}
        </h2>
        <Link href="/meetings/decisions" className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
          {t("log")}
        </Link>
      </div>
      {decisions.length === 0 ? <p className="text-[14px] text-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col">
        {decisions.map((d) => (
          <li key={d.id} id={d.id} className="group flex items-start gap-3 border-b border-line-soft py-2 last:border-0">
            <Gavel size={15} className="mt-1 shrink-0 text-muted" />
            {editing?.id === d.id ? (
              <form
                className="flex flex-1 flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!editing.text.trim()) return;
                  const res = await runAction(updateDecisionAction(d.id, { text: editing.text.trim() }));
                  if (res !== undefined) setEditing(null);
                }}
              >
                <Textarea value={editing.text} onChange={(e) => setEditing({ id: d.id, text: e.target.value })} rows={2} autoFocus aria-label={t("edit")} />
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {tc("cancel")}
                  </Button>
                  <Button type="submit" size="sm">
                    {tc("save")}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="min-w-0 flex-1 text-[15px]">{d.text}</p>
            )}
            {!readOnly && editing?.id !== d.id ? (
              <span className="flex shrink-0 gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                  aria-label={t("edit")}
                  onClick={() => setEditing({ id: d.id, text: d.text })}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                  aria-label={tc("delete")}
                  onClick={() => trash("decision", d.id, { title: d.text.slice(0, 60) })}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {!readOnly ? (
        <form
          className="flex items-center gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim() || busy) return;
            setBusy(true);
            const res = await runAction(addDecisionAction({ meetingId, text: draft.trim() }));
            setBusy(false);
            if (res) setDraft("");
          }}
        >
          <Plus size={18} className="shrink-0 text-muted" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("addPlaceholder")}
            aria-label={t("add")}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </form>
      ) : null}
    </section>
  );
}

/* ---------------------------------- Tasks ---------------------------------- */

export function MeetingTasks({
  meetingId,
  tasks,
  orgIds,
  today,
  partners,
  readOnly,
}: {
  meetingId: string;
  tasks: MeetingPageData["tasks"];
  orgIds: string[];
  today: string;
  partners: PartnerRef[];
  readOnly: boolean;
}) {
  const t = useTranslations("meetings.tasks");
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-2" aria-labelledby="mtasks-title">
      <h2 id="mtasks-title" className="label-caps">
        {t("title")}
      </h2>
      {tasks.length === 0 ? <p className="text-[14px] text-muted">{t("empty")}</p> : null}
      <ul className="flex flex-col">
        {tasks.map((task) => {
          const done = task.status === "done";
          return (
            <li key={task.id} className="flex items-start gap-3 border-b border-line-soft py-2 last:border-0">
              <Checkbox
                round
                checked={done}
                disabled={readOnly || task.status === "canceled"}
                onCheckedChange={(v) => runAction(setTaskDoneAction(task.id, v === true))}
                aria-label={task.title}
                className="mt-0.5"
              />
              <Link href={`/tasks?open=${task.id}`} className={cn("min-w-0 flex-1 text-[15px] hover:underline", done && "text-muted line-through")}>
                {task.title}
              </Link>
              <span className="shrink-0 text-right text-[13px]">
                {task.owner ? <span className="text-muted">{task.owner}</span> : null}
                {task.dueDate ? (
                  <span className={cn("block", task.overdue && !done ? "font-medium text-overdue" : "text-muted")}>{relativeDayLabel(task.dueDate, locale)}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {!readOnly ? <InlineAdd today={today} partners={partners} defaults={{ orgIds, links: [{ type: "meeting", id: meetingId }] }} placeholder={t("addPlaceholder")} /> : null}
    </section>
  );
}

/* -------------------------------- Transcript -------------------------------- */

/** Granola: a Teams or Zoom transcript fills the gaps in her own notes. */
export function TranscriptSection({
  meetingId,
  transcript,
  readOnly,
  aiReady,
  busy,
  onMerge,
}: {
  meetingId: string;
  transcript: string | null;
  readOnly: boolean;
  aiReady: boolean;
  busy: boolean;
  onMerge: () => void;
}) {
  const t = useTranslations("meetings.transcript");
  const tc = useTranslations("common");
  const [show, setShow] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const speakers = transcript ? new Set(transcript.split("\n").map((l) => /^([^:]{2,60}):\s/.exec(l)?.[1]).filter(Boolean)).size : 0;

  const upload = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    setUploading(true);
    await runAction(uploadTranscriptAction(meetingId, form), { success: t("added") });
    setUploading(false);
  };
  const remove = async () => {
    const old = transcript;
    const res = await runAction(saveTranscriptAction(meetingId, null));
    if (res === undefined || !old) return;
    toast(t("removed"), {
      duration: 6000,
      action: { label: tc("undo"), onClick: () => void runAction(saveTranscriptAction(meetingId, old)) },
    });
  };

  if (!transcript && readOnly) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="transcript-title">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".vtt,.srt,.txt,.md,.docx,text/vtt,text/plain"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <h2 id="transcript-title" className="label-caps">
        {t("title")}
      </h2>
      {transcript ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-ink-2">{t("stats", { chars: transcript.length.toLocaleString(), speakers })}</span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setShow((v) => !v)} aria-expanded={show}>
              {show ? t("hide") : t("show")}
            </Button>
            {aiReady && !readOnly ? (
              <Button size="sm" onClick={onMerge} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {t("merge")}
              </Button>
            ) : null}
            {!readOnly ? (
              <Button size="icon-sm" variant="ghost" onClick={remove} aria-label={t("remove")}>
                <Trash2 size={15} />
              </Button>
            ) : null}
          </div>
          {show ? <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-panel p-4 font-sans text-[13px] leading-relaxed">{transcript}</pre> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-3">
          <p className="min-w-0 flex-1 text-[14px] text-muted">{t("hint")}</p>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
            {t("upload")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPaste(true)}>
            {t("paste")}
          </Button>
        </div>
      )}
      <Dialog open={paste} onOpenChange={setPaste}>
        <DialogContent title={t("pasteTitle")} description={t("pasteHint")} wide>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await runAction(saveTranscriptAction(meetingId, text), { success: t("added") });
              if (res) {
                setPaste(false);
                setText("");
              }
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} aria-label={t("pasteTitle")} autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPaste(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={!text.trim()}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Claude's merged notes, shown for review before they replace hers. */
export function MergeDialog({ markdown, onCancel, onApply }: { markdown: string; onCancel: () => void; onApply: (md: string) => Promise<boolean> }) {
  const t = useTranslations("meetings.transcript");
  const tc = useTranslations("common");
  const [text, setText] = useState(markdown);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent title={t("mergeTitle")} description={t("mergeHint")} wide>
        <div className="flex flex-col gap-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} className="font-mono text-[13px]" aria-label={t("mergeTitle")} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                await onApply(text);
                setBusy(false);
              }}
            >
              <Check size={16} />
              {t("apply")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

