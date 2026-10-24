"use client";

import { ArrowUp, Copy, Filter, Loader2, Lock, MoreHorizontal, NotebookPen, Pencil, Pin, PinOff, Plus, Search, Sparkles, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addToCollectionAction, askCollectionAction, removeFromCollectionAction, saveAnswerAsNoteAction, updateCollectionAction } from "@/app/(app)/collections/actions";
import { deleteAskAction, saveAskAction } from "@/app/(app)/search/actions";
import { CitedText, plainCited, SourceList } from "@/components/common/cited-text";
import { EntityIcon } from "@/components/common/entity-icon";
import { EntityPicker } from "@/components/common/entity-picker";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tip } from "@/components/ui/overlay";
import { dayOf, formatDateTime, formatDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";
import type { CollectionPageData } from "@/server/views/collections";
import { CollectionDialog } from "./collection-dialog";
import { StudioPane, useNoteToast } from "./studio-pane";

type Item = CollectionPageData["items"][number];
type Thread = CollectionPageData["threads"][number];
type Pane = "sources" | "chat" | "studio";

/** What she can put in a collection; folders and other collections stay out. */
const SOURCE_TYPES: EntityType[] = ["document", "note", "meeting", "decision", "task", "activity", "indicator", "organisation", "series"];
const keyOf = (i: { type: string; id: string }) => `${i.type}:${i.id}`;

/** The smart filter in words: “rapor” · Belgeler · KÇD · 1 Tem 2026 sonrası. */
function SmartSummary({ data, onEdit }: { data: CollectionPageData; onEdit?: () => void }) {
  const t = useTranslations("collections.page");
  const tk = useTranslations("common.kindsPlural");
  const locale = useLocale();
  const f = data.smartFilter;
  if (!f) return null;
  const org = f.orgId ? data.options.orgs.find((o) => o.id === f.orgId) : null;
  const docType = f.docType ? data.options.docTypes.find((d) => d.key === f.docType) : null;
  const tag = f.tag ? data.options.tags.find((x) => x.slug === f.tag) : null;
  const parts = [
    f.q ? `“${f.q}”` : null,
    f.types?.length ? f.types.map((x) => tk(x as "task")).join(", ") : null,
    org ? org.shortName || org.name : null,
    docType ? (locale === "en" ? docType.en : docType.tr) : null,
    tag ? `#${tag.name}` : null,
    f.from && f.to ? `${formatDay(f.from, locale, true)} – ${formatDay(f.to, locale, true)}` : f.from ? t("after", { date: formatDay(f.from, locale, true) }) : f.to ? t("before", { date: formatDay(f.to, locale, true) }) : null,
  ].filter(Boolean);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted" data-testid="smart-summary">
      <Filter size={14} className="shrink-0" />
      <span className="font-medium text-ink-2">{t("smart")}</span>
      <span>{parts.join(" · ")}</span>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="text-ink underline-offset-2 hover:underline">
          {t("editFilter")}
        </button>
      ) : null}
    </p>
  );
}

