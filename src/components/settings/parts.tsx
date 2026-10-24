"use client";

import { cn } from "@/lib/utils";

/** One block of Ayarlar: a serif heading, a line on what it is for, then rows. */
export function SettingsSection({ id, title, hint, children, className }: { id: string; title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cn("flex scroll-mt-24 flex-col gap-2", className)} data-testid={`settings-${id}`}>
      <h2 id={`${id}-h`} className="font-display text-[32px] leading-none">
        {title}
      </h2>
      {hint ? <p className="max-w-[62ch] text-[14px] text-muted">{hint}</p> : null}
      <div className="mt-2 flex flex-col rounded-2xl border border-line px-5">{children}</div>
    </section>
  );
}

/**
 * A setting: what it is on the left, the control on the right. Wide controls
 * drop below the words on phones; `inline` keeps a switch or a short button
 * on the right there too (iOS Settings).
 */
export function Row({
  label,
  hint,
  htmlFor,
  children,
  className,
  stack,
  inline,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
  stack?: boolean;
  inline?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-line-soft py-4 last:border-0",
        !stack && "sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        inline && "flex-row items-center justify-between gap-4",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[15px] font-medium">
            {label}
          </label>
        ) : (
          <span className="text-[15px] font-medium">{label}</span>
        )}
        {hint ? <span className="text-[13px] leading-snug text-muted">{hint}</span> : null}
      </div>
      {children !== undefined ? <div className={cn("flex min-w-0 flex-wrap items-center gap-2", !stack && "sm:shrink-0 sm:justify-end", inline && "shrink-0 justify-end")}>{children}</div> : null}
    </div>
  );
}

/** Pills for one choice out of a few (theme, language, spelling). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  testId,
}: {
  value: T | null;
  options: { value: T; label: React.ReactNode; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full bg-panel p-1" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors disabled:opacity-50",
            value === o.value ? "bg-bg font-medium text-ink shadow-[var(--shadow-sm,0_1px_2px_rgba(0,0,0,0.08))]" : "text-muted hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
