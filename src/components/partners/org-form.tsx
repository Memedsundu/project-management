"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createContactAction, createOrganisationAction, updateContactAction, updateOrganisationAction } from "@/app/(app)/partners/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { PROVINCES } from "@/lib/provinces";
import { ORG_KINDS, RHYTHMS, type ContactRow, type OrgFields } from "./types";

/** "Yeni kurum" and "Düzenle": the header facts of a partner or stakeholder. */
export function OrgDialog({
  open,
  onOpenChange,
  initial,
  defaultKind = "partner",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: OrgFields;
  defaultKind?: string;
}) {
  const t = useTranslations("partners.form");
  const tk = useTranslations("partners.kinds");
  const tr = useTranslations("partners.rhythms");
  const tc = useTranslations("common");
  const router = useRouter();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    shortName: initial?.shortName ?? "",
    kind: initial?.kind ?? defaultKind,
    provinces: initial?.provinces ?? [],
    agreementStart: initial?.agreementStart ?? "",
    agreementEnd: initial?.agreementEnd ?? "",
    reportingRhythm: initial?.reportingRhythm ?? (defaultKind === "partner" ? "quarterly" : "none"),
    reportDueDays: initial?.reportDueDays ?? 15,
    website: initial?.website ?? "",
    statusLine: initial?.statusLine ?? "",
    notes: initial?.notes ?? "",
  });
  const [province, setProvince] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const addProvince = (p: string) => {
    const match = PROVINCES.find((x) => x.toLocaleLowerCase("tr") === p.trim().toLocaleLowerCase("tr")) ?? p.trim();
    if (match && !v.provinces.includes(match)) set({ provinces: [...v.provinces, match] });
    setProvince("");
  };

  const submit = async () => {
    if (!v.name.trim()) return;
    setBusy(true);
    const input = {
      name: v.name.trim(),
      shortName: v.shortName.trim() || null,
      kind: v.kind as (typeof ORG_KINDS)[number],
      provinces: v.provinces,
      agreementStart: v.agreementStart || null,
      agreementEnd: v.agreementEnd || null,
      reportingRhythm: v.reportingRhythm as (typeof RHYTHMS)[number],
      reportDueDays: Math.max(0, Math.min(120, Number(v.reportDueDays) || 0)),
      website: v.website.trim() || null,
      statusLine: v.statusLine.trim() || null,
      notes: v.notes.trim() || null,
    };
    if (initial) {
      const res = await runAction(updateOrganisationAction(initial.id, input), { success: tc("saved") });
      setBusy(false);
      if (res !== undefined) onOpenChange(false);
    } else {
      const res = await runAction(createOrganisationAction(input));
      setBusy(false);
      if (res) {
        onOpenChange(false);
        router.push(`/partners/${res.id}`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? t("editTitle") : v.kind === "partner" ? t("newPartner") : t("newStakeholder")} wide>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Field label={t("name")} htmlFor="o-name">
              <Input id="o-name" value={v.name} onChange={(e) => set({ name: e.target.value })} autoFocus placeholder={t("namePlaceholder")} />
            </Field>
            <Field label={t("shortName")} htmlFor="o-short" hint={t("shortHint")}>
              <Input id="o-short" value={v.shortName} onChange={(e) => set({ shortName: e.target.value })} maxLength={40} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("kind")} htmlFor="o-kind">
              <Select id="o-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value })}>
                {ORG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {tk(k)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("website")} htmlFor="o-web">
              <Input id="o-web" value={v.website} onChange={(e) => set({ website: e.target.value })} inputMode="url" placeholder="https://" />
            </Field>
          </div>
          <Field label={t("provinces")} htmlFor="o-prov">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line-strong px-2 py-1.5 focus-within:border-ink">
              {v.provinces.map((p) => (
                <span key={p} className="inline-flex h-8 items-center gap-1 rounded-full bg-panel pl-3 pr-1 text-[14px]">
                  {p}
                  <button type="button" className="flex size-6 items-center justify-center rounded-full hover:bg-panel-2" onClick={() => set({ provinces: v.provinces.filter((x) => x !== p) })} aria-label={t("removeProvince", { province: p })}>
                    <X size={13} />
                  </button>
                </span>
              ))}
              <input
                id="o-prov"
                list="o-prov-list"
                value={province}
                onChange={(e) => {
                  const val = e.target.value;
                  if (PROVINCES.some((p) => p === val)) addProvince(val);
                  else setProvince(val);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === ",") && province.trim()) {
                    e.preventDefault();
                    addProvince(province);
                  } else if (e.key === "Backspace" && !province && v.provinces.length) {
                    set({ provinces: v.provinces.slice(0, -1) });
                  }
                }}
                placeholder={v.provinces.length ? "" : t("provincesPlaceholder")}
                className="h-8 min-w-[120px] flex-1 bg-transparent px-1.5 text-[15px] outline-none placeholder:text-faint"
              />
              <datalist id="o-prov-list">
                {PROVINCES.filter((p) => !v.provinces.includes(p)).map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("agreementStart")} htmlFor="o-start">
              <Input id="o-start" type="date" value={v.agreementStart} onChange={(e) => set({ agreementStart: e.target.value })} />
            </Field>
            <Field label={t("agreementEnd")} htmlFor="o-end">
              <Input id="o-end" type="date" value={v.agreementEnd} onChange={(e) => set({ agreementEnd: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
            <Field label={t("rhythm")} htmlFor="o-rhythm" hint={t("rhythmHint")}>
              <Select id="o-rhythm" value={v.reportingRhythm} onChange={(e) => set({ reportingRhythm: e.target.value })}>
                {RHYTHMS.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dueDays")} htmlFor="o-due">
              <Input
                id="o-due"
                type="number"
                min={0}
                max={120}
                value={v.reportDueDays}
                disabled={v.reportingRhythm === "none"}
                onChange={(e) => set({ reportDueDays: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label={t("statusLine")} htmlFor="o-status" hint={t("statusHint")}>
            <Input id="o-status" value={v.statusLine} onChange={(e) => set({ statusLine: e.target.value })} maxLength={500} />
          </Field>
          <Field label={t("notes")} htmlFor="o-notes">
            <Textarea id="o-notes" value={v.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !v.name.trim()}>
              {initial ? tc("save") : tc("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A work contact: an adult at a partner, ministry or donor. Never a child or a beneficiary. */
export function ContactDialog({
  open,
  onOpenChange,
  orgs,
  initial,
  defaultOrgId,
  focal,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgs: { id: string; name: string; shortName: string | null }[];
  initial?: ContactRow;
  defaultOrgId?: string | null;
  focal?: boolean;
}) {
  const t = useTranslations("partners.contactForm");
  const tc = useTranslations("common");
  const [v, setV] = useState({
    name: initial?.name ?? "",
    role: initial?.role ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    notes: initial?.notes ?? "",
    organisationId: initial?.organisationId ?? defaultOrgId ?? "",
    focal: Boolean(focal),
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const submit = async () => {
    if (!v.name.trim()) return;
    setBusy(true);
    const input = {
      name: v.name.trim(),
      role: v.role.trim() || null,
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
      notes: v.notes.trim() || null,
      organisationId: v.organisationId || null,
    };
    const res = initial
      ? await runAction(updateContactAction(initial.id, input), { success: tc("saved") })
      : await runAction(createContactAction({ ...input, focal: v.focal }), { success: t("added") });
    setBusy(false);
    if (res !== undefined) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial ? t("editTitle") : t("newTitle")} description={t("adultsOnly")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t("name")} htmlFor="c-name">
            <Input id="c-name" value={v.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          <Field label={t("role")} htmlFor="c-role">
            <Input id="c-role" value={v.role} onChange={(e) => set({ role: e.target.value })} placeholder={t("rolePlaceholder")} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("email")} htmlFor="c-email">
              <Input id="c-email" type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label={t("phone")} htmlFor="c-phone">
              <Input id="c-phone" type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
          </div>
          {orgs.length ? (
            <Field label={t("organisation")} htmlFor="c-org">
              <Select id="c-org" value={v.organisationId} onChange={(e) => set({ organisationId: e.target.value })}>
                <option value="">{t("noOrg")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName ? `${o.shortName} · ${o.name}` : o.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label={t("notes")} htmlFor="c-notes">
            <Textarea id="c-notes" value={v.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
          </Field>
          {!initial && v.organisationId ? (
            <label className="flex items-center gap-2.5 text-[14px]">
              <Checkbox checked={v.focal} onCheckedChange={(x) => set({ focal: x === true })} />
              {t("focal")}
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !v.name.trim()}>
              {initial ? tc("save") : tc("add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
