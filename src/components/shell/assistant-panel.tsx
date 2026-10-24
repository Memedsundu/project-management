"use client";

import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { listRecipesAction, runRecipeAction } from "@/app/actions/recipes";
import {
  deleteConversationAction,
  deleteGlossaryTermAction,
  getConversationAction,
  listConversationsAction,
  loadMemoryAction,
  saveGlossaryTermAction,
} from "@/app/actions/assistant";
import { ChatMarkdown } from "@/components/common/chat-markdown";
import { EntityIcon } from "@/components/common/entity-icon";
import { SuggestionCard, type InboxSuggestion } from "@/components/inbox/suggestion-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Tip } from "@/components/ui/overlay";
import { relativeDayLabel } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { AssistantEvent, AssistantSource, AssistantTurn, ConversationListItem, ConversationView } from "@/server/ai/assistant";
import type { GlossaryTerm } from "@/server/services/glossary";
import { useShell, type ScreenContext } from "./shell-context";
import { useMediaQuery } from "./use-media-query";

type Proposal = InboxSuggestion & { status?: string };

type Item =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      steps: string[];
      proposals: Proposal[];
      sources: AssistantSource[];
      error: string | null;
      stopped: boolean;
      streaming: boolean;
      /** A saved instruction's result also lives on Özetler. */
      link?: { href: string; label: string };
    };

type AssistantItem = Extract<Item, { kind: "assistant" }>;

const STORE_KEY = "assistant:conversation";
const RECORD_KINDS = new Set(["organisation", "meeting", "note", "document", "series", "activity", "indicator", "collection"]);
const QUICK_KINDS = ["organisation", "meeting", "note", "document", "today", "tasks", "partners", "files", "meetings", "workplan", "activity", "indicators", "indicator", "logframe", "collections", "collection"] as const;

/** The box grows with what she writes, up to about six lines. */
function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

let seq = 0;
const rid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

function readStore() {
  try {
    return window.sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}
function writeStore(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(STORE_KEY, id);
    else window.sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Private mode: the chat simply starts fresh next time.
  }
}

/** Text selected inside the page itself (not in the panel). */
function readMainSelection() {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
  if (!node?.closest("#main")) return null;
  const text = sel.toString().trim();
  return text.length >= 3 ? text.slice(0, 6000) : null;
}

