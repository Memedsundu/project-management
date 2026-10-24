"use client";

import { ArrowUpRight, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { saveScheduledHelpersAction } from "@/app/(app)/settings/actions";
import { deleteRecipeAction, runRecipeAction, saveRecipeAction } from "@/app/actions/recipes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, Tip } from "@/components/ui/overlay";
import { formatDay, relativeDayLabel, dayOf } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { modelName } from "./ai-section";
import { Row, SettingsSection } from "./parts";

type Recipe = SettingsData["helpers"]["recipes"][number];
type Schedule = Recipe["schedule"];
const SCHEDULES = ["none", "daily_0800", "friday_1600", "monthly_first_workday"] as const;
const SWITCHES = [
  { key: "dailyBrief", kind: "daily" },
  { key: "weeklyReview", kind: "weekly" },
  { key: "partnerCheck", kind: "partner_check" },
] as const;

/**
 * Yardımcılar (Notion Custom Agents): the three scheduled helpers, each one
 * switchable, and her saved instructions (Granola Recipes) to run on a page
 * or on a schedule. What they write is kept on Özetler.
 */
export function HelpersSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.helpers");
  const locale = useLocale();
  const router = useRouter();
  const disabled = data.readOnly;
  const [on, setOn] = useState(data.helpers.scheduled);
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const aiReady = data.ai.configured && data.ai.enabled;

  const flip = async (key: (typeof SWITCHES)[number]["key"], value: boolean) => {
    setOn((s) => ({ ...s, [key]: value }));
    if ((await runAction(saveScheduledHelpersAction({ [key]: value }), { success: t("saved") })) === undefined) setOn((s) => ({ ...s, [key]: !value }));
  };

  const run = async (r: Recipe) => {
    setRunning(r.id);
    const res = await runAction(runRecipeAction(r.id, null));
    setRunning(null);
    if (res) toast(t("ran", { name: r.name }), { action: { label: t("open"), onClick: () => router.push(`/briefs/${res.id}`) } });
  };

  const remove = async (r: Recipe) => {
    await runAction(deleteRecipeAction(r.id), { success: t("deleted") });
  };

  return (
    <SettingsSection id="helpers" title={t("title")} hint={t("hint")}>
      {SWITCHES.map((s) => (
        <Row
          key={s.key}
          inline
          label={t(s.key)}
          htmlFor={`s-helper-${s.key}`}
          hint={
            <>
              {t(`${s.key}Hint`)}
              {data.helpers.last[s.kind] ? ` ${t("last", { date: relativeDayLabel(data.helpers.last[s.kind]!, locale) })}` : ""}
            </>
          }
        >
          <Switch id={`s-helper-${s.key}`} checked={on[s.key]} disabled={disabled} onCheckedChange={(v) => flip(s.key, v)} data-testid={`s-helper-${s.key}`} />
        </Row>
      ))}
      <Row label={t("briefs")} hint={t("briefsHint")}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/briefs" data-testid="s-open-briefs">
            {t("openBriefs")}
            <ArrowUpRight size={15} />
          </Link>
        </Button>
      </Row>

      <div className="flex flex-col gap-3 py-4" data-testid="s-recipes">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-medium">{t("recipes")}</span>
            <span className="max-w-[56ch] text-[13px] leading-snug text-muted">{t("recipesHint")}</span>
          </span>
          {!disabled ? (
            <Button variant="outline" size="sm" onClick={() => setEditing("new")} data-testid="s-recipe-new">
              <Plus size={15} />
              {t("newRecipe")}
            </Button>
          ) : null}
        </div>
        {!aiReady ? <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent-ink">{t("aiOff")}</p> : null}
        <ul className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line">
          {data.helpers.recipes.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="s-recipe">
              <span className="flex min-w-0 grow basis-full flex-col gap-0.5 sm:basis-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[15px] font-medium">{r.name}</span>
                  {r.builtin ? (
                    <Badge variant="outline" size="sm">
                      {t("builtin")}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-[13px] text-muted">
                  {[t(`schedules.${r.schedule ?? "none"}`), modelName(r.model), r.lastRunAt ? t("lastRun", { date: formatDay(dayOf(r.lastRunAt), locale) }) : t("never")].join(" · ")}
                </span>
              </span>
              {!disabled ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => run(r)} disabled={running !== null || !aiReady} data-testid="s-recipe-run">
                    {running === r.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    {running === r.id ? t("running") : t("run")}
                  </Button>
                  <Tip content={t("edit")}>
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t("editName", { name: r.name })} data-testid="s-recipe-edit">
                      <Pencil size={14} />
                    </Button>
                  </Tip>
                  {!r.builtin ? (
                    <Tip content={t("delete")}>
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(r)} aria-label={t("deleteName", { name: r.name })} data-testid="s-recipe-delete">
                        <Trash2 size={14} />
                      </Button>
                    </Tip>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <RecipeDialog key={editing === "new" ? "new" : (editing?.id ?? "none")} recipe={editing} models={data.helpers.models} onClose={() => setEditing(null)} />
    </SettingsSection>
  );
}

function RecipeDialog({ recipe, models, onClose }: { recipe: Recipe | "new" | null; models: string[]; onClose: () => void }) {
  const t = useTranslations("settings.helpers.dialog");
  const ts = useTranslations("settings.helpers");
  const tc = useTranslations("common");
  const existing = recipe && recipe !== "new" ? recipe : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [model, setModel] = useState(existing?.model ?? models[0]!);
  const [schedule, setSchedule] = useState<NonNullable<Schedule> | "none">(existing?.schedule ?? "none");
  const [saving, setSaving] = useState(false);
  const ready = name.trim().length > 0 && instructions.trim().length >= 5;

  const save = async () => {
    setSaving(true);
    const res = await runAction(saveRecipeAction(existing?.id ?? null, { name: name.trim(), instructions: instructions.trim(), model, schedule: schedule === "none" ? null : schedule }), { success: t("saved") });
    setSaving(false);
    if (res !== undefined) onClose();
  };

  return (
    <Dialog open={recipe !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={existing ? t("editTitle") : t("newTitle")} description={t("description")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !saving) void save();
          }}
        >
          <Field label={t("name")} htmlFor="recipe-name">
            <Input id="recipe-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t("namePlaceholder")} autoFocus data-testid="recipe-name" />
          </Field>
          <Field label={t("instructions")} htmlFor="recipe-text" hint={t("instructionsHint")}>
            <Textarea id="recipe-text" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={7} maxLength={6000} placeholder={t("instructionsPlaceholder")} data-testid="recipe-text" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("model")} htmlFor="recipe-model" hint={t("modelHint")}>
              <Select id="recipe-model" value={model} onChange={(e) => setModel(e.target.value)} data-testid="recipe-model">
                {models.map((m) => (
                  <option key={m} value={m}>
                    {modelName(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("schedule")} htmlFor="recipe-schedule" hint={t("scheduleHint")}>
              <Select id="recipe-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)} data-testid="recipe-schedule">
                {SCHEDULES.map((s) => (
                  <option key={s} value={s}>
                    {ts(`schedules.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!ready || saving} data-testid="recipe-save">
              {saving ? <Loader2 size={15} className="animate-spin" /> : null}
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
