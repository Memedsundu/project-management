"use client";

import { BookOpenText, FolderLock, Lock } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { saveAiAction } from "@/app/(app)/settings/actions";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Input, Select } from "@/components/ui/input";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { SettingsData } from "@/server/views/settings";
import { Row, SettingsSection } from "./parts";

/** "claude-sonnet-5-5" → "Sonnet 5.5" */
export const modelName = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  return `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
};

/** Yapay zekâ: on or off, the monthly cap and what was spent, models, memory and what Claude never reads. */
export function AiSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.ai");
  const locale = useLocale();
  const shell = useShell();
  const ai = data.ai;
  const [cap, setCap] = useState(String(ai.capUsd));
  const [enabled, setEnabled] = useState(ai.enabled);
  const share = ai.capUsd > 0 ? Math.min(1, ai.spentUsd / ai.capUsd) : 1;
  const usd = (n: number) => new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
  const disabled = data.readOnly;

  const saveCap = async () => {
    const value = Number(cap.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      setCap(String(ai.capUsd));
      return;
    }
    if (value !== ai.capUsd) await runAction(saveAiAction({ monthlyCapUsd: value }), { success: t("capSaved") });
  };

  return (
    <SettingsSection id="ai" title={t("title")} hint={t("hint")}>
      {!ai.configured ? (
        <p className="my-4 rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-accent-ink" data-testid="s-ai-missing">
          {t("notConfigured")}
        </p>
      ) : null}
      <Row inline label={t("enabled")} hint={t("enabledHint")} htmlFor="s-ai-on">
        <Switch
          id="s-ai-on"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={async (v) => {
            setEnabled(v);
            if ((await runAction(saveAiAction({ enabled: v }))) === undefined) setEnabled(!v);
          }}
          data-testid="s-ai-on"
        />
      </Row>
      <Row inline label={t("cap")} hint={t("capHint")} htmlFor="s-ai-cap">
        <span className="flex items-center gap-2">
          <span className="text-[14px] text-muted">$</span>
          <Input
            id="s-ai-cap"
            inputMode="decimal"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={saveCap}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            className="w-[96px] text-right"
            disabled={disabled}
            data-testid="s-ai-cap"
          />
        </span>
      </Row>
      <div className="flex flex-col gap-3 border-b border-line-soft py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[15px] font-medium">{t("thisMonth")}</span>
          <span className="text-[14px] tabular-nums" data-testid="s-ai-spent">
            {t("spentOf", { spent: usd(ai.spentUsd), cap: usd(ai.capUsd) })}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-panel-2"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={ai.capUsd}
          aria-valuenow={Math.round(ai.spentUsd * 100) / 100}
          aria-label={t("thisMonth")}
        >
          <div className={cn("h-full rounded-full", share >= 0.8 ? "bg-accent" : "bg-ink")} style={{ width: `${Math.max(share * 100, ai.spentUsd > 0 ? 2 : 0)}%` }} />
        </div>
        {share >= 1 ? <p className="text-[13px] text-accent-ink">{t("capReached")}</p> : share >= 0.8 ? <p className="text-[13px] text-accent-ink">{t("capNear")}</p> : null}
        {ai.byHelper.length ? (
          <ul className="flex flex-col text-[14px]" aria-label={t("byHelper")}>
            {ai.byHelper.slice(0, 8).map((h) => (
              <li key={h.helper} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0 truncate text-ink-2">{locale === "en" ? h.labelEn : h.labelTr}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {t("runs", { count: h.runs })} · {usd(h.usd)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{t("nothingYet")}</p>
        )}
      </div>
      <Row label={t("memory")} hint={t("memoryHint")}>
        <Button variant="outline" size="sm" onClick={() => shell.openAssistant(undefined, { view: "memory" })} data-testid="s-ai-memory">
          <BookOpenText size={15} />
          {t("openMemory")}
        </Button>
      </Row>
      <Row label={t("aiOff")} hint={t("aiOffHint")} stack>
        {ai.aiOff.folders.length || ai.aiOff.documents ? (
          <ul className="flex flex-col gap-1 text-[14px]">
            {ai.aiOff.folders.map((f) => (
              <li key={f.id}>
                <Link href={f.href} className="inline-flex min-h-9 items-center gap-2 hover:underline">
                  <FolderLock size={15} className="text-muted" />
                  {f.name}
                </Link>
              </li>
            ))}
            {ai.aiOff.documents ? (
              <li className="inline-flex min-h-9 items-center gap-2 text-ink-2">
                <Lock size={14} className="text-muted" />
                {t("aiOffFiles", { count: ai.aiOff.documents })}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t("aiOffNone")}</p>
        )}
      </Row>
      <details className="group border-t border-line-soft py-4">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium">
          <span className="flex flex-col gap-0.5">
            {t("models")}
            <span className="text-[13px] font-normal text-muted">{t("modelsHint")}</span>
          </span>
          <span className="text-[13px] font-normal text-muted group-open:hidden">{t("show")}</span>
        </summary>
        <ul className="mt-3 flex flex-col">
          {ai.helpers.map((h) => (
            <li key={h.key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-2 last:border-0">
              <span className="text-[14px]">{locale === "en" ? h.labelEn : h.labelTr}</span>
              <Select
                value={h.model}
                onChange={(e) => runAction(saveAiAction({ models: { [h.key]: e.target.value } }), { success: t("modelSaved") })}
                disabled={disabled}
                className="h-9 w-[180px] text-[14px]"
                aria-label={locale === "en" ? h.labelEn : h.labelTr}
              >
                {ai.models.map((m) => (
                  <option key={m} value={m}>
                    {modelName(m)}
                    {m === h.defaultModel ? ` · ${t("default")}` : ""}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      </details>
    </SettingsSection>
  );
}
