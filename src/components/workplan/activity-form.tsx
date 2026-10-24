"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { createActivityAction } from "@/app/(app)/workplan/actions";
import { DateButton } from "@/components/tasks/date-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { PROVINCES } from "@/lib/provinces";
import { nextCode } from "./activity-table";
import { MultiPick } from "./pickers";
import type { WorkplanData } from "./types";

/** "Yeni faaliyet": code, name, output, partners, places and dates. */
export function ActivityDialog({ open, onOpenChange, data, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; data: WorkplanData; onCreated: (id: string) => void }) {
  const t = useTranslations("workplan");
  const tc = useTranslations("common");
  const [output, setOutput] = useState<string>(data.outputs[0]?.id ?? "");
  const codesIn = (id: string) => data.activities.filter((a) => (id ? a.logframeNodeId === id : !a.logframeNodeId)).map((a) => a.code);
  const suggest = (id: string) => {
    const codes = codesIn(id);
    if (codes.length) return nextCode(codes);
    const o = data.outputs.find((x) => x.id === id);
    return o ? `${o.code}.1` : nextCode(data.activities.map((a) => a.code));
  };
  const [code, setCode] = useState(() => suggest(data.outputs[0]?.id ?? ""));
  const [codeTouched, setCodeTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [milestone, setMilestone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !code.trim()) return;
    setBusy(true);
    const res = await runAction(
      createActivityAction({
        code: code.trim(),
        title: title.trim(),
        logframeNodeId: output || null,
        startDate: start,
        endDate: milestone ? start : end && start && end < start ? start : end,
        orgIds,
        provinces,
        isMilestone: milestone,
      }),
    );
    setBusy(false);
    if (res) {
      onOpenChange(false);
      onCreated(res.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("form.title")} description={t("form.description")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label={t("table.code")}>
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeTouched(true);
                }}
                required
              />
            </Field>
            <Field label={t("form.name")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("form.namePlaceholder")} required autoFocus data-testid="activity-title" />
            </Field>
          </div>
          <Field label={t("table.output")}>
            <Select
              value={output}
              onChange={(e) => {
                setOutput(e.target.value);
                if (!codeTouched) setCode(suggest(e.target.value));
              }}
            >
              <option value="">—</option>
              {data.outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} {o.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={milestone ? t("sheet.date") : t("table.start")}>
              <DateButton value={start} onChange={setStart} className="w-full" />
            </Field>
            {!milestone ? (
              <Field label={t("table.end")}>
                <DateButton value={end} onChange={setEnd} className="w-full" />
              </Field>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("table.partners")}>
              <MultiPick
                label={t("table.partners")}
                options={data.orgs.map((o) => ({ id: o.id, label: o.shortName || o.name, hint: o.shortName ? o.name : null }))}
                value={orgIds}
                placeholder={t("table.choose")}
                onToggle={(id, on) => setOrgIds((v) => (on ? [...v, id] : v.filter((x) => x !== id)))}
                className="w-full"
              />
            </Field>
            <Field label={t("table.provinces")}>
              <MultiPick
                label={t("table.provinces")}
                searchable
                options={PROVINCES.map((p) => ({ id: p, label: p }))}
                value={provinces}
                placeholder={t("table.choose")}
                onToggle={(id, on) => setProvinces((v) => (on ? [...v, id] : v.filter((x) => x !== id)))}
                className="w-full"
              />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-[14px]">
            <Switch checked={milestone} onCheckedChange={setMilestone} />
            <span className="flex flex-col">
              <span className="font-medium">{t("flags.milestone")}</span>
              <span className="text-[13px] text-muted">{t("sheet.milestoneHint")}</span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || !code.trim()}>
              {t("form.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
