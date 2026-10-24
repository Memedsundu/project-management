"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { useShell } from "@/components/shell/shell-context";
import { parseTaskInput, type PartnerRef } from "@/lib/parse-task";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { ParseChips, parsedToInput } from "./parse-chips";

/** Todoist-style add row: type naturally, see what was understood, press Enter. */
export function InlineAdd({
  today,
  partners,
  defaults,
  placeholder,
  className,
  autoFocus,
}: {
  today: string;
  partners: PartnerRef[];
  defaults?: { dueDate?: string; ownerOrgId?: string; orgIds?: string[]; links?: { type: string; id: string }[]; parentId?: string };
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const shell = useShell();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (text.trim() ? parseTaskInput(text, { today, partners }) : null), [text, today, partners]);

  const submit = async () => {
    if (!parsed || busy) return;
    setBusy(true);
    const input = parsedToInput(parsed, { locale });
    const res = await runAction(
      createTaskAction({
        ...input,
        dueDate: input.dueDate ?? defaults?.dueDate ?? null,
        ownerOrgId: input.ownerOrgId ?? defaults?.ownerOrgId ?? null,
        orgIds: [...(input.orgIds ?? []), ...(defaults?.orgIds ?? [])],
        links: defaults?.links,
        parentId: defaults?.parentId ?? null,
      }),
    );
    setBusy(false);
    if (res) {
      setText("");
      toast(t("quick.taskSaved"));
    }
  };

  if (shell.readOnly) return null;
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-line-strong px-3 py-1.5 focus-within:border-ink", className)}>
      <div className="flex items-center gap-2.5">
        <Plus size={18} className="shrink-0 text-muted" />
        <input
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (pasted.includes("\n")) {
              e.preventDefault();
              shell.openQuickAdd({ text: pasted, mode: "task" });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") setText("");
          }}
          placeholder={placeholder ?? t("addTaskPlaceholder")}
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          aria-label={t("addTask")}
          data-testid="inline-add"
        />
        {text.trim() ? (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center rounded-full bg-ink px-3.5 text-[14px] font-medium text-on-ink disabled:opacity-50"
          >
            {t("quick.save")}
          </button>
        ) : null}
      </div>
      {parsed && parsed.tokens.length ? <ParseChips parsed={parsed} className="pb-1.5 pl-7" /> : null}
    </div>
  );
}
