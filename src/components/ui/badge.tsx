import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
  {
    variants: {
      variant: {
        neutral: "bg-panel-2 text-ink-2",
        ai: "bg-accent-soft text-accent-ink",
        accent: "bg-accent text-white dark:text-on-ink",
        outline: "border border-line-strong text-muted",
        ink: "bg-ink text-on-ink",
        overdue: "bg-accent-soft text-overdue",
        success: "bg-success/12 text-success",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-[12px]",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

/** Small round counter for the menu (amber when something waits). */
export function CountPill({ value, tone = "muted" }: { value: number; tone?: "muted" | "accent" }) {
  if (!value) return null;
  return tone === "accent" ? (
    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white dark:text-on-ink">
      {value > 99 ? "99+" : value}
    </span>
  ) : (
    <span className="text-[13px] text-muted">{value > 999 ? "999+" : value}</span>
  );
}
