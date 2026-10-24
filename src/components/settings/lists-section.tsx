"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveFilesAction } from "@/app/(app)/settings/actions";
import { PeriodsDialog } from "@/components/indicators/periods-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HolidaysDialog, SeasonsDialog } from "@/components/workplan/calendar-settings";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";
import { DocTypesDialog, TagsDialog, TemplatesDialog } from "./list-dialogs";
import { Row, SettingsSection } from "./parts";

type Open = "docTypes" | "tags" | "seasons" | "holidays" | "periods" | "templates" | null;

/**
 * Listeler: the names and calendars the whole app files by. Each list opens
 * in its own window; a window starts from what is saved each time it opens.
 */
export function ListsSection({ data }: { data: SettingsData }) {
  const t = useTranslations("settings.lists");
  const [open, setOpen] = useState<Open>(null);
  const [rule, setRule] = useState(data.files.namingRule);
  const close = (v: boolean) => !v && setOpen(null);
  const readOnly = data.readOnly;
  const edit = (key: Exclude<Open, null>) => (
    <Button variant="outline" size="sm" onClick={() => setOpen(key)} data-testid={`s-list-${key}`}>
      {readOnly ? t("view") : t("edit")}
    </Button>
  );

  return (
    <SettingsSection id="lists" title={t("title")} hint={t("hint")}>
      <Row inline label={t("docTypesRow")} hint={t("docTypesHint", { count: data.docTypes.length })}>
        {edit("docTypes")}
      </Row>
      <Row inline label={t("tagsRow")} hint={t("tagsHint", { count: data.tags.length })}>
        {edit("tags")}
      </Row>
      <Row label={t("partnersRow")} hint={t("partnersHint")}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/partners">
            {t("openPartners")}
            <ArrowUpRight size={15} />
          </Link>
        </Button>
      </Row>
      <Row inline label={t("seasonsRow")} hint={t("seasonsHint", { count: data.seasons.length })}>
        {edit("seasons")}
      </Row>
      <Row inline label={t("holidaysRow")} hint={t("holidaysHint", { count: data.holidays.length })}>
        {edit("holidays")}
      </Row>
      <Row inline label={t("periodsRow")} hint={t("periodsHint", { count: data.periods.length })}>
        {edit("periods")}
      </Row>
      <Row inline label={t("templatesRow")} hint={t("templatesHint", { count: data.templates.length })}>
        {edit("templates")}
      </Row>
      <Row label={t("namingRow")} hint={t("namingHint")} htmlFor="s-naming" stack>
        <Input
          id="s-naming"
          value={rule}
          maxLength={200}
          placeholder={t("namingPlaceholder")}
          onChange={(e) => setRule(e.target.value)}
          onBlur={() => rule.trim() !== data.files.namingRule && runAction(saveFilesAction({ namingRule: rule }), { success: t("namingSaved") })}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          disabled={readOnly}
          className="w-full"
          data-testid="s-naming"
        />
      </Row>

      {open === "docTypes" ? <DocTypesDialog open onOpenChange={close} types={data.docTypes} readOnly={readOnly} /> : null}
      {open === "tags" ? <TagsDialog open onOpenChange={close} tags={data.tags} readOnly={readOnly} /> : null}
      {open === "seasons" ? <SeasonsDialog open onOpenChange={close} data={{ seasons: data.seasons }} readOnly={readOnly} /> : null}
      {open === "holidays" ? <HolidaysDialog open onOpenChange={close} data={{ holidays: data.holidays, today: data.today }} readOnly={readOnly} /> : null}
      {open === "periods" ? <PeriodsDialog open onOpenChange={close} periods={data.periods} locked={data.periodsLocked} readOnly={readOnly} /> : null}
      {open === "templates" ? <TemplatesDialog open onOpenChange={close} templates={data.templates} readOnly={readOnly} /> : null}
    </SettingsSection>
  );
}
