"use client";

import { Dialog as D, DropdownMenu as DM, Popover as P, Tooltip as T } from "radix-ui";
import { X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import * as React from "react";
import { cn } from "@/lib/utils";

/* ---------- Dialog ---------- */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  children,
  className,
  title,
  description,
  hideTitle,
  wide,
  ...props
}: React.ComponentProps<typeof D.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
  wide?: boolean;
}) {
  const tc = useTranslations("common");
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[var(--shadow)] outline-none",
          wide ? "max-w-[880px]" : "max-w-[560px]",
          className,
        )}
        {...props}
      >
        <div className={cn("flex items-start justify-between gap-4 px-6 pt-5", hideTitle && "sr-only")}>
          <div className="flex flex-col gap-1">
            <D.Title className="text-[18px] font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-[14px] text-muted">{description}</D.Description> : null}
          </div>
          <D.Close
            className="-mr-2 -mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
            aria-label={tc("close")}
          >
            <X size={18} />
          </D.Close>
        </div>
        {hideTitle ? null : null}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/* ---------- Sheet (side panel) ---------- */

export function SheetContent({
  children,
  className,
  title,
  side = "right",
  ...props
}: React.ComponentProps<typeof D.Content> & { title: React.ReactNode; side?: "right" | "left" | "bottom" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/25" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col bg-bg shadow-[var(--shadow)] outline-none",
          side === "right" && "inset-y-0 right-0 w-[min(420px,100vw)] border-l border-line",
          side === "left" && "inset-y-0 left-0 w-[min(320px,88vw)] border-r border-line",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t border-line pb-[env(safe-area-inset-bottom)]",
          className,
        )}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/* ---------- Dropdown menu ---------- */

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-[200px] overflow-hidden rounded-xl border border-line bg-bg p-1.5 shadow-[var(--shadow)]",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger,
  href,
  children,
  ...props
}: React.ComponentProps<typeof DM.Item> & { danger?: boolean; href?: string }) {
  const cls = cn(
    "flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none data-[highlighted]:bg-panel data-[disabled]:opacity-40",
    danger && "text-danger",
    className,
  );
  if (href) {
    return (
      <DM.Item asChild className={cls} {...props}>
        <Link href={href}>{children}</Link>
      </DM.Item>
    );
  }
  return (
    <DM.Item className={cls} {...props}>
      {children}
    </DM.Item>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 pb-1 pt-2 text-[12px] font-semibold text-muted", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line-soft" />;
}

export const DropdownMenuSub = DM.Sub;
export function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof DM.SubTrigger>) {
  return (
    <DM.SubTrigger
      className={cn(
        "flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none data-[highlighted]:bg-panel data-[state=open]:bg-panel",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent
        sideOffset={4}
        className={cn("z-50 min-w-[180px] rounded-xl border border-line bg-bg p-1.5 shadow-[var(--shadow)]", className)}
        {...props}
      />
    </DM.Portal>
  );
}

/* ---------- Popover ---------- */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({ className, align = "start", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 rounded-2xl border border-line bg-bg p-3 shadow-[var(--shadow)] outline-none", className)}
        {...props}
      />
    </P.Portal>
  );
}

/* ---------- Tooltip ---------- */

export function Tip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-[300px] rounded-xl bg-ink px-3 py-2 text-[13px] leading-snug text-on-ink"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
