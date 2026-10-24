"use client";

import { Copy, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref?: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[36px] leading-none">{t("recoveryTitle")}</h1>
        <p className="text-[15px] text-muted">{t("recoveryBody")}</p>
      </div>
      <ol
        className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-2xl bg-panel p-5 font-mono text-[15px] tracking-wider print:bg-white"
        data-testid="recovery-codes"
      >
        {codes.map((c, i) => (
          <li key={c} className="flex gap-2">
            <span className="w-5 text-right text-faint">{i + 1}.</span>
            {c}
          </li>
        ))}
      </ol>
      <div className="no-print flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} />
          {t("printCodes")}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join("\n"));
            toast(tc("copied"));
          }}
        >
          <Copy size={16} />
          {t("copyCodes")}
        </Button>
      </div>
      {continueHref ? (
        <Button
          className="no-print"
          size="lg"
          onClick={() => {
            router.replace(continueHref);
            router.refresh();
          }}
        >
          {t("iSavedThem")}
        </Button>
      ) : null}
    </div>
  );
}
