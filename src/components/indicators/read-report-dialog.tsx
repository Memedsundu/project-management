"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { readIndicatorsAction } from "@/app/(app)/files/actions";
import { PickerBody } from "@/components/common/entity-picker";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";

/**
 * "Rapordan değer okut": she picks a partner report and Claude lists the
 * indicator totals in it with their pages, as a card on the file to approve.
 */
export function ReadReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useTranslations("indicators.read");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function read(id: string, title: string) {
    setBusy(title);
    const res = await runAction(readIndicatorsAction(id));
    setBusy(null);
    if (!res) return;
    onOpenChange(false);
    toast(t("done", { title }), { action: { label: t("open"), onClick: () => router.push(`/files/d/${id}`) } });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent title={t("title")} description={t("description")}>
        {busy ? (
          <p className="flex items-center gap-2 py-6 text-[14px] text-muted" aria-live="polite">
            <Loader2 size={16} className="animate-spin" />
            {t("reading", { title: busy })}
          </p>
        ) : (
          <PickerBody types={["document"]} placeholder={t("placeholder")} onPick={(item) => void read(item.id, item.title)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
