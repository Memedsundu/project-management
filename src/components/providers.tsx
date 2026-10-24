"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { Tooltip } from "radix-ui";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
        {children}
      </Tooltip.Provider>
      <Toaster
        position="bottom-center"
        toastOptions={{
          classNames: {
            toast:
              "!rounded-2xl !border !border-line !bg-bg !text-ink !shadow-[var(--shadow)] !font-sans !text-[14px]",
            actionButton: "!rounded-full !bg-ink !text-on-ink !font-medium",
            cancelButton: "!rounded-full",
            description: "!text-muted",
          },
        }}
      />
    </ThemeProvider>
  );
}
