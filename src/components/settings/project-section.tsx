"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveProfileAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { SettingsSection } from "./parts";

/** Proje: the app's name, the project's name and code, the donor and the years. */
export function ProjectSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.project");
  const tc = useTranslations("common");
  const [form, setForm] = useState(data.profile);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.profile);
  const yearsOk = form.endYear >= form.startYear && form.endYear - form.startYear <= 15;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const disabled = data.readOnly;

  return (
    <SettingsSection id="project" title={t("title")} hint={t("hint")}>
      <form
        className="flex flex-col gap-4 py-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!dirty || !yearsOk) return;
          setBusy(true);
          await runAction(saveProfileAction(form), { success: t("saved") });
          setBusy(false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("appName")} hint={t("appNameHint")} htmlFor="s-app-name">
            <Input id="s-app-name" value={form.appName} maxLength={40} onChange={(e) => set({ appName: e.target.value })} disabled={disabled} required data-testid="s-app-name" />
          </Field>
          <Field label={t("projectName")} htmlFor="s-project-name">
            <Input id="s-project-name" value={form.projectName} maxLength={200} onChange={(e) => set({ projectName: e.target.value })} disabled={disabled} required />
          </Field>
          <Field label={t("projectCode")} hint={t("projectCodeHint")} htmlFor="s-project-code">
            <Input id="s-project-code" value={form.projectCode} maxLength={60} onChange={(e) => set({ projectCode: e.target.value })} disabled={disabled} />
          </Field>
          <Field label={t("donor")} htmlFor="s-donor">
            <Input id="s-donor" value={form.donor} maxLength={120} onChange={(e) => set({ donor: e.target.value })} disabled={disabled} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("startYear")} htmlFor="s-start">
              <Input id="s-start" type="number" inputMode="numeric" min={2000} max={2100} value={form.startYear} onChange={(e) => set({ startYear: Number(e.target.value) || form.startYear })} disabled={disabled} aria-invalid={!yearsOk} />
            </Field>
            <Field label={t("endYear")} htmlFor="s-end">
              <Input id="s-end" type="number" inputMode="numeric" min={2000} max={2100} value={form.endYear} onChange={(e) => set({ endYear: Number(e.target.value) || form.endYear })} disabled={disabled} aria-invalid={!yearsOk} />
            </Field>
          </div>
          <Field label={t("spelling")} hint={t("spellingHint")} htmlFor="s-spelling">
            <Select id="s-spelling" value={form.reportSpelling} onChange={(e) => set({ reportSpelling: e.target.value as "en-GB" | "en-US" })} disabled={disabled}>
              <option value="en-GB">{t("british")}</option>
              <option value="en-US">{t("american")}</option>
            </Select>
          </Field>
        </div>
        {!yearsOk ? <p className="text-[13px] text-overdue">{t("yearsError")}</p> : null}
        {!disabled ? (
          <div className="flex justify-end gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => setForm(data.profile)}>
                {tc("cancel")}
              </Button>
            ) : null}
            <Button type="submit" disabled={!dirty || !yearsOk || busy} data-testid="s-project-save">
              {tc("save")}
            </Button>
          </div>
        ) : null}
      </form>
    </SettingsSection>
  );
}
