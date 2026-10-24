"use client";

import "@blocknote/mantine/style.css";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { en } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  SuggestionMenuController,
  useComponentsContext,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { CheckSquare, FilePlus2, FileText, CalendarClock, Sparkles, CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchEntitiesAction } from "@/app/actions/common";
import { attachToNoteAction, createPageAction, saveNoteAction } from "@/app/(app)/notes/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { PickerBody } from "@/components/common/entity-picker";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { uploadOne } from "@/components/files/upload-core";
import { formatLongDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { Block } from "@/lib/blocks";
import type { PartnerRef } from "@/lib/parse-task";
import type { EntityType } from "@/server/entities";
import { tr as trDictionary } from "./blocknote-tr";
import { NoteEditorEnv, noteSchema, type NoteEditor as Editor, type TaskState } from "./note-blocks";
import { WritingPanel, type WritingRequest } from "./writing-panel";

export type SaveState = "saved" | "saving" | "error";

const MENTION_TYPES: EntityType[] = ["organisation", "contact", "task", "document", "meeting", "note", "indicator", "activity", "decision", "report", "collection"];

/**
 * The page body: Notion-style blocks with a Turkish "/" menu, "@" links to
 * any record, real task blocks and file cards. Saves itself as she types.
 */
export function NoteEditor({
  noteId,
  initialContent,
  readOnly,
  aiOff,
  today,
  partners,
  taskStates,
  onSaveState,
  onSubPage,
  onReady,
}: {
  noteId: string;
  initialContent: Block[];
  readOnly: boolean;
  aiOff: boolean;
  today: string;
  partners: PartnerRef[];
  taskStates: Record<string, TaskState>;
  onSaveState?: (s: SaveState) => void;
  onSubPage?: () => void;
  onReady?: (editor: Editor) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("notes.editor");
  const tk = useTranslations("common.kinds");
  const { resolvedTheme } = useTheme();
  const [tasks, setTasks] = useState(taskStates);
  const [writing, setWriting] = useState<WritingRequest | null>(null);

  const editor = useCreateBlockNote(
    {
      schema: noteSchema,
      dictionary: locale === "en" ? en : trDictionary,
      initialContent: initialContent.length ? (initialContent as never) : undefined,
      uploadFile: async (file: File) => {
        const out = await uploadOne(file, { folderId: null });
        const id = out.ok ? out.id : "duplicate" in out ? out.duplicate.id : null;
        if (!id) throw new Error(out.ok ? "failed" : "error" in out ? out.error : "failed");
        await runAction(attachToNoteAction(noteId, id), { silent: true });
        return `/api/files/${id}/content`;
      },
    },
    [noteId],
  );

  useEffect(() => {
    onReady?.(editor);
  }, [editor, onReady]);

  /* ---------------------------- autosave ---------------------------- */
  const timer = useRef<number | null>(null);
  const pending = useRef(false);
  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    onSaveState?.("saving");
    const res = await runAction(saveNoteAction(noteId, { content: editor.document as unknown as Block[] }), { silent: true });
    onSaveState?.(res === undefined ? "error" : "saved");
  }, [editor, noteId, onSaveState]);

  const onChange = useCallback(() => {
    if (readOnly) return;
    pending.current = true;
    onSaveState?.("saving");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  }, [flush, onSaveState, readOnly]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", beforeUnload);
      void flush();
    };
  }, [flush]);

  /* ------------------------------ menus ------------------------------ */
  const slashItems = useCallback(
    (ed: Editor): DefaultReactSuggestionItem[] => {
      const group = t("slash.group");
      const own: DefaultReactSuggestionItem[] = [
        {
          title: t("slash.task"),
          subtext: t("slash.taskHint"),
          aliases: ["gorev", "görev", "task", "todo", "is", "iş"],
          group,
          icon: <CheckSquare size={18} />,
          onItemClick: () => insertOrUpdateBlockForSlashMenu(ed, { type: "task" }),
        },
        {
          title: t("slash.subPage"),
          subtext: t("slash.subPageHint"),
          aliases: ["sayfa", "alt", "page", "subpage"],
          group,
          icon: <FilePlus2 size={18} />,
          onItemClick: async () => {
            const cursor = ed.getTextCursorPosition().block;
            const res = await runAction(createPageAction({ parentId: noteId, title: "" }));
            if (!res) return;
            ed.insertBlocks([{ type: "entityCard", props: { kind: "note", id: res.id, title: t("untitledPage") } }], cursor, "after");
            onSubPage?.();
          },
        },
        {
          title: t("slash.file"),
          subtext: t("slash.fileHint"),
          aliases: ["belge", "dosya", "file", "doc"],
          group,
          icon: <FileText size={18} />,
          onItemClick: () => openPicker(ed, "document"),
        },
        {
          title: t("slash.meeting"),
          subtext: t("slash.meetingHint"),
          aliases: ["toplanti", "toplantı", "meeting"],
          group,
          icon: <CalendarClock size={18} />,
          onItemClick: () => openPicker(ed, "meeting"),
        },
        {
          title: t("slash.today"),
          subtext: formatLongDay(today, locale),
          aliases: ["tarih", "bugun", "bugün", "date", "today"],
          group,
          icon: <CalendarDays size={18} />,
          onItemClick: () => ed.insertInlineContent(`${formatLongDay(today, locale)} `),
        },
      ];
      if (!aiOff) {
        own.push({
          title: t("slash.ai"),
          subtext: t("slash.aiHint"),
          aliases: ["ai", "yapay", "zeka", "zekâ", "claude", "devam"],
          group: t("slash.aiGroup"),
          icon: <Sparkles size={18} />,
          onItemClick: () => {
            const block = ed.getTextCursorPosition().block;
            setWriting({ text: ed.blocksToMarkdownLossy(ed.document), afterBlockId: block.id, replace: false, context: "" });
          },
        });
      }
      const defaults = getDefaultReactSlashMenuItems(ed).filter((i) => !["Video", "Audio", "Ses", "Emoji"].includes(i.title));
      return [...own, ...defaults];
    },
    [aiOff, locale, noteId, onSubPage, t, today],
  );

  // "/Belge kartı" and "/Toplantı kartı" open a search, then place a card after the cursor.
  const [picker, setPicker] = useState<{ kind: "document" | "meeting"; blockId: string } | null>(null);
  const openPicker = (ed: Editor, kind: "document" | "meeting") => setPicker({ kind, blockId: ed.getTextCursorPosition().block.id });

  const mentionItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const res = await runAction(searchEntitiesAction(query, MENTION_TYPES), { silent: true });
      return (res ?? [])
        .filter((r) => !(r.type === "note" && r.id === noteId))
        .slice(0, 10)
        .map((r) => ({
          title: r.title || "—",
          subtext: tk(r.type as "task"),
          icon: <EntityIcon type={r.type} size={16} />,
          onItemClick: () => editor.insertInlineContent([{ type: "mention", props: { kind: r.type, id: r.id, title: r.title } }, " "]),
        }));
    },
    [editor, noteId, tk],
  );

  const env = useMemo(
    () => ({
      noteId,
      today,
      partners,
      readOnly,
      tasks,
      setTask: (id: string, s: TaskState) => setTasks((m) => ({ ...m, [id]: s })),
    }),
    [noteId, today, partners, readOnly, tasks],
  );

  return (
    <NoteEditorEnv.Provider value={env}>
      <div className="note-editor relative -mx-2 sm:-mx-[54px]">
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          onChange={onChange}
          slashMenu={false}
          formattingToolbar={false}
        >
          <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(slashItems(editor), query)} />
          <SuggestionMenuController triggerCharacter="@" getItems={mentionItems} />
          <FormattingToolbarController
            formattingToolbar={() => (
              <FormattingToolbar>
                {...getFormattingToolbarItems()}
                {!aiOff ? (
                  <AiToolbarButton
                    key="ai"
                    label={t("aiButton")}
                    onClick={() => {
                      const text = editor.getSelectedText();
                      const sel = editor.getSelection();
                      const last = sel?.blocks[sel.blocks.length - 1] ?? editor.getTextCursorPosition().block;
                      setWriting({ text, afterBlockId: last.id, replace: true, context: editor.blocksToMarkdownLossy(editor.document).slice(0, 6000) });
                    }}
                  />
                ) : null}
              </FormattingToolbar>
            )}
          />
        </BlockNoteView>
      </div>
      <Dialog open={Boolean(picker)} onOpenChange={(v) => !v && setPicker(null)}>
        <DialogContent title={picker?.kind === "meeting" ? t("pickMeeting") : t("pickFile")}>
          {picker ? (
            <PickerBody
              types={[picker.kind]}
              onPick={(item) => {
                editor.insertBlocks([{ type: "entityCard", props: { kind: item.type, id: item.id, title: item.title } }], picker.blockId, "after");
                setPicker(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {writing ? (
        <WritingPanel
          noteId={noteId}
          request={writing}
          onClose={() => setWriting(null)}
          onApply={(markdown, mode) => {
            if (mode === "replace" && writing.replace) {
              editor.focus();
              editor.pasteMarkdown(markdown);
            } else {
              const blocks = editor.tryParseMarkdownToBlocks(markdown);
              editor.insertBlocks(blocks, writing.afterBlockId, "after");
            }
            setWriting(null);
          }}
        />
      ) : null}
    </NoteEditorEnv.Provider>
  );
}

function AiToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  const Components = useComponentsContext();
  if (!Components) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={label}
      mainTooltip={label}
      icon={<Sparkles size={16} />}
      onClick={onClick}
    >
      <span className="ml-1 text-[13px] font-medium">{label}</span>
    </Components.FormattingToolbar.Button>
  );
}
