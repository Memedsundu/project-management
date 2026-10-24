"use client";

import { Copy, Loader2, MoreHorizontal, NotebookPen, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { briefToNoteAction, deleteBriefAction, markBriefsReadAction, remakeBriefAction } from "@/app/(app)/briefs/actions";
import { ChatMarkdown } from "@/components/common/chat-markdown";
import { EntityIcon } from "@/components/common/entity-icon";
import { modelName } from "@/components/settings/ai-section";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlay";
import { formatDateTime, formatLongDay, todayStr } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import type { BriefKind } from "@/server/services/briefs";
import { BRIEF_ICONS } from "./briefs-screen";

export type BriefView = {
  id: string;
  kind: BriefKind;
  day: string;
  title: string;
  content: string;
  read: boolean;
  model: string | null;
  recipe: { id: string; name: string } | null;
  about: { type: string; id: string; title: string; href: string } | null;
  createdAt: string;
};

/** One brief to read, copy, keep as a note or write again. Opening it marks it read. */
export function BriefPage({ brief }: { brief: BriefView }) {
  const t = useTranslations("briefs");
  const locale = useLocale();
  const shell = useShell();
  const router = useRouter();
  const [busy, setBusy] = useState<"remake" | "note" | null>(null);
  useScreenContext({ kind: "brief", id: brief.id, title: brief.title, detail: t(`kindOne.${brief.kind}`) });
  const Icon = BRIEF_ICONS[brief.kind];

  useEffect(() => {
    if (!brief.read) void markBriefsReadAction([brief.id]);
  }, [brief.id, brief.read]);

  // A past day's summary cannot be written again: the day's records have moved on.
  const canRemake = !shell.readOnly && (brief.kind !== "daily" || brief.day === todayStr());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.content);
      toast(t("page.copied"));
    } catch {
      toast(t("page.copyFailed"));
    }
  };
  const remake = async () => {
    setBusy("remake");
    const res = await runAction(remakeBriefAction(brief.id), { success: t("page.remade") });
    setBusy(null);
    if (res && res.id !== brief.id) router.replace(`/briefs/${res.id}`);
  };
  const toNote = async () => {
    setBusy("note");
    const res = await runAction(briefToNoteAction(brief.id), { success: t("page.toNoteDone") });
    setBusy(null);
    if (res) router.push(`/notes/${res.id}`);
  };
  const remove = async () => {
    const res = await runAction(deleteBriefAction(brief.id), { success: t("page.deleted") });
    if (res !== undefined) router.push("/briefs");
  };

  return (
    <article className="mx-auto flex max-w-[760px] flex-col gap-6" data-testid="brief-page">
      <header className="flex flex-col gap-3">
        <nav aria-label={t("page.breadcrumb")} className="text-[13px] text-muted">
          <Link href="/briefs" className="hover:text-ink">
            {t("title")}
          </Link>
          <span aria-hidden> / </span>
          <Link href={`/briefs?kind=${brief.kind}`} className="hover:text-ink">
            {t(`kinds.${brief.kind}`)}
          </Link>
        </nav>
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 font-display text-[36px] leading-[1.1] sm:text-[40px]">{brief.title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" onClick={copy} data-testid="brief-copy">
              <Copy size={16} />
              {t("page.copy")}
            </Button>
            {!shell.readOnly ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t("page.more")} data-testid="brief-more">
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={toNote} disabled={busy !== null} data-testid="brief-to-note">
                    <NotebookPen size={15} />
                    {t("page.toNote")}
                  </DropdownMenuItem>
                  {canRemake ? (
                    <DropdownMenuItem onSelect={remake} disabled={busy !== null} data-testid="brief-remake">
                      <RefreshCw size={15} />
                      {t("page.remake")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={remove} danger data-testid="brief-delete">
                    <Trash2 size={15} />
                    {t("page.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon size={14} />
            {t(`kindOne.${brief.kind}`)}
          </span>
          <span aria-hidden>·</span>
          <span>{formatLongDay(brief.day, locale)}</span>
          {brief.recipe ? (
            <>
              <span aria-hidden>·</span>
              <span>{t("page.recipe", { name: brief.recipe.name })}</span>
            </>
          ) : null}
          {brief.about ? (
            <>
              <span aria-hidden>·</span>
              <Link href={brief.about.href} className="inline-flex items-center gap-1 hover:text-ink">
                <EntityIcon type={brief.about.type} size={13} />
                {brief.about.title}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {busy === "remake" ? (
        <p className="flex items-center gap-2 rounded-2xl bg-panel px-4 py-3 text-[14px] text-muted" role="status">
          <Loader2 size={15} className="animate-spin" />
          {t("page.remaking")}
        </p>
      ) : null}

      <div className="rounded-3xl border border-line px-5 py-5 md:px-8 md:py-7">
        <ChatMarkdown text={brief.content} className="text-[16px]" />
      </div>

      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        {brief.model ? (
          <Badge variant="ai" size="sm">
            {t("page.byAi", { model: modelName(brief.model) })}
          </Badge>
        ) : (
          <span>{t("page.plain")}</span>
        )}
        <span>{t("page.written", { at: formatDateTime(brief.createdAt, locale) })}</span>
      </p>
    </article>
  );
}
