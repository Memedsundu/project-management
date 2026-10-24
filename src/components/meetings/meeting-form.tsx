"use client";

import { Check, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { createMeetingAction, updateMeetingAction } from "@/app/(app)/meetings/actions";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/controls";
import { Field, Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { parseDay } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { Org } from "./types";

export const MEETING_KINDS = ["partner", "donor", "steering", "field", "internal", "other"] as const;

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Repeat presets (Fellow's recurring meetings), built from the chosen day. */
export function repeatOptions(day: string, t: ReturnType<typeof useTranslations>) {
  const d = parseDay(day);
  const wd = WEEKDAYS[d.getDay()]!;
  const nth = Math.min(Math.ceil(d.getDate() / 7), 4);
  const weekday = new Intl.DateTimeFormat(t("repeat.locale"), { weekday: "long" }).format(d);
  return [
    { key: "weekly", rule: `FREQ=WEEKLY;BYDAY=${wd}`, label: t("repeat.weekly", { weekday }) },
    { key: "biweekly", rule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}`, label: t("repeat.biweekly", { weekday }) },
    { key: "monthlyNth", rule: `FREQ=MONTHLY;BYDAY=+${nth}${wd}`, label: t("repeat.monthlyNth", { nth, weekday }) },
    { key: "monthly", rule: `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`, label: t("repeat.monthly", { day: d.getDate() }) },
    { key: "quarterly", rule: `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${d.getDate()}`, label: t("repeat.quarterly", { day: d.getDate() }) },
  ];
}

type Values = {
  title: string;
  kind: (typeof MEETING_KINDS)[number];
  day: string;
  time: string;
  durationMin: number;
  location: string;
  onlineUrl: string;
  orgIds: string[];
};

function MeetingFields({ v, set, orgs }: { v: Values; set: (patch: Partial<Values>) => void; orgs: Org[] }) {
  const t = useTranslations("meetings.form");
  const tk = useTranslations("meetings.kinds");
  return (
    <>
      <Field label={t("title")} htmlFor="m-title">
        <Input id="m-title" value={v.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("titlePlaceholder")} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_120px_120px]">
        <Field label={t("day")} htmlFor="m-day" className="col-span-2 sm:col-span-1">
          <Input id="m-day" type="date" value={v.day} onChange={(e) => set({ day: e.target.value })} />
        </Field>
        <Field label={t("time")} htmlFor="m-time">
          <Input id="m-time" type="time" value={v.time} step={300} onChange={(e) => set({ time: e.target.value })} />
        </Field>
        <Field label={t("duration")} htmlFor="m-dur">
          <Select id="m-dur" value={String(v.durationMin)} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120, 180, 240, 480].map((n) => (
              <option key={n} value={n}>
                {t("minutes", { n })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {orgs.length ? (
        <Field label={t("partners")}>
          <div className="flex flex-wrap gap-1.5">
            {orgs.map((o) => {
              const on = v.orgIds.includes(o.id);
              return (
                <Chip key={o.id} type="button" active={on} aria-pressed={on} onClick={() => set({ orgIds: on ? v.orgIds.filter((x) => x !== o.id) : [...v.orgIds, o.id] })}>
                  {on ? <Check size={13} /> : null}
                  {o.shortName || o.name}
                </Chip>
              );
            })}
          </div>
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("kind")} htmlFor="m-kind">
          <Select id="m-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as Values["kind"] })}>
            {MEETING_KINDS.map((k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("location")} htmlFor="m-loc">
          <Input id="m-loc" value={v.location} onChange={(e) => set({ location: e.target.value })} placeholder={t("locationPlaceholder")} />
        </Field>
      </div>
      <Field label={t("onlineUrl")} htmlFor="m-url">
        <Input id="m-url" value={v.onlineUrl} onChange={(e) => set({ onlineUrl: e.target.value })} placeholder="https://teams.microsoft.com/…" inputMode="url" />
      </Field>
    </>
  );
}

/** "Yeni toplantı": date, partners, template and an optional repeat. */
export function NewMeetingDialog({
  open,
  onOpenChange,
  orgs,
  templates,
  defaults,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgs: Org[];
  templates: { id: string; name: string }[];
  defaults: { day: string; orgIds?: string[]; title?: string; links?: { type: string; id: string }[] };
}) {
  const t = useTranslations("meetings.form");
  const tc = useTranslations("common");
  const router = useRouter();
  const [v, setV] = useState<Values>({
    title: defaults.title ?? "",
    kind: "partner",
    day: defaults.day,
    time: "10:00",
    durationMin: 60,
    location: "",
    onlineUrl: "",
    orgIds: defaults.orgIds ?? [],
  });
  const [templateId, setTemplateId] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const tr = useTranslations("meetings");
  const options = useMemo(() => (v.day ? repeatOptions(v.day, tr) : []), [v.day, tr]);
  const set = (patch: Partial<Values>) => setV((x) => ({ ...x, ...patch }));

  const submit = async () => {
    if (!v.title.trim() || !v.day || !v.time) return;
    setBusy(true);
    const r = options.find((o) => o.key === repeat);
    const res = await runAction(
      createMeetingAction({
        title: v.title.trim(),
        kind: v.kind,
        day: v.day,
        time: v.time,
        durationMin: v.durationMin,
        location: v.location.trim() || null,
        onlineUrl: v.onlineUrl.trim() || null,
        orgIds: v.orgIds,
        templateId: templateId || null,
        repeat: r ? { rule: r.rule, label: r.label } : null,
        links: defaults.links,
      }),
    );
    setBusy(false);
    if (res) {
      onOpenChange(false);
      router.push(`/meetings/${res.id}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("newTitle")} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <MeetingFields v={v} set={set} orgs={orgs} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("template")} htmlFor="m-tpl" hint={t("templateHint")}>
              <Select id="m-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">{t("noTemplate")}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("repeat")} htmlFor="m-rep" hint={repeat ? t("repeatHint") : undefined}>
              <Select id="m-rep" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                <option value="">{t("noRepeat")}</option>
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !v.title.trim() || !v.day || !v.time}>
              {repeat ? <Repeat size={15} /> : null}
              {tc("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Edit date, partners, kind and place of an existing meeting. */
export function MeetingDetailsDialog({
  open,
  onOpenChange,
  meeting,
  orgs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  meeting: { id: string; title: string; kind: string; startsAt: string; endsAt: string | null; location: string | null; onlineUrl: string | null; orgIds: string[] };
  orgs: Org[];
}) {
  const t = useTranslations("meetings.form");
  const tc = useTranslations("common");
  const start = new Date(meeting.startsAt);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", ...o }).format(start);
  const [v, setV] = useState<Values>({
    title: meeting.title,
    kind: (MEETING_KINDS as readonly string[]).includes(meeting.kind) ? (meeting.kind as Values["kind"]) : "other",
    day: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }),
    time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),
    durationMin: meeting.endsAt ? Math.max(5, Math.round((Date.parse(meeting.endsAt) - start.getTime()) / 60_000)) : 60,
    location: meeting.location ?? "",
    onlineUrl: meeting.onlineUrl ?? "",
    orgIds: meeting.orgIds,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Values>) => setV((x) => ({ ...x, ...patch }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("editTitle")} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const res = await runAction(
              updateMeetingAction(meeting.id, {
                title: v.title.trim(),
                kind: v.kind,
                day: v.day,
                time: v.time,
                durationMin: v.durationMin,
                location: v.location.trim() || null,
                onlineUrl: v.onlineUrl.trim() || null,
                orgIds: v.orgIds,
              }),
            );
            setBusy(false);
            if (res !== undefined) onOpenChange(false);
          }}
        >
          <MeetingFields v={v} set={set} orgs={orgs} />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !v.title.trim()}>
              {tc("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
