"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createCollectionAction, previewSmartFilterAction, updateCollectionAction } from "@/app/(app)/collections/actions";
import { EntityIcon } from "@/components/common/entity-icon";
import { Button } from "@/components/ui/button";
import { Chip, Switch } from "@/components/ui/controls";
import { Field, FieldHint, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import type { EntityRef, EntityType } from "@/server/entities";
import type { SmartFilter } from "@/server/services/collections";
import type { FilterOptions } from "@/server/views/collections";

/** The kinds a smart collection can gather. */
export const SMART_TYPES: EntityType[] = ["document", "note", "meeting", "decision", "task", "activity", "indicator"];

export type CollectionDraft = { id?: string; name: string; description: string | null; pinned: boolean; smartFilter: SmartFilter | null };

const hasCondition = (f: SmartFilter) => Boolean(f.q?.trim() || f.types?.length || f.orgId || f.tag || f.docType || f.from || f.to);

/**
 * New or edit collection. A smart one keeps a saved filter (Paperless saved
 * views) and shows how many records match while she sets it up.
 */
export function CollectionDialog({
  open,
  onOpenChange,
  options,
  initial,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  options: FilterOptions;
  initial: CollectionDraft;
  /** Records to put in a new collection (from a selection elsewhere). */
  items?: EntityRef[];
}) {
  const t = useTranslations("collections.form");
  const tk = useTranslations("common.kindsPlural");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [pinned, setPinned] = useState(initial.pinned);
  const [smart, setSmart] = useState(Boolean(initial.smartFilter));
  const [filter, setFilter] = useState<SmartFilter>(initial.smartFilter ?? {});
  const [counted, setCounted] = useState<{ key: string; count: number; sample: { type: EntityType; id: string; title: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = hasCondition(filter);
  const datesOk = !filter.from || !filter.to || filter.from <= filter.to;
  const valid = name.trim().length > 0 && (!smart || (ready && datesOk));
  const filterKey = JSON.stringify(filter);
  // The count shown is always the one for the conditions on screen.
  const preview = counted?.key === filterKey ? counted : null;

  useEffect(() => {
    if (!open || !smart || !ready || !datesOk) return;
    let live = true;
    const handle = window.setTimeout(async () => {
      const res = await runAction(previewSmartFilterAction(filter), { silent: true });
      if (live && res) setCounted({ key: filterKey, ...res });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, smart, filterKey]);

  const set = (patch: Partial<SmartFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggleType = (type: EntityType) => {
    const now = filter.types ?? [];
    set({ types: now.includes(type) ? now.filter((x) => x !== type) : [...now, type] });
  };

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    const input = { name: name.trim(), description: description.trim() || null, pinned, smartFilter: smart ? filter : null };
    if (initial.id) {
      const res = await runAction(updateCollectionAction(initial.id, input), { success: t("saved") });
      setBusy(false);
      if (res !== undefined) onOpenChange(false);
      return;
    }
    const res = await runAction(createCollectionAction(input, items ?? []), { success: t("created") });
    setBusy(false);
    if (!res) return;
    onOpenChange(false);
    router.push(`/collections/${res.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial.id ? t("editTitle") : t("title")} description={initial.id ? undefined : t("description")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t("name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={t("namePlaceholder")} autoFocus required data-testid="col-name" />
          </Field>
          <Field label={t("about")}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} placeholder={t("aboutPlaceholder")} className="min-h-16" data-testid="col-description" />
          </Field>

          <label className="flex items-start gap-3 text-[14px]">
            <Switch checked={smart} onCheckedChange={setSmart} className="mt-0.5" data-testid="col-smart" />
            <span className="flex flex-col">
              <span className="font-medium">{t("smart")}</span>
              <span className="text-[13px] text-muted">{t("smartHint")}</span>
            </span>
          </label>

          {smart ? (
            <fieldset className="flex flex-col gap-4 rounded-2xl border border-line px-4 pb-4 pt-3">
              <legend className="label-caps px-1">{t("conditions")}</legend>
              <Field label={t("words")} hint={t("wordsHint")}>
                <Input value={filter.q ?? ""} onChange={(e) => set({ q: e.target.value.slice(0, 200) })} placeholder={t("wordsPlaceholder")} data-testid="smart-q" />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-medium" id="smart-types">
                  {t("kinds")}
                </span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="smart-types">
                  {SMART_TYPES.map((type) => (
                    <Chip key={type} active={filter.types?.includes(type)} aria-pressed={Boolean(filter.types?.includes(type))} onClick={() => toggleType(type)} className="h-8 px-3 text-[13px]" data-testid="smart-type">
                      <EntityIcon type={type} size={13} />
                      {tk(type as "task")}
                    </Chip>
                  ))}
                </div>
                <FieldHint>{t("kindsHint")}</FieldHint>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("partner")}>
                  <Select value={filter.orgId ?? ""} onChange={(e) => set({ orgId: e.target.value || undefined })} data-testid="smart-org">
                    <option value="">{t("any")}</option>
                    {options.orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.shortName ? `${o.shortName} · ${o.name}` : o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("docType")}>
                  <Select value={filter.docType ?? ""} onChange={(e) => set({ docType: e.target.value || undefined })} data-testid="smart-doctype">
                    <option value="">{t("any")}</option>
                    {options.docTypes.map((d) => (
                      <option key={d.key} value={d.key}>
                        {locale === "en" ? d.en : d.tr}
                      </option>
                    ))}
                  </Select>
                </Field>
                {options.tags.length ? (
                  <Field label={t("tag")}>
                    <Select value={filter.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} data-testid="smart-tag">
                      <option value="">{t("any")}</option>
                      {options.tags.map((tag) => (
                        <option key={tag.slug} value={tag.slug}>
                          #{tag.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <Field label={t("from")}>
                    <Input type="date" value={filter.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} aria-invalid={!datesOk} data-testid="smart-from" />
                  </Field>
                  <Field label={t("to")}>
                    <Input type="date" value={filter.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} aria-invalid={!datesOk} data-testid="smart-to" />
                  </Field>
                </div>
              </div>
              {!datesOk ? <p className="text-[13px] text-overdue">{t("datesError")}</p> : null}
              <div className="rounded-xl bg-panel px-3.5 py-2.5 text-[14px]" aria-live="polite" data-testid="smart-preview">
                {!ready ? (
                  <span className="text-muted">{t("noCondition")}</span>
                ) : !preview ? (
                  <span className="text-muted">{t("counting")}</span>
                ) : preview.count === 0 ? (
                  <span className="text-muted">{t("noMatch")}</span>
                ) : (
                  <span className="flex flex-col gap-1.5">
                    <span className="font-medium">{preview.count >= 100 ? t("matchMany") : t("matchCount", { count: preview.count })}</span>
                    <span className="flex flex-col gap-1">
                      {preview.sample.map((h) => (
                        <span key={`${h.type}:${h.id}`} className="flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
                          <EntityIcon type={h.type} size={13} className="shrink-0 text-muted" />
                          <span className="truncate">{h.title}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                )}
              </div>
            </fieldset>
          ) : null}

          <label className="flex items-start gap-3 text-[14px]">
            <Switch checked={pinned} onCheckedChange={setPinned} className="mt-0.5" data-testid="col-pin" />
            <span className="flex flex-col">
              <span className="font-medium">{t("pin")}</span>
              <span className="text-[13px] text-muted">{t("pinHint")}</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={busy || !valid} data-testid="col-save">
              {initial.id ? tc("save") : t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
