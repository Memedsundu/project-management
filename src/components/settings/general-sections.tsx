"use client";

import { Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";
import { setLocaleAction } from "@/app/actions/preferences";
import { saveWorkingHoursAction } from "@/app/(app)/settings/actions";
import { useShell } from "@/components/shell/shell-context";
import { useMounted } from "@/components/shell/use-media-query";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { Row, Segmented, SettingsSection } from "./parts";

/** Görünüm ve dil: theme, language, time zone and the shortcut list. */
export function LookSection() {
  const t = useTranslations("settings.look");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [pending, start] = useTransition();
  return (
    <SettingsSection id="look" title={t("title")} hint={t("hint")}>
      <Row label={t("theme")} hint={t("themeHint")}>
        <Segmented
          label={t("theme")}
          value={mounted ? ((theme as "light" | "dark" | "system") ?? "light") : null}
          onChange={setTheme}
          options={[
            { value: "light", label: tn("themeLight"), icon: <Sun size={14} /> },
            { value: "dark", label: tn("themeDark"), icon: <Moon size={14} /> },
            { value: "system", label: tn("themeSystem"), icon: <Monitor size={14} /> },
          ]}
          testId="s-theme"
        />
      </Row>
      <Row label={t("language")} hint={t("languageHint")}>
        <Segmented
          label={t("language")}
          value={locale as "tr" | "en"}
          disabled={pending}
          onChange={(v) =>
            start(async () => {
              await setLocaleAction(v);
              router.refresh();
            })
          }
          options={[
            { value: "tr", label: "Türkçe" },
            { value: "en", label: "English" },
          ]}
          testId="s-language"
        />
      </Row>
      <Row label={t("timeZone")} hint={t("timeZoneHint")}>
        <span className="text-[14px] text-muted">Europe/Istanbul (UTC+3)</span>
      </Row>
      <Row label={t("shortcuts")} hint={t("shortcutsHint")}>
        <Button variant="outline" size="sm" onClick={shell.openShortcuts}>
          <Keyboard size={15} />
          {t("showShortcuts")}
        </Button>
      </Row>
    </SettingsSection>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Çalışma saatleri: the morning plan warns when a day holds more than these hours. */
export function HoursSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.hours");
  const tc = useTranslations("common");
  const [form, setForm] = useState(data.workingHours);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.workingHours);
  const valid = form.start < form.end && form.days.length > 0;
  const toggle = (d: number) => setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort() }));
  return (
    <SettingsSection id="hours" title={t("title")} hint={t("hint")}>
      <Row label={t("time")} htmlFor="s-hours-start">
        <span className="flex items-center gap-2">
          <Input id="s-hours-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="w-[140px]" disabled={data.readOnly} aria-label={t("start")} />
          <span className="text-muted">–</span>
          <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="w-[140px]" disabled={data.readOnly} aria-label={t("end")} aria-invalid={!valid} />
        </span>
      </Row>
      <Row label={t("days")}>
        <span className="flex flex-wrap gap-1.5" role="group" aria-label={t("days")}>
          {DAYS.map((d) => (
            <Chip key={d} active={form.days.includes(d)} aria-pressed={form.days.includes(d)} onClick={() => toggle(d)} disabled={data.readOnly} className="h-9 w-12 justify-center px-0">
              {t(`weekday.${d}`)}
            </Chip>
          ))}
        </span>
      </Row>
      {dirty && !data.readOnly ? (
        <div className="flex items-center justify-end gap-2 py-4">
          {!valid ? <span className="mr-auto text-[13px] text-overdue">{t("error")}</span> : null}
          <Button variant="ghost" onClick={() => setForm(data.workingHours)}>
            {tc("cancel")}
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              await runAction(saveWorkingHoursAction(form), { success: t("saved") });
              setBusy(false);
            }}
            data-testid="s-hours-save"
          >
            {tc("save")}
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}