/** The page selection, kept until she sends or drops it; one made before the panel opened counts too. */
function useMainSelection() {
  const [selection, setSelection] = useState<string | null>(() => readMainSelection());
  useEffect(() => {
    const onChange = () => {
      const text = readMainSelection();
      if (text) setSelection(text);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  return [selection, setSelection] as const;
}

/** Peni's right-hand panel with Notion Agent's habits: knows the screen, proposes, never acts alone. */
export function AssistantPanel({
  onClose,
  initialPrompt,
  onPromptUsed,
  initialView,
  onViewUsed,
}: {
  onClose: () => void;
  initialPrompt?: string;
  onPromptUsed?: () => void;
  /** A page (Ayarlar) asked for the memory view; consumed once like the prompt. */
  initialView?: "memory";
  onViewUsed?: () => void;
}) {
  const t = useTranslations("ai.assistant");
  const tc = useTranslations("common");
  const locale = useLocale();
  const shell = useShell();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [view, setView] = useState<"chat" | "memory">(initialView ?? "chat");
  const [seenView, setSeenView] = useState(initialView);
  if (initialView !== seenView) {
    setSeenView(initialView);
    if (initialView) setView(initialView);
  }
  useEffect(() => {
    if (initialView) onViewUsed?.();
  }, [initialView, onViewUsed]);
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // On phones the panel closes and opens again: pick up the same chat.
  const [restoreId] = useState(() => (initialPrompt ? null : readStore()));
  const [loading, setLoading] = useState(Boolean(restoreId));
  const [history, setHistory] = useState<ConversationListItem[] | null>(null);
  const [selection, setSelection] = useMainSelection();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const usedPrompt = useRef<string | null>(null);
  const screen = shell.screen;
  const onNavigate = wide ? undefined : onClose;

  const patch = useCallback((id: string, p: Partial<AssistantItem> | ((it: AssistantItem) => Partial<AssistantItem>)) => {
    setItems((prev) => prev.map((it) => (it.id === id && it.kind === "assistant" ? { ...it, ...(typeof p === "function" ? p(it) : p) } : it)));
  }, []);

  // Keep the newest words in view unless she scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const showConversation = useCallback(
    (conv: ConversationView | null | undefined) => {
      setLoading(false);
      if (!conv) {
        writeStore(null);
        return;
      }
      setConversationId(conv.id);
      writeStore(conv.id);
      setView("chat");
      setItems(
        conv.turns.map((turn: AssistantTurn): Item =>
          turn.role === "user"
            ? { kind: "user", id: rid(), text: turn.text }
            : {
                kind: "assistant",
                id: rid(),
                text: turn.text,
                steps: [],
                proposals: (turn.proposals ?? []).flatMap((pid) => (conv.proposals[pid] ? [conv.proposals[pid]] : [])),
                sources: turn.sources ?? [],
                error: turn.error ? errorText(turn.error) : null,
                stopped: Boolean(turn.stopped),
                streaming: false,
              },
        ),
      );
      stickRef.current = true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!restoreId) return;
    let alive = true;
    getConversationAction(restoreId)
      .then((res) => alive && showConversation(res.ok ? res.data : null))
      .catch(() => alive && showConversation(null));
    return () => {
      alive = false;
    };
  }, [restoreId, showConversation]);

  const openConversation = async (id: string) => {
    setLoading(true);
    showConversation(await runAction(getConversationAction(id), { silent: true }));
  };

  function errorText(code: string) {
    const known = ["not_configured", "disabled", "cap_reached", "refused", "failed", "too_large", "ai_off", "child_data"];
    return t(`errors.${known.includes(code) ? code : "failed"}` as "errors.failed");
  }

  const handle = useCallback(
    (e: AssistantEvent, itemId: string) => {
      if (e.type === "start") {
        setConversationId(e.conversationId);
        writeStore(e.conversationId);
      } else if (e.type === "status") patch(itemId, (it) => ({ steps: [...it.steps, e.label] }));
      else if (e.type === "text") patch(itemId, (it) => ({ text: it.text + e.delta }));
      else if (e.type === "proposal") patch(itemId, (it) => ({ proposals: [...it.proposals, e.suggestion] }));
      else if (e.type === "sources") patch(itemId, { sources: e.sources });
      else if (e.type === "error") patch(itemId, { error: e.message });
    },
    [patch],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "";
      setView("chat");
      const itemId = rid();
      setItems((prev) => [
        ...prev,
        { kind: "user", id: rid(), text: message },
        { kind: "assistant", id: itemId, text: "", steps: [], proposals: [], sources: [], error: null, stopped: false, streaming: true },
      ]);
      stickRef.current = true;
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const sel = selection;
      setSelection(null);
      const screenPayload: (Omit<ScreenContext, "id"> & { id: string | null; selection: string | null }) | null = screen
        ? { kind: screen.kind, id: screen.id ?? null, title: screen.title, detail: screen.detail, selection: sel }
        : sel
          ? { kind: "page", id: null, title: document.title, selection: sel }
          : null;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message, locale, screen: screenPayload }),
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/sign-in";
          return;
        }
        if (!res.ok || !res.body) throw new Error(String(res.status));
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf("\n");
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) handle(JSON.parse(line) as AssistantEvent, itemId);
            nl = buffer.indexOf("\n");
          }
        }
      } catch {
        if (ctrl.signal.aborted) patch(itemId, { stopped: true });
        else patch(itemId, { error: navigator.onLine ? t("errors.failed") : t("errors.offline") });
      } finally {
        patch(itemId, { streaming: false });
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, conversationId, handle, locale, patch, screen, selection, setSelection, t],
  );

  // A question from ⌘K or a page button arrives here once.
  useEffect(() => {
    if (!initialPrompt || usedPrompt.current === initialPrompt) return;
    const timer = window.setTimeout(() => {
      usedPrompt.current = initialPrompt;
      onPromptUsed?.();
      if (shell.aiConfigured) void send(initialPrompt);
      else setInput(initialPrompt);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialPrompt, onPromptUsed, send, shell.aiConfigured]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Her saved instructions, offered on an empty chat (Granola Recipes).
  const [recipes, setRecipes] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!shell.aiConfigured || shell.readOnly) return;
    let alive = true;
    void runAction(listRecipesAction(), { silent: true }).then((list) => alive && list && setRecipes(list.map((r) => ({ id: r.id, name: r.name }))));
    return () => {
      alive = false;
    };
  }, [shell.aiConfigured, shell.readOnly]);

  const runRecipeHere = async (r: { id: string; name: string }) => {
    if (busy) return;
    const itemId = rid();
    setView("chat");
    setItems((prev) => [
      ...prev,
      { kind: "user", id: rid(), text: t("recipes.ran", { name: r.name }) },
      { kind: "assistant", id: itemId, text: "", steps: [t("recipes.running")], proposals: [], sources: [], error: null, stopped: false, streaming: true },
    ]);
    stickRef.current = true;
    setBusy(true);
    const on = screen?.id && RECORD_KINDS.has(screen.kind) ? { type: screen.kind, id: screen.id } : null;
    const res = await runAction(runRecipeAction(r.id, on), { silent: true });
    setBusy(false);
    patch(itemId, res ? { text: res.content, streaming: false, link: { href: `/briefs/${res.id}`, label: t("recipes.saved") } } : { error: t("errors.failed"), streaming: false });
  };

  const newChat = () => {
    abortRef.current?.abort();
    setItems([]);
    setConversationId(null);
    writeStore(null);
    setView("chat");
    inputRef.current?.focus();
  };

  const loadHistory = async () => {
    const list = await runAction(listConversationsAction(), { silent: true });
    setHistory(list ?? []);
  };

  const removeConversation = async (id: string) => {
    const ok = await runAction(deleteConversationAction(id), { success: t("history.deleted") });
    if (ok === undefined) return;
    setHistory((h) => h?.filter((c) => c.id !== id) ?? null);
    if (id === conversationId) newChat();
  };

  const record = screen && screen.id && RECORD_KINDS.has(screen.kind) ? screen : null;
  const quickKind = selection ? "selection" : ((QUICK_KINDS as readonly string[]).includes(screen?.kind ?? "") ? screen!.kind : "default");

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-testid="assistant-panel" onKeyDown={(e) => e.key === "Escape" && wide && onClose()}>
      <header className="flex items-center gap-1 border-b border-line px-3 py-2">
        {view === "memory" ? (
          <Button variant="ghost" size="icon" onClick={() => setView("chat")} aria-label={t("backToChat")}>
            <ArrowLeft size={18} />
          </Button>
        ) : (
          <span className="inline-flex h-11 w-9 items-center justify-center text-ink" aria-hidden>
            <Sparkles size={18} />
          </span>
        )}
        <h2 className="flex-1 truncate font-display text-[22px] leading-none">{view === "memory" ? t("memory.title") : t("title")}</h2>
        {view === "chat" ? (
          <>
            <DropdownMenu onOpenChange={(o) => o && void loadHistory()}>
              <Tip content={t("history.title")}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("history.title")} data-testid="assistant-history">
                    <History size={18} />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end" className="w-[300px]">
                <DropdownMenuLabel>{t("history.title")}</DropdownMenuLabel>
                {history === null ? (
                  <div className="px-3 py-2 text-[14px] text-muted">{tc("loading")}</div>
                ) : history.length === 0 ? (
                  <div className="px-3 py-2 text-[14px] text-muted">{t("history.empty")}</div>
                ) : (
                  history.map((c) => (
                    <DropdownMenuItem key={c.id} onSelect={() => void openConversation(c.id)} className="group">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("truncate", c.id === conversationId && "font-semibold")}>{c.title}</span>
                        <span className="text-[12px] text-muted">{relativeDayLabel(c.updatedAt.slice(0, 10), locale)}</span>
                      </span>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted opacity-0 hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover:opacity-100 group-data-[highlighted]:opacity-100"
                        aria-label={t("history.delete")}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void removeConversation(c.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tip content={t("newChat")}>
              <Button variant="ghost" size="icon" onClick={newChat} aria-label={t("newChat")} data-testid="assistant-new">
                <Plus size={19} />
              </Button>
            </Tip>
            <Tip content={t("memory.title")}>
              <Button variant="ghost" size="icon" onClick={() => setView("memory")} aria-label={t("memory.title")} data-testid="assistant-memory">
                <BookOpen size={18} />
              </Button>
            </Tip>
          </>
        ) : null}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={tc("close")}>
          <X size={18} />
        </Button>
      </header>

      {view === "memory" ? (
        <MemoryView readOnly={shell.readOnly} onNavigate={onNavigate} />
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {loading ? (
              <p className="flex items-center gap-2 text-[14px] text-muted">
                <Loader2 size={15} className="animate-spin" />
                {tc("loading")}
              </p>
            ) : items.length === 0 ? (
              <Welcome
                aiConfigured={shell.aiConfigured}
                readOnly={shell.readOnly}
                quickKind={quickKind}
                record={record}
                onPick={(q) => void send(q)}
                recipes={recipes}
                onRecipe={(r) => void runRecipeHere(r)}
              />
            ) : (
              <ol className="flex flex-col gap-5" role="log" aria-live="polite" aria-label={t("title")}>
                {items.map((it) =>
                  it.kind === "user" ? (
                    <li key={it.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-panel px-4 py-2.5 text-[15px]">{it.text}</p>
                    </li>
                  ) : (
                    <AssistantReply key={it.id} it={it} readOnly={shell.readOnly} onNavigate={onNavigate} />
                  ),
                )}
              </ol>
            )}
          </div>

          <footer className="border-t border-line px-3 pb-3 pt-2">
            {record ? (
              <p className="flex items-center gap-1.5 px-1 pb-2 text-[12px] text-muted" data-testid="assistant-context">
                <EntityIcon type={record.kind} size={13} className="shrink-0" />
                <span className="truncate">{t("seesScreen", { title: record.title })}</span>
              </p>
            ) : null}
            {selection ? (
              <div className="mb-2 flex items-start gap-2 rounded-xl bg-panel px-3 py-2 text-[13px]" data-testid="assistant-selection">
                <span className="line-clamp-2 flex-1 text-ink-2">
                  <span className="font-medium text-ink">{t("selection")}: </span>“{selection}”
                </span>
                <button type="button" onClick={() => setSelection(null)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-ink" aria-label={t("dropSelection")}>
                  <X size={13} />
                </button>
              </div>
            ) : null}
            <form
              className="flex items-end gap-2 rounded-2xl border border-line-strong px-3 py-2 focus-within:border-ink"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  grow(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={shell.aiConfigured ? t("placeholder") : t("placeholderOff")}
                disabled={!shell.aiConfigured}
                aria-label={t("placeholder")}
                className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] outline-none placeholder:text-faint disabled:cursor-not-allowed"
                data-testid="assistant-input"
              />
              {busy ? (
                <Button type="button" size="icon-sm" variant="outline" onClick={() => abortRef.current?.abort()} aria-label={t("stop")} data-testid="assistant-stop">
                  <Square size={13} fill="currentColor" />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" disabled={!input.trim() || !shell.aiConfigured} aria-label={t("send")} data-testid="assistant-send">
                  <ArrowUp size={17} />
                </Button>
              )}
            </form>
            <p className="px-1 pt-2 text-[12px] text-muted">{shell.readOnly ? t("footerReadOnly") : t("footer")}</p>
          </footer>
        </>
      )}
    </div>
  );
}

function Welcome({
  aiConfigured,
  readOnly,
  quickKind,
  record,
  onPick,
  recipes,
  onRecipe,
}: {
  aiConfigured: boolean;
  readOnly: boolean;
  quickKind: string;
  record: ScreenContext | null;
  onPick: (q: string) => void;
  recipes: { id: string; name: string }[];
  onRecipe: (r: { id: string; name: string }) => void;
}) {
  const t = useTranslations("ai.assistant");
  if (!aiConfigured) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong px-5 py-6" data-testid="assistant-off">
        <p className="text-[16px] font-medium">{t("off.title")}</p>
        <p className="text-[14px] text-muted">{t("off.body")}</p>
        <p className="text-[14px] text-muted">{t("off.memory")}</p>
      </div>
    );
  }
  const quick = [0, 1, 2].map((i) => t(`quick.${quickKind}.${i}` as "quick.default.0"));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-[26px] leading-tight">{t("hello")}</p>
        <p className="text-[14px] text-muted">{record ? t("introRecord", { title: record.title }) : t("intro")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="label-caps">{t("tryThis")}</p>
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line px-3.5 py-2 text-left text-[14px] transition-colors hover:border-ink"
            data-testid="assistant-quick"
          >
            <Sparkles size={14} className="shrink-0 text-muted" />
            {q}
          </button>
        ))}
      </div>
      {recipes.length ? (
        <div className="flex flex-col gap-2" data-testid="assistant-recipes">
          <p className="label-caps">{t("recipes.title")}</p>
          <div className="flex flex-wrap gap-1.5">
            {recipes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onRecipe(r)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-[14px] transition-colors hover:border-ink"
                data-testid="assistant-recipe"
              >
                <Play size={13} className="shrink-0 text-muted" />
                {r.name}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted">
            {record ? t("recipes.onRecord", { title: record.title }) : t("recipes.hint")}{" "}
            <Link href="/settings#helpers" className="underline-offset-2 hover:text-ink hover:underline">
              {t("recipes.manage")}
            </Link>
          </p>
        </div>
      ) : null}
      <p className="text-[13px] text-muted">{readOnly ? t("welcomeReadOnly") : t("welcomeNote")}</p>
    </div>
  );
}