/** The switch between Kaynaklar and Çıktılar when only one side column fits (laptop widths). */
function SideSwitch({ value, onChange, counts }: { value: "sources" | "studio"; onChange: (v: "sources" | "studio") => void; counts: { sources: number; studio: number } }) {
  const t = useTranslations("collections.page.tabs");
  return (
    <div className="hidden gap-1 lg:flex 2xl:hidden" role="tablist" aria-label={t("label")}>
      {(["sources", "studio"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors", value === k ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
        >
          {t(k)}
          {counts[k] ? <span className={cn("text-[12px]", value === k ? "text-on-ink/70" : "text-faint")}>{counts[k]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** "Kaynaklar": what is in the collection. The ticked ones are what Claude reads (NotebookLM). */
function SourcesPane({
  data,
  deselected,
  setDeselected,
  className,
  switcher,
}: {
  data: CollectionPageData;
  deselected: Set<string>;
  setDeselected: (s: Set<string>) => void;
  className?: string;
  switcher?: React.ReactNode;
}) {
  const t = useTranslations("collections.sources");
  const tk = useTranslations("common.kinds");
  const tc = useTranslations("common");
  const shell = useShell();
  const [q, setQ] = useState("");
  const readable = data.items.filter((i) => !i.aiOff);
  const chosen = readable.filter((i) => !deselected.has(keyOf(i)));
  const offCount = data.items.length - readable.length;
  const needle = q.trim().toLocaleLowerCase("tr");
  const shown = needle ? data.items.filter((i) => i.title.toLocaleLowerCase("tr").includes(needle)) : data.items;
  const all = chosen.length === readable.length;

  const remove = async (item: Item) => {
    const res = await runAction(removeFromCollectionAction(data.id, { type: item.type, id: item.id }));
    if (res === undefined) return;
    toast(t("removed", { title: item.title }), {
      duration: 6000,
      action: { label: tc("undo"), onClick: () => runAction(addToCollectionAction(data.id, [{ type: item.type, id: item.id }])) },
    });
  };

  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)} aria-labelledby="c-sources-h">
      {switcher}
      <div className="flex items-center justify-between gap-2">
        <h2 id="c-sources-h" className={cn("label-caps", switcher && "lg:sr-only 2xl:not-sr-only")}>
          {t("title", { count: data.items.length })}
        </h2>
        {!shell.readOnly ? (
          <EntityPicker
            types={SOURCE_TYPES}
            keepOpen
            align="end"
            placeholder={t("addPlaceholder")}
            exclude={data.items.map(keyOf)}
            onPick={async (item) => {
              await runAction(addToCollectionAction(data.id, [{ type: item.type, id: item.id }]), { success: t("added", { title: item.title }) });
            }}
            trigger={
              <Button variant="outline" size="sm" className="h-9" data-testid="source-add">
                <Plus size={15} />
                {t("add")}
              </Button>
            }
          />
        ) : null}
      </div>

      {data.items.length === 0 ? (
        <p className="text-[14px] text-muted">{data.smartFilter ? t("emptySmart") : t("empty")}</p>
      ) : (
        <>
          {data.items.length > 8 ? (
            <label className="flex items-center gap-2 rounded-full border border-line-strong px-3 focus-within:border-ink">
              <Search size={15} className="shrink-0 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filter")} aria-label={t("filter")} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
            </label>
          ) : null}
          {data.aiReady && readable.length > 1 && !needle ? (
            <label className="flex min-h-9 items-center gap-2.5 px-2 text-[13px] text-muted">
              <Checkbox
                checked={all ? true : chosen.length ? "indeterminate" : false}
                onCheckedChange={() => setDeselected(all ? new Set(readable.map(keyOf)) : new Set())}
                data-testid="source-all"
              />
              {all ? t("allChosen") : t("someChosen", { count: chosen.length, total: readable.length })}
            </label>
          ) : null}
          <ul className="scrollbar-thin flex flex-col 2xl:max-h-[calc(100dvh-280px)] 2xl:overflow-y-auto" data-testid="source-list">
            {shown.map((item) => {
              const key = keyOf(item);
              const on = !item.aiOff && !deselected.has(key);
              return (
                <li key={key} className="group flex min-h-10 items-center gap-2.5 rounded-xl px-2 hover:bg-panel" data-testid="source-row">
                  {data.aiReady ? (
                    <Checkbox
                      checked={on}
                      disabled={item.aiOff}
                      onCheckedChange={(v) => {
                        const next = new Set(deselected);
                        if (v) next.delete(key);
                        else next.add(key);
                        setDeselected(next);
                      }}
                      aria-label={t("use", { title: item.title })}
                    />
                  ) : null}
                  <EntityIcon type={item.type} size={15} className="shrink-0 text-muted" />
                  <Link href={item.href} className={cn("min-w-0 flex-1 truncate py-2 text-[14px] hover:underline", !on && data.aiReady && "text-muted")} title={`${tk(item.type as "task")}: ${item.title}`}>
                    {item.title}
                  </Link>
                  {item.aiOff ? (
                    <Tip content={t("aiOff")}>
                      <span className="inline-flex text-muted" aria-label={t("aiOff")}>
                        <Lock size={13} />
                      </span>
                    </Tip>
                  ) : null}
                  {item.source === "smart" ? (
                    <Tip content={t("fromFilter")}>
                      <span className="inline-flex text-faint" aria-label={t("fromFilter")}>
                        <Filter size={13} />
                      </span>
                    </Tip>
                  ) : !shell.readOnly ? (
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      aria-label={t("remove", { title: item.title })}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-ink focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                      data-testid="source-remove"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </li>
              );
            })}
            {needle && shown.length === 0 ? <li className="px-2 py-2 text-[14px] text-muted">{tc("noResults")}</li> : null}
          </ul>
          {offCount ? <p className="text-[13px] text-muted">{t("offNote", { count: offCount })}</p> : null}
        </>
      )}
    </section>
  );
}

/** One question and Claude's answer, with the sources it used in one line each. */
function ChatAnswer({ thread, index, onDeleted }: { thread: Thread; index: number; onDeleted: (id: string) => void }) {
  const t = useTranslations("collections.chat");
  const ta = useTranslations("search.ask");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const noteToast = useNoteToast();
  const [saved, setSaved] = useState(thread.saved);
  const prefix = `t${index}-`;
  return (
    <li className="flex scroll-mt-24 flex-col gap-3" id={`q-${thread.id}`} data-testid="chat-answer">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-[18px] font-semibold leading-snug">{thread.question}</h3>
        <span className="-mt-1 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={saved ? ta("unsave") : ta("save")}
            aria-pressed={saved}
            onClick={async () => {
              const res = await runAction(saveAskAction(thread.id, !saved), { success: saved ? ta("unsaved") : ta("savedToast") });
              if (res !== undefined) setSaved(!saved);
            }}
          >
            <Star size={15} className={saved ? "fill-ink" : ""} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tc("copy")}
            onClick={async () => {
              await navigator.clipboard.writeText(plainCited(thread.answer, thread.citations, { heading: thread.question, page: (page) => ta("page", { page }) }));
              toast(tc("copied"));
            }}
          >
            <Copy size={15} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={ta("menu")}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {!shell.readOnly ? (
                <DropdownMenuItem
                  onSelect={async () => {
                    const res = await runAction(saveAnswerAsNoteAction(thread.id));
                    if (res) noteToast(res.id);
                  }}
                >
                  <NotebookPen size={15} />
                  {t("saveAsNote")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                danger
                onSelect={async () => {
                  const res = await runAction(deleteAskAction(thread.id), { success: ta("deleted") });
                  if (res !== undefined) onDeleted(thread.id);
                }}
              >
                <Trash2 size={15} />
                {ta("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <CitedText text={thread.answer} citations={thread.citations} idPrefix={prefix} className="text-[15.5px]" />
      {thread.citations.length ? (
        <div className="flex flex-col gap-1 rounded-2xl border border-line-soft px-2 py-2">
          <p id={`${prefix}h`} className="label-caps px-1.5 pb-0.5">
            {ta("sources")}
          </p>
          <SourceList citations={thread.citations} idPrefix={prefix} headingId={`${prefix}h`} compact />
        </div>
      ) : (
        <p className="text-[13px] text-muted">{ta("noCitations")}</p>
      )}
      <p className="text-[12px] text-faint">{formatDateTime(thread.createdAt, locale)}</p>
    </li>
  );
}

/** "Sohbet": questions answered only from the ticked sources, kept like NotebookLM's chat. */
function ChatPane({ data, refs, usable, className, onShowSources }: { data: CollectionPageData; refs: { type: EntityType; id: string }[] | undefined; usable: number; className?: string; onShowSources: () => void }) {
  const t = useTranslations("collections.chat");
  const ta = useTranslations("search.ask");
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [nothing, setNothing] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Thread[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);
  const threads = [...data.threads, ...fresh.filter((f) => !data.threads.some((x) => x.id === f.id))].filter((x) => !gone.has(x.id));
  const examples = [t("examples.0"), t("examples.1"), t("examples.2")];
  const total = data.items.filter((i) => !i.aiOff).length;

  useEffect(() => {
    if (pending) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pending]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (q.length < 3 || pending || !usable) return;
    setPending(q);
    setNothing(null);
    const res = await runAction(askCollectionAction(data.id, q, refs));
    setPending(null);
    if (!res) return;
    if (!res.thread) {
      setNothing(q);
      return;
    }
    const thread = res.thread;
    setQuestion("");
    setFresh((f) => [...f, thread]);
    router.refresh();
    window.setTimeout(() => document.getElementById(`q-${thread.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };

  return (
    <section className={cn("flex min-w-0 flex-col gap-6", className)} aria-labelledby="c-chat-h">
      <h2 id="c-chat-h" className="sr-only">
        {t("title")}
      </h2>
      {!data.aiReady ? (
        <EmptyState title={ta("notConnectedTitle")} body={t("notConnectedBody")} icon={<Sparkles size={22} />} />
      ) : threads.length === 0 && !pending ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-panel px-5 py-5">
          <p className="font-display text-[26px] leading-tight">{t("introTitle")}</p>
          <p className="max-w-[60ch] text-[15px] text-ink-2">{data.items.length ? t("introBody", { count: total }) : t("introEmpty")}</p>
          {data.items.length ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {examples.map((ex) => (
                <button key={ex} type="button" onClick={() => setQuestion(ex)} className="rounded-2xl border border-line-strong bg-bg px-3.5 py-2 text-left text-[14px] hover:border-ink">
                  {ex}
                </button>
              ))}
            </div>
          ) : (
            <Button variant="outline" className="self-start lg:hidden" onClick={onShowSources}>
              <Plus size={15} />
              {t("goAdd")}
            </Button>
          )}
        </div>
      ) : null}

      {threads.length || pending ? (
        <ol className="flex flex-col gap-10">
          {threads.map((th, i) => (
            <ChatAnswer key={th.id} thread={th} index={i} onDeleted={(id) => setGone((g) => new Set(g).add(id))} />
          ))}
          {pending ? (
            <li className="flex flex-col gap-3" aria-live="polite">
              <h3 className="text-[18px] font-semibold leading-snug">{pending}</h3>
              <p className="flex items-center gap-2 text-[14px] text-muted">
                <Loader2 size={15} className="animate-spin" />
                {t("reading", { count: usable })}
              </p>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-[92%]" />
                <Skeleton className="h-4 w-[80%]" />
                <Skeleton className="h-4 w-[55%]" />
              </div>
            </li>
          ) : null}
        </ol>
      ) : null}
      {nothing ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-3 text-[14px] text-muted" aria-live="polite">
          {t("nothing", { question: nothing })}
        </p>
      ) : null}
      <div ref={endRef} />

      {data.aiReady ? (
        <form
          className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 rounded-3xl border border-line-strong bg-bg px-4 pb-3 pt-3 shadow-[var(--shadow)] focus-within:border-ink lg:bottom-6"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(question);
              }
            }}
            rows={2}
            maxLength={1000}
            disabled={!usable}
            placeholder={usable ? t("placeholder") : t("placeholderEmpty")}
            aria-label={t("placeholder")}
            className="w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed"
            data-testid="chat-input"
          />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{usable === total ? t("usingAll", { count: total }) : t("usingSome", { count: usable, total })}</span>
            <Button type="submit" size="icon" className="size-10 shrink-0" disabled={question.trim().length < 3 || Boolean(pending) || !usable} aria-label={ta("ask")} data-testid="chat-send">
              {pending ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/**
 * One collection as a NotebookLM notebook: sources on the left, the chat in
 * the middle, Studio outputs on the right. A phone shows one at a time.
 */
export function CollectionPage({ data }: { data: CollectionPageData }) {
  const t = useTranslations("collections");
  const tp = useTranslations("collections.page");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const trash = useTrash();
  const [pane, setPane] = useState<Pane>(data.items.length ? "chat" : "sources");
  const [side, setSide] = useState<"sources" | "studio">("sources");
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);
  useScreenContext({ kind: "collection", id: data.id, title: data.name });

  const readable = data.items.filter((i) => !i.aiOff);
  const chosen = readable.filter((i) => !deselected.has(keyOf(i)));
  // Nothing unticked: send no list, and the server reads every item.
  const refs = useMemo(() => (chosen.length === readable.length ? undefined : chosen.map((i) => ({ type: i.type, id: i.id }))), [chosen, readable.length]);
  const counts = { sources: data.items.length, studio: data.outputs.length };
  const switcher = <SideSwitch value={side} onChange={setSide} counts={counts} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        compact
        eyebrow={
          <Link href="/collections" className="hover:underline">
            {t("title")}
          </Link>
        }
        title={data.name}
        subtitle={data.description ?? undefined}
        actions={
          !shell.readOnly ? (
            <>
              <Button variant="outline" onClick={() => runAction(updateCollectionAction(data.id, { pinned: !data.pinned }), { success: data.pinned ? t("unpinned") : t("pinnedToast") })} aria-pressed={data.pinned} data-testid="collection-pin">
                {data.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                {data.pinned ? t("unpin") : t("pin")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={tp("menu")}>
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil size={15} />
                    {t("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onSelect={() => trash("collection", data.id, { title: data.name, redirectTo: "/collections" })}>
                    <Trash2 size={15} />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />
      <div className="-mt-2 flex flex-col gap-2">
        <SmartSummary data={data} onEdit={shell.readOnly ? undefined : () => setEditing(true)} />
        <p className="text-[13px] text-muted">
          {tp("updated", { date: formatDay(dayOf(data.updatedAt), locale, true) })}
          {data.items.length ? ` · ${tp("items", { count: data.items.length })}` : ""}
        </p>
      </div>

      <div className="flex gap-1 lg:hidden" role="tablist" aria-label={tp("tabs.label")}>
        {(["chat", "sources", "studio"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pane === k}
            onClick={() => setPane(k)}
            className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] transition-colors", pane === k ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink")}
            data-testid={`pane-${k}`}
          >
            {tp(`tabs.${k}`)}
            {k !== "chat" && counts[k] ? <span className={cn("text-[12px]", pane === k ? "text-on-ink/70" : "text-faint")}>{counts[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SourcesPane
          data={data}
          deselected={deselected}
          setDeselected={setDeselected}
          switcher={switcher}
          className={cn(pane === "sources" ? "flex" : "hidden", side === "sources" ? "lg:flex" : "lg:hidden", "lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 2xl:col-start-1 2xl:flex")}
        />
        <ChatPane data={data} refs={refs} usable={chosen.length} onShowSources={() => setPane("sources")} className={cn(pane === "chat" ? "flex" : "hidden", "lg:col-start-1 lg:row-start-1 lg:flex 2xl:col-start-2")} />
        <StudioPane
          scope={{ type: "collection", id: data.id }}
          outputs={data.outputs}
          notes={data.notes}
          refs={refs}
          usable={chosen.length}
          aiReady={data.aiReady}
          switcher={switcher}
          className={cn(pane === "studio" ? "flex" : "hidden", side === "studio" ? "lg:flex" : "lg:hidden", "lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 2xl:col-start-3 2xl:flex")}
        />
      </div>

      {editing ? (
        <CollectionDialog
          open
          onOpenChange={setEditing}
          options={data.options}
          initial={{ id: data.id, name: data.name, description: data.description, pinned: data.pinned, smartFilter: data.smartFilter }}
        />
      ) : null}
    </div>
  );
}
