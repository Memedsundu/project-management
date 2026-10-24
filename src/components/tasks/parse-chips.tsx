"use client";

import { AlarmClock, ArrowRight, CalendarDays, Clock, Flag, Hash, Handshake, Repeat, Timer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { relativeDayLabel } from "@/lib/dates";
import { describeRule, type ParsedTask, type TokenKind } from "@/lib/parse-task";
import { cn } from "@/lib/utils";

const ICONS: Record<TokenKind, typeof CalendarDays> = {
  date: CalendarDays,
  start: AlarmClock,
  time: Clock,
  priority: Flag,
  tag: Hash,
  partner: Handshake,
  owner: ArrowRight,
  recurrence: Repeat,
  estimate: Timer,
};

/** What the quick-add parser understood, shown as quiet chips under the input. */
export function ParseChips({ parsed, className }: { parsed: ParsedTask | null; className?: string }) {
  const t = useTranslations("tasks.tokens");
  const locale = useLocale();
  if (!parsed || parsed.tokens.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} aria-live="polite">
      {parsed.tokens.map((tok, i) => {
        const Icon = ICONS[tok.kind];
        const value = tok.kind === "date" || tok.kind === "start" ? relativeDayLabel(tok.value, locale) : tok.value;
        return (
          <span
            key={`${tok.kind}-${i}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-panel px-2.5 text-[12.5px] text-ink-2"
            title={t(tok.kind === "date" ? "date" : tok.kind)}
          >
            <Icon size={12} className={tok.kind === "priority" && tok.value === "p1" ? "text-accent" : "text-muted"} />
            <span className="text-muted">{t(tok.kind === "date" ? "date" : tok.kind)}:</span>
            {value}
          </span>
        );
      })}
    </div>
  );
}

/** Turn a parse into the fields the task service takes. */
export function parsedToInput(p: ParsedTask, extra: { inbox?: boolean; parentId?: string | null; locale?: string } = {}) {
  return {
    title: p.title,
    dueDate: p.dueDate,
    startDate: p.startDate,
    dueTime: p.dueTime,
    priority: p.priority ?? undefined,
    tags: p.tags.length ? p.tags : undefined,
    orgIds: p.orgId ? [p.orgId] : undefined,
    ownerOrgId: p.ownerOrgId,
    ownerName: p.ownerOrgId ? null : p.ownerName,
    recurrence: p.recurrence,
    recurrenceLabel: p.recurrence ? describeRule(p.recurrence, extra.locale === "en" ? "en" : "tr") : null,
    estimateMin: p.estimateMin,
    inbox: extra.inbox,
    parentId: extra.parentId ?? null,
  };
}
