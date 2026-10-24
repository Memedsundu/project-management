"use client";

import { BarChart3, CalendarRange, Gauge, Handshake, LayoutTemplate, Loader2, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createVisualAction, proposeChartAction } from "@/app/(app)/reports/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { chartSpecSchema, onePagerSpecSchema, TYPES_FOR, type ChartSource } from "@/lib/visuals";

export const SOURCE_ICONS: Record<ChartSource, typeof BarChart3> = {
  indicator_periods: BarChart3,
  indicator_partners: Handshake,
  indicator_progress: Gauge,
  workplan_status: CalendarRange,
};

/**
 * "Yeni grafik" / "Yeni tek sayfa": a name and what to show. A chart can
 * start from one of four kinds or from a sentence Claude turns into a spec.
 */
export function NewVisualDialog({ open, onOpenChange, kind, reportId, aiReady = true }: { open: boolean; onOpenChange: (v: boolean) => void; kind: "chart" | "onepager"; reportId: string | null; aiReady?: boolean }) {
  const t = useTranslations("reports.visuals");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<ChartSource>("indicator_periods");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<"make" | "ask" | null>(null);

  async function create(input: { title: string; spec: Record<string, unknown> }) {
    const res = await runAction(createVisualAction({ title: input.title, kind, spec: input.spec, reportId }));
    if (!res) return;
    onOpenChange(false);
    router.push(`/reports/visuals/${res.id}`);
  }

  async function make(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy("make");
    const spec = kind === "chart" ? chartSpecSchema.parse({ source, type: TYPES_FOR[source][0] }) : onePagerSpecSchema.parse({ heading: title.trim() });
    await create({ title: title.trim(), spec });
    setBusy(null);
  }

  async function ask() {
    if (prompt.trim().length < 3 || busy) return;
    setBusy("ask");
    const res = await runAction(proposeChartAction(prompt.trim()));
    if (res) await create({ title: title.trim() || res.title, spec: res.spec });
    setBusy(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={kind === "chart" ? t("newChartTitle") : t("newOnePagerTitle")} description={kind === "chart" ? t("newChartHint") : t("newOnePagerHint")} wide={kind === "chart"}>
        <form className="flex flex-col gap-5" onSubmit={make}>
          <Field label={t("name")} htmlFor="v-title">
            <Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={kind === "chart" ? t("namePlaceholder") : t("onePagerPlaceholder")} data-testid="visual-title" />
          </Field>
          {kind === "chart" ? (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[14px] font-medium">{t("what")}</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(Object.keys(SOURCE_ICONS) as ChartSource[]).map((s) => {
                    const Icon = SOURCE_ICONS[s];
                    return (
                      <label key={s} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition-colors", source === s ? "border-ink bg-panel" : "border-line hover:border-ink")} data-testid="visual-source">
                        <input type="radio" name="source" className="sr-only" checked={source === s} onChange={() => setSource(s)} />
                        <Icon size={17} className="mt-0.5 shrink-0 text-muted" />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-[15px] font-medium">{t(`sources.${s}`)}</span>
                          <span className="text-[13px] text-muted">{t(`sourceHints.${s}`)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {aiReady ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3.5">
                  <label htmlFor="v-prompt" className="flex items-center gap-2 text-[14px] font-medium">
                    <Sparkles size={15} />
                    {t("orDescribe")}
                  </label>
                  <Textarea id="v-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={600} placeholder={t("describePlaceholder")} className="min-h-16 bg-bg text-[14px]" data-testid="visual-prompt" />
                  <Button type="button" variant="outline" size="sm" className="self-start" disabled={prompt.trim().length < 3 || Boolean(busy)} onClick={() => void ask()} data-testid="visual-ask">
                    {busy === "ask" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {busy === "ask" ? t("thinking") : t("describeGo")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="flex items-start gap-2 text-[14px] text-muted">
              <LayoutTemplate size={16} className="mt-0.5 shrink-0" />
              {t("onePagerAbout")}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || Boolean(busy)} data-testid="visual-create">
              {busy === "make" ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
