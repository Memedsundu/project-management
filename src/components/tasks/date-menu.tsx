"use client";

import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { inputClass } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { addDaysStr, relativeDayLabel, todayStr } from "@/lib/dates";
import { parseTaskInput } from "@/lib/parse-task";
import { cn } from "@/lib/utils";

function nextDow(today: string, target: number) {
  const d = new Date(today + "T12:00:00");
  const diff = (target - d.getDay() + 7) % 7 || 7;
  return addDaysStr(today, diff);
}

/** Quick dates (Bugün, Yarın …), a date field, and a phrase box ("haftaya cuma"). */
export function DatePanel({ value, onChange, allowClear = true }: { value: string | null; onChange: (date: string | null) => void; allowClear?: boolean }) {
  const t = useTranslations("tasks");
  const today = todayStr();
  const [phrase, setPhrase] = useState("");
  const parsed = phrase.trim() ? parseTaskInput(phrase, { today }).dueDate : null;
  const quick = [
    { key: "today", date: today },
    { key: "tomorrow", date: addDaysStr(today, 1) },
    { key: "weekend", date: nextDow(today, 6) },
    { key: "nextWeek", date: nextDow(today, 1) },
  ] as const;
  return (
    <div className="flex w-[260px] flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        {quick.map((q) => (
          <button
            key={q.key}
            type="button"
            onClick={() => onChange(q.date)}
            className={cn(
              "h-9 rounded-full border px-3 text-[13px]",
              value === q.date ? "border-ink bg-ink text-on-ink" : "border-line-strong hover:border-ink",
            )}
          >
            {t(`dateQuick.${q.key}`)}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(inputClass, "h-10")}
        aria-label={t("pickDate")}
      />
      <input
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && parsed) {
            e.preventDefault();
            onChange(parsed);
            setPhrase("");
          }
        }}
        placeholder={t("datePhrase")}
        className={cn(inputClass, "h-10 text-[14px]")}
        aria-label={t("datePhrase")}
      />
      {parsed ? (
        <button type="button" onClick={() => onChange(parsed)} className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-left text-[13px]">
          <CalendarDays size={14} /> {parsed}
        </button>
      ) : null}
      {allowClear && value ? (
        <button type="button" onClick={() => onChange(null)} className="h-9 rounded-full text-[13px] text-muted hover:bg-panel hover:text-ink">
          {t("dateQuick.none")}
        </button>
      ) : null}
    </div>
  );
}

/** A date field that opens the quick-date panel. */
export function DateButton({
  value,
  onChange,
  disabled,
  overdue,
  className,
}: {
  value: string | null;
  onChange: (d: string | null) => void;
  disabled?: boolean;
  overdue?: boolean;
  className?: string;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-xl border border-line-strong px-3 text-left text-[14px] hover:border-ink",
            !value && "text-faint",
            overdue && "font-medium text-overdue",
            className,
          )}
        >
          <CalendarDays size={15} />
          {value ? relativeDayLabel(value, locale) : t("noDate")}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <DatePanel
          value={value}
          onChange={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