function AssistantReply({ it, readOnly, onNavigate }: { it: AssistantItem; readOnly: boolean; onNavigate?: () => void }) {
  const t = useTranslations("ai.assistant");
  const [decided, setDecided] = useState<Record<string, "accepted" | "rejected">>({});
  const [allSources, setAllSources] = useState(false);
  const thinking = it.streaming && !it.text && !it.proposals.length && !it.error;
  const lastStep = it.steps[it.steps.length - 1];
  return (
    <li className="flex flex-col gap-3" data-testid="assistant-reply">
      {it.streaming && it.steps.length ? (
        <ul className="flex flex-col gap-1" role="status">
          {it.steps.slice(-4).map((s, i, arr) => (
            <li key={`${s}-${i}`} className="flex items-center gap-2 text-[13px] text-muted">
              {i === arr.length - 1 && !it.text ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              <span className="truncate">{s}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {thinking && !lastStep ? (
        <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <Loader2 size={13} className="animate-spin" />
          {t("thinking")}
        </p>
      ) : null}
      {it.text ? <ChatMarkdown text={it.text} onNavigate={onNavigate} /> : null}
      {it.link && !it.streaming ? (
        <Link href={it.link.href} onClick={onNavigate} className="inline-flex items-center gap-1.5 self-start text-[13px] text-muted hover:text-ink" data-testid="assistant-brief-link">
          {it.link.label} →
        </Link>
      ) : null}
      {it.proposals.map((p) => {
        const done = decided[p.id] ?? (p.status && p.status !== "pending" ? (p.status === "rejected" ? "rejected" : "accepted") : null);
        if (done) {
          return (
            <p key={p.id} className="flex items-center gap-2 rounded-xl bg-panel px-3.5 py-2.5 text-[14px]" data-testid="assistant-decided">
              {done === "accepted" ? <Check size={15} className="shrink-0 text-success" /> : <X size={15} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{done === "accepted" ? t("proposal.accepted") : t("proposal.rejected")}</span> · {p.title}
              </span>
            </p>
          );
        }
        return <SuggestionCard key={p.id} s={p} readOnly={readOnly} folderNames={{}} onDone={(status) => setDecided((d) => ({ ...d, [p.id]: status }))} />;
      })}
      {it.error ? (
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-[14px] text-accent-ink" role="alert">
          {it.error}
        </p>
      ) : null}
      {it.stopped ? <p className="text-[13px] text-muted">{t("stopped")}</p> : null}
      {!it.streaming && it.sources.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-muted">{t("looked")}</p>
          <div className="flex flex-wrap gap-1.5">
            {(allSources ? it.sources : it.sources.slice(0, 4)).map((s) => (
              <Link
                key={`${s.type}:${s.id}`}
                href={s.href}
                onClick={onNavigate}
                className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line px-3 text-[13px] hover:border-ink"
              >
                <EntityIcon type={s.type} size={13} className="shrink-0 text-muted" />
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
            {!allSources && it.sources.length > 4 ? (
              <button type="button" onClick={() => setAllSources(true)} className="inline-flex h-8 items-center rounded-full px-3 text-[13px] text-muted hover:bg-panel hover:text-ink">
                {t("moreSources", { count: it.sources.length - 4 })}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ---------------------------------- Memory ---------------------------------- */

type MemoryData = { noteId: string; preview: string[]; aiOff: boolean; glossary: GlossaryTerm[] };

function MemoryView({ readOnly, onNavigate }: { readOnly: boolean; onNavigate?: () => void }) {
  const t = useTranslations("ai.assistant.memory");
  const tc = useTranslations("common");
  const [data, setData] = useState<MemoryData | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void runAction(loadMemoryAction()).then((d) => d && setData(d));
  }, []);

  if (!data) {
    return (
      <p className="flex items-center gap-2 px-4 py-4 text-[14px] text-muted">
        <Loader2 size={15} className="animate-spin" />
        {tc("loading")}
      </p>
    );
  }

  const q = filter.trim().toLocaleLowerCase("tr");
  const terms = q ? data.glossary.filter((g) => `${g.tr} ${g.en} ${g.note ?? ""}`.toLocaleLowerCase("tr").includes(q)) : data.glossary;
  const saved = (term: GlossaryTerm) =>
    setData((d) => d && { ...d, glossary: [...d.glossary.filter((g) => g.id !== term.id), term].sort((a, b) => a.tr.localeCompare(b.tr, "tr")) });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4" data-testid="assistant-memory-view">
      <section className="flex flex-col gap-3 rounded-2xl border border-line px-4 py-4" aria-labelledby="mem-page">
        <div className="flex flex-col gap-1">
          <h3 id="mem-page" className="text-[16px] font-semibold">
            {t("pageTitle")}
          </h3>
          <p className="text-[14px] text-muted">{t("pageHint")}</p>
        </div>
        {data.aiOff ? <p className="rounded-xl bg-accent-soft px-3 py-2 text-[13px] text-accent-ink">{t("pageAiOff")}</p> : null}
        {data.preview.length ? (
          <ul className="flex flex-col gap-1 text-[14px] text-ink-2">
            {data.preview.map((l, i) => (
              <li key={i} className="line-clamp-1">
                {l}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-faint">{t("pageEmpty")}</p>
        )}
        <Button variant="outline" size="sm" className="self-start" asChild>
          <Link href={`/notes/${data.noteId}`} onClick={onNavigate}>
            <Pencil size={14} />
            {t("openPage")}
          </Link>
        </Button>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="mem-glossary">
        <div className="flex flex-col gap-1">
          <h3 id="mem-glossary" className="text-[16px] font-semibold">
            {t("glossary")}
          </h3>
          <p className="text-[14px] text-muted">{t("glossaryHint")}</p>
        </div>
        {!readOnly ? <TermForm key="new" onSaved={saved} /> : null}
        {data.glossary.length > 8 ? (
          <label className="flex h-10 items-center gap-2 rounded-full border border-line-strong px-3.5 focus-within:border-ink">
            <Search size={15} className="text-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("filter")} aria-label={t("filter")} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
          </label>
        ) : null}
        {terms.length === 0 ? (
          <p className="text-[14px] text-faint">{data.glossary.length ? t("noMatch") : t("glossaryEmpty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft" data-testid="glossary-list">
            {terms.map((g) =>
              editing === g.id ? (
                <li key={g.id} className="py-2">
                  <TermForm
                    term={g}
                    onSaved={(term) => {
                      saved(term);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={g.id} className="group flex items-start gap-2 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[14px]">
                      <span className="font-medium">{g.tr}</span> <span className="text-muted">=</span> {g.en}
                    </span>
                    {g.note ? <span className="text-[13px] text-muted">{g.note}</span> : null}
                  </span>
                  {!readOnly ? (
                    <span className="flex shrink-0 gap-0.5 opacity-100 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(g.id)} aria-label={`${tc("edit")}: ${g.tr}`}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${tc("delete")}: ${g.tr}`}
                        onClick={async () => {
                          const ok = await runAction(deleteGlossaryTermAction(g.id), { success: t("deleted") });
                          if (ok !== undefined) setData((d) => d && { ...d, glossary: d.glossary.filter((x) => x.id !== g.id) });
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function TermForm({ term, onSaved, onCancel }: { term?: GlossaryTerm; onSaved: (t: GlossaryTerm) => void; onCancel?: () => void }) {
  const t = useTranslations("ai.assistant.memory");
  const tc = useTranslations("common");
  const [tr, setTr] = useState(term?.tr ?? "");
  const [en, setEn] = useState(term?.en ?? "");
  const [note, setNote] = useState(term?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2 rounded-2xl bg-panel px-3 py-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!tr.trim() || !en.trim()) return;
        setBusy(true);
        const res = await runAction(saveGlossaryTermAction({ id: term?.id ?? null, tr, en, note: note || null }), { success: term ? t("updated") : t("added") });
        setBusy(false);
        if (!res) return;
        onSaved(res);
        if (!term) {
          setTr("");
          setEn("");
          setNote("");
        }
      }}
      data-testid={term ? "term-edit" : "term-add"}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
        <Input value={tr} onChange={(e) => setTr(e.target.value)} placeholder={t("tr")} aria-label={t("tr")} maxLength={200} />
        <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("en")} aria-label={t("en")} maxLength={200} />
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} aria-label={t("note")} maxLength={300} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !tr.trim() || !en.trim()}>
          {term ? <Check size={14} /> : <Plus size={14} />}
          {term ? tc("save") : t("add")}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {tc("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
