"use client";

import { Checkbox as C, Switch as S, Tabs as Tb } from "radix-ui";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox({
  className,
  round,
  ...props
}: React.ComponentProps<typeof C.Root> & { round?: boolean }) {
  return (
    <C.Root
      className={cn(
        "peer inline-flex h-5 w-5 shrink-0 items-center justify-center border-[1.5px] border-ink/70 bg-bg transition-colors data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=checked]:text-on-ink data-[state=indeterminate]:bg-ink data-[state=indeterminate]:text-on-ink",
        round ? "rounded-full" : "rounded-[6px]",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        {props.checked === "indeterminate" ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors data-[state=checked]:bg-ink",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-bg shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}

/** Pill tabs used for view switches (Liste, Yaklaşan, Pano ...). */
export function SegmentedLinks({
  items,
  active,
  className,
}: {
  items: { key: string; label: React.ReactNode; href: string; count?: number }[];
  active: string;
  className?: string;
}) {
  return (
    <nav className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          aria-current={it.key === active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-colors",
            it.key === active ? "bg-ink font-medium text-on-ink" : "text-muted hover:bg-panel hover:text-ink",
          )}
        >
          {it.label}
          {it.count ? (
            <span className={cn("text-[12px]", it.key === active ? "text-on-ink/70" : "text-faint")}>{it.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export const Tabs = Tb.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof Tb.List>) {
  return <Tb.List className={cn("flex flex-wrap items-center gap-1", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof Tb.Trigger>) {
  return (
    <Tb.Trigger
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] text-muted transition-colors hover:bg-panel hover:text-ink data-[state=active]:bg-ink data-[state=active]:font-medium data-[state=active]:text-on-ink",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = Tb.Content;

/** Filter chip (Drive style). */
export function Chip({
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors",
        active ? "border-ink bg-ink text-on-ink" : "border-line-strong text-ink hover:border-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
