"use client";

import { ChevronDown, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Checkbox } from "@/components/ui/controls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { foldText } from "@/lib/fold";
import { cn } from "@/lib/utils";

export type PickOption = { id: string; label: string; hint?: string | null };

/** A checklist in a popover: partners, provinces or the activities one waits for. */
export function MultiPick({
  options,
  value,
  onToggle,
  placeholder,
  disabled,
  searchable,
  className,
  label,
}: {
  options: PickOption[];
  value: string[];
  onToggle: (id: string, on: boolean) => void;
  placeholder: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
  label: string;
}) {
  const tc = useTranslations("common");
  const [q, setQ] = useState("");
  const chosen = options.filter((o) => value.includes(o.id));
  const needle = foldText(q);
  const list = (needle ? options.filter((o) => foldText(`${o.label} ${o.hint ?? ""}`).includes(needle)) : options)
    .slice()
    .sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)));
  return (
    <Popover onOpenChange={(v) => !v && setQ("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn("inline-flex h-10 min-w-0 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-left text-[14px] hover:border-ink disabled:opacity-60", !chosen.length && "text-faint", className)}
        >
          <span className="min-w-0 flex-1 truncate">{chosen.length ? chosen.map((c) => c.label).join(", ") : placeholder}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-1.5">
        {searchable ? (
          <label className="mb-1 flex items-center gap-2 rounded-lg border border-line-strong px-2.5 focus-within:border-ink">
            <Search size={14} className="shrink-0 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tc("search")} aria-label={tc("search")} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
          </label>
        ) : null}
        <ul className="scrollbar-thin flex max-h-[300px] flex-col overflow-y-auto">
          {list.length === 0 ? <li className="px-2.5 py-2 text-[14px] text-muted">{tc("noResults")}</li> : null}
          {list.map((o) => {
            const on = value.includes(o.id);
            return (
              <li key={o.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] hover:bg-panel">
                  <Checkbox checked={on} onCheckedChange={(v) => onToggle(o.id, v === true)} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint ? <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted">{o.hint}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
