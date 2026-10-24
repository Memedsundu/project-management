import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-bg", className)} {...props} />;
}

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl bg-panel p-5", className)} {...props} />;
}

/** Summary number card from the Bugün screen: label, serif number, one quiet line. */
export function StatCard({
  label,
  value,
  note,
  noteTone = "muted",
  href,
  extra,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  noteTone?: "muted" | "overdue";
  href?: string;
  extra?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[14px] text-muted">
        {label}
        {extra}
      </span>
      <span className="font-display text-[40px] leading-none">{value}</span>
      {note ? (
        <span className={cn("text-[13px]", noteTone === "overdue" ? "font-medium text-overdue" : "text-muted")}>
          {note}
        </span>
      ) : null}
    </>
  );
  const cls =
    "flex min-h-[124px] flex-col gap-2 rounded-2xl border border-line px-5 py-[18px] transition-colors";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-ink")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  eyebrow,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow ? <div className="text-[13px] text-muted">{eyebrow}</div> : null}
        <h1 className="font-display text-[40px] leading-[1.05] md:text-[56px] md:leading-none">{title}</h1>
        {subtitle ? <p className="max-w-[70ch] text-[16px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionTitle({
  children,
  action,
  id,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <h2 id={id} className="text-[20px] font-semibold">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
  icon,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-8",
        className,
      )}
    >
      {icon ? <div className="text-muted">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-[16px] font-medium">{title}</p>
        {body ? <p className="max-w-[60ch] text-[14px] text-muted">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong bg-bg px-1.5 font-mono text-[12px] text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-panel", className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line-soft", className)} />;
}
