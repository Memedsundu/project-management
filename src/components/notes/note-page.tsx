"use client";

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  FileText,
  FolderInput,
  History,
  LayoutTemplate,
  ListChecks,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pin,
  PinOff,
  ShieldOff,
  Sparkles,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { extractTasksAction } from "@/app/actions/common";
import { duplicateNoteAction, saveNoteAction, saveNoteAsTemplateAction, updateNoteAction } from "@/app/(app)/notes/actions";
import { PickerBody } from "@/components/common/entity-picker";
import { LinksPanel, type LinkItem } from "@/components/common/links-panel";
import { useTrash } from "@/components/common/use-trash";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { ExtractTasksDialog, type Proposal } from "@/components/tasks/extract-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/overlay";
import { openChecklistItems, type Block } from "@/lib/blocks";
import { formatDateTime, formatLongDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { PartnerRef } from "@/lib/parse-task";
import { cn } from "@/lib/utils";
import { HistoryDialog } from "./history-dialog";
import type { NoteEditor as Editor, TaskState } from "./note-blocks";
import type { SaveState } from "./note-editor";

// BlockNote touches the DOM on load, so the editor only renders in the browser.
const NoteEditor = dynamic(() => import("./note-editor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-xl bg-panel" />,
});

export type NotePageData = {
  note: {
    id: string;
    title: string;
    icon: string | null;
    kind: string;
    dailyDate: string | null;
    pinned: boolean;
    aiOff: boolean;
    parentId: string | null;
    updatedAt: string;
    content: Block[];
  };
  breadcrumb: { id: string; title: string; icon: string | null }[];
  subPages: { id: string; title: string; icon: string | null }[];
  links: LinkItem[];
  taskStates: Record<string, TaskState>;
  today: string;
  partners: PartnerRef[];
  daily: { prev: string; next: string } | null;
};

const ICONS = ["📝", "📌", "📅", "🤝", "🌾", "🏫", "📊", "📈", "🧭", "⚖️", "💡", "✅", "❗", "📎", "🗂️", "🧾", "📣", "🧒", "🏠", "🚜", "☀️", "💬", "🔍", "📍"];

/** One page: title, Notion-style body, sub-pages and backlinks. */
export function NotePage({ data }: { data: NotePageData }) {
  const { note } = data;
  const t = useTranslations("notes.page");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const trash = useTrash();
  const readOnly = shell.readOnly;
  const isDaily = note.kind === "daily" && Boolean(note.dailyDate);
  const isMemory = note.kind === "memory";

  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(note.icon);
  const [save, setSave] = useState<SaveState>("saved");
  const [editorKey, setEditorKey] = useState(0);
  const [content, setContent] = useState<Block[]>(note.content);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [extract, setExtract] = useState<Proposal[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const editorRef = useRef<Editor | null>(null);
  const titleTimer = useRef<number | null>(null);

  const displayTitle = isDaily ? formatLongDay(note.dailyDate!, locale) : title || t("untitled");
  useScreenContext({ kind: "note", id: note.id, title: displayTitle });

  const pendingTitle = useRef<string | null>(null);
  const flushTitle = async () => {
    if (titleTimer.current) window.clearTimeout(titleTimer.current);
    titleTimer.current = null;
    const value = pendingTitle.current;
    if (value === null) return false;
    pendingTitle.current = null;
    const res = await runAction(saveNoteAction(note.id, { title: value }), { silent: true });
    setSave(res === undefined ? "error" : "saved");
    return true;
  };
  const saveTitle = (value: string) => {
    setTitle(value);
    setSave("saving");
    pendingTitle.current = value;
    if (titleTimer.current) window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => void flushTitle(), 600);
  };

  const onReady = useCallback((ed: Editor) => {
    editorRef.current = ed;
  }, []);

  const runExtract = async () => {
    setExtracting(true);
    let proposals: Proposal[] = [];
    if (shell.aiConfigured && !note.aiOff) {
      const res = await runAction(extractTasksAction({ type: "note", id: note.id }));
      proposals = (res ?? []).map((p) => ({ ...p, keep: true }));
    } else {
      // Without AI: every open check-list item becomes a proposal.
      const blocks = (editorRef.current?.document as unknown as Block[]) ?? content;
      proposals = openChecklistItems(blocks).map((title) => ({ title, keep: true }));
    }
    setExtracting(false);
    setExtract(proposals);
  };

  return (
    <article className="mx-auto flex w-full max-w-[820px] flex-col gap-6">
      {/* Top bar: where the page sits, save state, page menu */}
      <div className="flex min-h-10 items-center gap-2 text-[13px] text-muted">
        <nav aria-label={t("breadcrumb")} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <Link href="/notes" className="shrink-0 hover:text-ink">
            {t("notes")}
          </Link>
          {data.breadcrumb.map((b) => (
            <span key={b.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight size={13} className="shrink-0" />
              <Link href={`/notes/${b.id}`} className="truncate hover:text-ink">
                {b.icon ? `${b.icon} ` : ""}
                {b.title || t("untitled")}
              </Link>
            </span>
          ))}
        </nav>
        <span className="flex shrink-0 items-center gap-1.5" aria-live="polite">
          {save === "saving" ? <Loader2 size={13} className="animate-spin" /> : save === "error" ? <AlertCircle size={13} className="text-danger" /> : <Check size={13} />}
          {save === "saving" ? t("saving") : save === "error" ? t("saveFailed") : t("saved")}
        </span>
        {note.aiOff ? (
          <span className="hidden items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-[12px] sm:flex">
            <ShieldOff size={12} /> {tc("aiOff")}
          </span>
        ) : null}
        {!readOnly ? (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={note.pinned ? t("unpin") : t("pin")}
              aria-pressed={note.pinned}
              onClick={() => runAction(updateNoteAction(note.id, { pinned: !note.pinned }))}
            >
              {note.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={t("menu")}>
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[260px]">
                <DropdownMenuItem onSelect={runExtract} disabled={extracting}>
                  <ListChecks size={15} />
                  {t("extractTasks")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                  <History size={15} />
                  {t("history")}
                </DropdownMenuItem>
                {!isDaily && !isMemory ? (
                  <>
                    <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                      <FolderInput size={15} />
                      {t("move")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={async () => {
                        const res = await runAction(duplicateNoteAction(note.id));
                        if (res?.id) router.push(`/notes/${res.id}`);
                      }}
                    >
                      <Copy size={15} />
                      {t("duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setTemplateName(title);
                        setTemplateOpen(true);
                      }}
                    >
                      <LayoutTemplate size={15} />
                      {t("saveAsTemplate")}
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Download size={15} />
                    {t("export")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => (window.location.href = `/api/notes/${note.id}/export?format=docx`)}>
                      <FileText size={15} />
                      Word (.docx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.open(`/print/notes/${note.id}`, "_blank", "noopener")}>
                      <FileDown size={15} />
                      PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => (window.location.href = `/api/notes/${note.id}/export?format=md`)}>
                      <NotebookPen size={15} />
                      Markdown (.md)
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onSelect={() => runAction(updateNoteAction(note.id, { aiOff: !note.aiOff }), { success: note.aiOff ? t("aiOn") : t("aiOffDone") })}>
                  {note.aiOff ? <Sparkles size={15} /> : <ShieldOff size={15} />}
                  {note.aiOff ? t("allowAi") : t("closeToAi")}
                </DropdownMenuItem>
                {!isMemory ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => trash("note", note.id, { title: displayTitle, redirectTo: "/notes" })}>
                      <Trash2 size={15} />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      {/* Title block */}
      <header className="flex flex-col gap-2">
        {isMemory ? (
          <div className="flex items-start gap-3 rounded-2xl bg-panel px-4 py-3 text-[14px] text-ink-2">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
            <p>{t("memoryHint")}</p>
          </div>
        ) : null}
        {!isDaily ? (
          <IconPicker icon={icon} disabled={readOnly} onChange={async (v) => {
            setIcon(v);
            await runAction(updateNoteAction(note.id, { icon: v }));
          }} />
        ) : null}
        {isDaily ? (
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[36px] leading-tight sm:text-[44px]">{displayTitle}</h1>
            <span className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" asChild aria-label={t("prevDay")}>
                <Link href={`/notes/daily?day=${data.daily!.prev}`}>
                  <ChevronLeft size={18} />
                </Link>
              </Button>
              {note.dailyDate !== data.today ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/notes/daily">{tc("today")}</Link>
                </Button>
              ) : null}
              <Button size="icon-sm" variant="ghost" asChild aria-label={t("nextDay")}>
                <Link href={`/notes/daily?day=${data.daily!.next}`}>
                  <ChevronRight size={18} />
                </Link>
              </Button>
            </span>
          </div>
        ) : (
          <TitleInput
            value={title}
            readOnly={readOnly || isMemory}
            placeholder={t("untitled")}
            onChange={saveTitle}
            onBlur={async () => {
              // The page tree and breadcrumb show the new title once it is saved.
              if (await flushTitle()) router.refresh();
            }}
            onEnter={() => editorRef.current?.focus()}
          />
        )}
        <p className="text-[13px] text-faint">{t("edited", { when: formatDateTime(note.updatedAt, locale) })}</p>
      </header>

      <NoteEditor
        key={editorKey}
        noteId={note.id}
        initialContent={content}
        readOnly={readOnly}
        aiOff={note.aiOff || !shell.aiConfigured}
        today={data.today}
        partners={data.partners}
        taskStates={data.taskStates}
        onSaveState={setSave}
        onSubPage={() => router.refresh()}
        onReady={onReady}
      />

      {data.subPages.length ? (
        <section className="flex flex-col gap-2 border-t border-line pt-5" aria-labelledby="subpages">
          <h2 id="subpages" className="label-caps">
            {t("subPages")}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.subPages.map((p) => (
              <li key={p.id}>
                <Link href={`/notes/${p.id}`} className="flex min-h-12 items-center gap-2.5 rounded-xl border border-line px-3.5 hover:border-ink">
                  {p.icon ? <span className="text-[16px]">{p.icon}</span> : <NotebookPen size={16} className="text-muted" />}
                  <span className="truncate text-[15px]">{p.title || t("untitled")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="border-t border-line pt-5">
        <LinksPanel self={{ type: "note", id: note.id }} items={data.links.filter((l) => l.kind !== "attachment" || l.direction === "out")} readOnly={readOnly} />
      </div>

      <HistoryDialog
        noteId={note.id}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRestored={(v) => {
          setTitle(v.title);
          setContent(v.content);
          setEditorKey((k) => k + 1);
          router.refresh();
        }}
      />

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent title={t("moveTitle")} description={t("moveHint")}>
          <div className="flex flex-col gap-2">
            {note.parentId ? (
              <Button
                variant="outline"
                className="self-start"
                onClick={async () => {
                  await runAction(updateNoteAction(note.id, { parentId: null }), { success: t("moved") });
                  setMoveOpen(false);
                }}
              >
                {t("moveToTop")}
              </Button>
            ) : null}
            <PickerBody
              types={["note"]}
              exclude={[`note:${note.id}`, ...(note.parentId ? [`note:${note.parentId}`] : [])]}
              onPick={async (item) => {
                await runAction(updateNoteAction(note.id, { parentId: item.id }), { success: t("moved") });
                setMoveOpen(false);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent title={t("saveAsTemplate")} description={t("templateHint")}>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await runAction(saveNoteAsTemplateAction(note.id, templateName), { success: t("templateSaved") });
              if (res) setTemplateOpen(false);
            }}
          >
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} aria-label={t("templateName")} placeholder={t("templateName")} autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTemplateOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={!templateName.trim()}>
                {tc("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {extract ? (
        <ExtractTasksDialog
          open
          onOpenChange={(v) => !v && setExtract(null)}
          title={t("extractTitle", { title: displayTitle })}
          proposals={extract}
          source={{ type: "note", id: note.id }}
          onDone={() => setExtract(null)}
        />
      ) : null}
    </article>
  );
}

function TitleInput({
  value,
  readOnly,
  placeholder,
  onChange,
  onBlur,
  onEnter,
}: {
  value: string;
  readOnly: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onEnter: () => void;
}) {
  return (
    <textarea
      value={value}
      readOnly={readOnly}
      rows={1}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="field-sizing-content w-full resize-none bg-transparent font-display text-[36px] leading-tight outline-none placeholder:text-faint sm:text-[44px]"
    />
  );
}

function IconPicker({ icon, disabled, onChange }: { icon: string | null; disabled: boolean; onChange: (v: string | null) => void }) {
  const t = useTranslations("notes.page");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "self-start rounded-xl",
            icon ? "px-1 text-[44px] leading-none hover:bg-panel" : "flex h-8 items-center gap-1.5 px-2 text-[13px] text-muted hover:bg-panel hover:text-ink",
          )}
          aria-label={t("icon")}
        >
          {icon ?? (
            <>
              <span aria-hidden>☺</span> {t("addIcon")}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[288px] p-2">
        <div className="grid grid-cols-8 gap-1">
          {ICONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
              className="flex size-8 items-center justify-center rounded-lg text-[18px] hover:bg-panel"
            >
              {e}
            </button>
          ))}
        </div>
        {icon ? (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="mt-2 w-full rounded-lg px-2 py-2 text-left text-[13px] text-muted hover:bg-panel hover:text-ink"
          >
            {t("removeIcon")}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
