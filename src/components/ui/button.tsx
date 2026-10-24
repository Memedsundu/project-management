import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Peni pill buttons: black primary, outlined secondary, quiet ghost. 44px touch targets. */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-on-ink hover:bg-ink/85",
        secondary: "border border-ink text-ink hover:bg-panel",
        outline: "border border-line-strong text-ink hover:border-ink",
        ghost: "text-ink hover:bg-panel",
        subtle: "bg-panel text-ink hover:bg-panel-2",
        accent: "bg-accent text-white hover:bg-accent/90 dark:text-on-ink",
        danger: "border border-danger/40 text-danger hover:bg-danger/10",
        link: "rounded-md px-0 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3.5 text-[14px]",
        md: "h-11 px-5 text-[15px]",
        lg: "h-12 px-6 text-[16px]",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
