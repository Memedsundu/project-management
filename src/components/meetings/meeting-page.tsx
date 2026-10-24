"use client";

import {
  AlertCircle,
  Ban,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  ShieldOff,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  applyMergedNotesAction,
  createNextInSeriesAction,
  makeSeriesAction,
  mergeTranscriptAction,
  prepBriefAction,
  recapAction,
  restoreNotesAction,
  saveMeetingNotesAction,
  updateMeetingAction,
} from "@/app/(app)/meetings/actions";
import { LinksPanel } from "@/components/common/links-panel";
import { useTrash } from "@/components/common/use-trash";
import { SuggestionCard } from "@/components/inbox/suggestion-card";
import type { NoteEditor as Editor } from "@/components/notes/note-blocks";
import type { SaveState } from "@/components/notes/note-editor";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { blocksToMarkdown, blocksToPlainText, type Block } from "@/lib/blocks";
import { dayOf, formatDay, formatLongDay, formatTime } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import { MEETING_KINDS, MeetingDetailsDialog, repeatOptions } from "./meeting-form";
import {
  AgendaEditor,
  Attendees,
  DecisionsSection,
  FollowupDialog,
  MeetingTasks,
  MergeDialog,
  PrepPanel,
  RecapCard,
  RecapReview,
  TranscriptSection,
} from "./meeting-parts";
import { guessLanguage, safeUrl, type MeetingPageData } from "./types";

export type { MeetingPageData, PrepFacts } from "./types";

// BlockNote touches the DOM on load, so the editor only renders in the browser.
const NoteEditor = dynamic(() => import("@/components/notes/note-editor").then((m) => m.NoteEditor), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-xl bg-panel" />,
});

type Working = null | "recap" | "merge" | "brief";

/**
 * One meeting, Fellow and Granola together: prep on the side, the agenda and
 * her notes in the middle, then the transcript, decisions and tasks. After the
 * meeting Claude proposes a recap she reviews; nothing is saved before that.
 */
export function MeetingPage({ data, history }: { data: MeetingPageData; history: React.ReactNode }) {
  const { meeting } = data;
  const t = useTranslations("meetings.page");
  const tm = useTranslations("meetings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const trash = useTrash();
  const readOnly = shell.readOnly;
  const aiReady = shell.aiConfigured && !meeting.aiOff;

  const [save, setSave] = useState<SaveState>("saved");
  const [content, setContent] = useState<Block[]>(meeting.notesContent);
  const [editorKey, setEditorKey] = useState(0);
  const [working, setWorking] = useState<Working>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [followup, setFollowup] = useState<null | "tr" | "en">(null);
  const editorRef = useRef<Editor | null>(null);
  useScreenContext({ kind: "meeting", id: meeting.id, title: meeting.title });

  const start = new Date(meeting.startsAt);
  const end = meeting.endsAt ? new Date(meeting.endsAt) : null;
  const day = dayOf(meeting.startsAt);
  const [now] = useState(() => Date.now());
  const started = start.getTime() <= now;
  const ended = (end ?? start).getTime() < now;
  const canceled = meeting.status === "canceled";
  const kind = (MEETING_KINDS as readonly string[]).includes(meeting.kind) ? meeting.kind : "other";
  const orgs = data.orgs.filter((o) => data.orgIds.includes(o.id));
  const onlineUrl = safeUrl(meeting.onlineUrl);
  const uiLanguage: "tr" | "en" = locale === "en" ? "en" : "tr";

  const onReady = useCallback((ed: Editor) => {
    editorRef.current = ed;
  }, []);
  const currentBlocks = () => (editorRef.current?.document as unknown as Block[] | undefined) ?? content;
  const notesLanguage = () => guessLanguage(blocksToPlainText(currentBlocks()) + "\n" + (meeting.transcript ?? "").slice(0, 2000), uiLanguage);
  // Claude reads the saved notes, so the latest keystrokes are saved first.
  const flushNotes = async () => {
    if (readOnly || !editorRef.current) return;
    await runAction(saveMeetingNotesAction(meeting.id, currentBlocks()), { silent: true });
  };

  const setStatus = (status: "planned" | "done" | "canceled") =>
    runAction(updateMeetingAction(meeting.id, { status }), { success: t(`status.${status}`) });

  const runRecap = async (language: "tr" | "en" = notesLanguage()) => {
    setWorking("recap");
    await flushNotes();
    const res = await runAction(recapAction(meeting.id, language));
    setWorking(null);
    if (res) {
      router.refresh();
      window.setTimeout(() => document.getElementById("recap-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    }
  };
  const runMerge = async () => {
    setWorking("merge");
    await flushNotes();
    const res = await runAction(mergeTranscriptAction(meeting.id, blocksToMarkdown(currentBlocks())));
    setWorking(null);
    if (res) setMerged(res.markdown);
  };
  const applyMerge = async (markdown: string) => {
    const res = await runAction(applyMergedNotesAction(meeting.id, markdown));
    if (!res) return false;
    const previous = res.previous as Block[];
    setMerged(null);
    setContent(res.content as Block[]);
    setEditorKey((k) => k + 1);
    toast(t("merged"), {
      duration: 10_000,
      action: {
        label: tc("undo"),
        onClick: async () => {
          const ok = await runAction(restoreNotesAction(meeting.id, previous));
          if (ok !== undefined) {
            setContent(previous);
            setEditorKey((k) => k + 1);
            toast(tc("restored"));
          }
        },
      },
    });
    return true;
  };
  const runBrief = async () => {
    setWorking("brief");
    await runAction(prepBriefAction(meeting.id, uiLanguage));
    setWorking(null);
  };
  const createNext = async () => {
    if (!data.series) return;
    const res = await runAction(createNextInSeriesAction(data.series.id));
    if (res) router.push(`/meetings/${res.id}`);
  };

  const showAfterHint = ended && !canceled && !meeting.recap && !data.recapSuggestion && !readOnly && (aiReady || meeting.status !== "done");
  const taskIds = new Set(data.tasks.map((x) => x.id));
  const links = data.links.filter((l) => !(l.type === "task" && taskIds.has(l.id)) && (l.kind !== "attachment" || l.direction === "out"));

  return (
    <article className="flex flex-col gap-6">
      <PageHeader
        compact
        eyebrow={
          <nav aria-label={t("breadcrumb")} className="flex flex-wrap items-center gap-1">
            <Link href="/meetings" className="hover:text-ink">
              {tm("title")}
            </Link>
            {data.series ? (
              <>
                <span aria-hidden>/</span>
                <Link href={`/meetings/series/${data.series.id}`} className="hover:text-ink">
                  {data.series.title}
                </Link>
              </>
            ) : null}
          </nav>
        }
        title={<span className={cn("break-words", canceled && "text-muted line-through decoration-2")}>{meeting.title}</span>}
        subtitle={
          <span className="flex flex-col gap-2">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} className="text-muted" />
                {formatLongDay(day, locale)} · {formatTime(start)}
                {end ? `–${formatTime(end)}` : ""}
              </span>
              {meeting.location ? (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={15} className="text-muted" />
                  {meeting.location}
                </span>
              ) : null}
              {onlineUrl ? (
                <a href={onlineUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
                  <Video size={15} className="text-muted" />
                  {t("online")}
                </a>
              ) : null}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm">{tm(`kinds.${kind as "partner"}`)}</Badge>
              {meeting.status !== "planned" ? (
                <Badge variant={meeting.status === "done" ? "success" : "outline"} size="sm">
                  {tm(`statuses.${meeting.status as "done"}`)}
                </Badge>
              ) : null}
              {orgs.map((o) => (
                <Link key={o.id} href={`/partners/${o.id}`} className="inline-flex h-6 items-center rounded-full border border-line-strong px-2.5 text-[12px] font-semibold text-ink-2 hover:border-ink">
                  {o.shortName || o.name}
                </Link>
              ))}
              {meeting.aiOff ? (
                <Badge variant="outline" size="sm">
                  <ShieldOff size={12} /> {tc("aiOff")}
                </Badge>
              ) : null}
            </span>
          </span>
        }
        actions={
          <>
            {onlineUrl && !ended && !canceled ? (
              <Button variant="outline" asChild>
                <a href={onlineUrl} target="_blank" rel="noopener noreferrer">
                  <Video size={16} />
                  {t("join")}
                </a>
              </Button>
            ) : null}
            {aiReady && !readOnly && started && !canceled ? (
              <span className="flex items-center">
                <Button onClick={() => runRecap()} disabled={Boolean(working)} className="rounded-r-none pr-4" data-testid="recap-button">
                  {working === "recap" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {meeting.recap ? t("recapAgain") : t("recap")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="rounded-l-none border-l border-on-ink/20 px-3" disabled={Boolean(working)} aria-label={t("recapLanguage")}>
                      <ChevronDown size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => runRecap("tr")}>{t("recapIn", { language: "Türkçe" })}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => runRecap("en")}>{t("recapIn", { language: "English" })}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("menu")}>
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[270px]">
                {!readOnly ? (
                  <>
                    <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                      <Pencil size={15} />
                      {t("editDetails")}
                    </DropdownMenuItem>
                    {meeting.status !== "done" ? (
                      <DropdownMenuItem onSelect={() => setStatus("done")}>
                        <CheckCircle2 size={15} />
                        {t("markDone")}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setStatus("planned")}>
                        <RotateCcw size={15} />
                        {t("markPlanned")}
                      </DropdownMenuItem>
                    )}
                    {!canceled ? (
                      <DropdownMenuItem onSelect={() => setStatus("canceled")}>
                        <Ban size={15} />
                        {t("cancelMeeting")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem onSelect={() => window.open(`/api/meetings/${meeting.id}/ics`, "_self")}>
                  <CalendarPlus size={15} />
                  {t("addToCalendar")}
                </DropdownMenuItem>
                {data.series ? (
                  <DropdownMenuItem href={`/meetings/series/${data.series.id}`}>
                    <Repeat size={15} />
                    {t("openSeries")}
                  </DropdownMenuItem>
                ) : !readOnly ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Repeat size={15} />
                      {t("makeSeries")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {repeatOptions(day, tm).map((o) => (
                        <DropdownMenuItem key={o.key} onSelect={() => runAction(makeSeriesAction(meeting.id, { rule: o.rule, label: o.label }), { success: t("seriesMade") })}>
                          {o.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {!readOnly ? (
                  <>
                    <DropdownMenuItem
                      onSelect={() => runAction(updateMeetingAction(meeting.id, { aiOff: !meeting.aiOff }), { success: meeting.aiOff ? t("aiOn") : t("aiOffDone") })}
                    >
                      {meeting.aiOff ? <Sparkles size={15} /> : <ShieldOff size={15} />}
                      {meeting.aiOff ? t("allowAi") : t("closeToAi")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => trash("meeting", meeting.id, { title: meeting.title, redirectTo: "/meetings" })}>
                      <Trash2 size={15} />
                      {tc("delete")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {data.series ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line px-4 py-1.5 text-[14px]">
          <Repeat size={15} className="shrink-0 text-muted" />
          <Link href={`/meetings/series/${data.series.id}`} className="font-medium hover:underline">
            {data.series.title}
          </Link>
          {data.series.recurrenceLabel ? <span className="text-muted">· {data.series.recurrenceLabel}</span> : null}
          <span className="flex-1" />
          {data.previous ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/meetings/${data.previous.id}`} aria-label={t("previousMeeting", { date: formatDay(dayOf(data.previous.startsAt), locale) })}>
                <ChevronLeft size={15} />
                {formatDay(dayOf(data.previous.startsAt), locale)}
              </Link>
            </Button>
          ) : null}
          {data.next ? (
            <Button size="sm" variant="ghost" asChild>
              <Link href={`/meetings/${data.next.id}`} aria-label={t("nextMeeting", { date: formatDay(dayOf(data.next.startsAt), locale) })}>
                {formatDay(dayOf(data.next.startsAt), locale)}
                <ChevronRight size={15} />
              </Link>
            </Button>
          ) : !readOnly ? (
            <Button size="sm" variant="outline" onClick={createNext}>
              <Plus size={14} />
              {t("createNext")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canceled ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel px-5 py-3 text-[14px]">
          <Ban size={16} className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1">{t("canceledHint")}</p>
          {!readOnly ? (
            <Button size="sm" variant="outline" onClick={() => setStatus("planned")}>
              <RotateCcw size={14} />
              {t("uncancel")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {showAfterHint ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel px-5 py-3 text-[14px]">
          <NotebookPen size={16} className="shrink-0 text-muted" />
          <p className="min-w-0 flex-1">{aiReady ? t("afterHintAi") : t("afterHint")}</p>
          {aiReady ? (
            <Button size="sm" onClick={() => runRecap()} disabled={Boolean(working)}>
              <Sparkles size={14} />
              {t("recap")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setStatus("done")}>
              <Check size={14} />
              {t("markDone")}
            </Button>
          )}
        </div>
      ) : null}

      {working ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4 text-[14px] text-muted" role="status">
          <Sparkles size={16} className="animate-pulse text-accent" />
          {t(`working.${working}`)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {data.recapSuggestion ? <RecapReview key={data.recapSuggestion.id} s={data.recapSuggestion} meetingId={meeting.id} readOnly={readOnly} orgs={data.orgs} /> : null}
          {data.suggestions.map((s) => (
            <SuggestionCard key={s.id} s={s} readOnly={readOnly} folderNames={{}} />
          ))}
          {meeting.recap ? (
            <RecapCard
              recap={meeting.recap}
              canFollowup={(aiReady || Boolean(meeting.followupEmail)) && !readOnly}
              canRedo={false}
              busy={Boolean(working)}
              onFollowup={() => setFollowup(meeting.recap?.language ?? notesLanguage())}
              onRedo={() => runRecap()}
            />
          ) : null}

          <AgendaEditor meetingId={meeting.id} initial={meeting.agenda} readOnly={readOnly} templates={data.templates} />

          <section className="flex flex-col gap-2" aria-labelledby="notes-title">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="notes-title" className="label-caps">
                {t("notes")}
              </h2>
              {!readOnly ? (
                <span className="flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
                  {save === "saving" ? <Loader2 size={13} className="animate-spin" /> : save === "error" ? <AlertCircle size={13} className="text-danger" /> : <Check size={13} />}
                  {save === "saving" ? tc("saving") : save === "error" ? t("saveFailed") : tc("saved")}
                </span>
              ) : null}
            </div>
            <div
              className="min-h-[140px] cursor-text"
              onClick={(e) => {
                if (e.target === e.currentTarget) editorRef.current?.focus();
              }}
            >
              <NoteEditor
                key={editorKey}
                owner={{ type: "meeting", id: meeting.id }}
                initialContent={content}
                readOnly={readOnly}
                aiOff={!aiReady}
                today={data.today}
                partners={data.partners}
                taskStates={data.taskStates}
                onSaveState={setSave}
                onReady={onReady}
              />
            </div>
          </section>

          <TranscriptSection meetingId={meeting.id} transcript={meeting.transcript} readOnly={readOnly} aiReady={aiReady} busy={working === "merge"} onMerge={runMerge} />
          <DecisionsSection meetingId={meeting.id} decisions={data.decisions} readOnly={readOnly} />
          <MeetingTasks meetingId={meeting.id} tasks={data.tasks} orgIds={data.orgIds} today={data.today} partners={data.partners} readOnly={readOnly} />
          <LinksPanel self={{ type: "meeting", id: meeting.id }} items={links} readOnly={readOnly} />
          {history}
        </div>

        <aside className={cn("flex flex-col gap-8 lg:sticky lg:top-6 lg:order-none lg:self-start", !started && "order-first")} aria-label={t("side")}>
          <PrepPanel prep={data.prep} brief={meeting.prepBrief} aiReady={aiReady} readOnly={readOnly} busy={working === "brief"} onBrief={runBrief} />
          <Attendees meetingId={meeting.id} orgIds={data.orgIds} contacts={data.contacts} contactIds={data.contactIds} readOnly={readOnly} />
        </aside>
      </div>

      {detailsOpen ? (
        <MeetingDetailsDialog
          open
          onOpenChange={(v) => !v && setDetailsOpen(false)}
          meeting={{ id: meeting.id, title: meeting.title, kind: meeting.kind, startsAt: meeting.startsAt, endsAt: meeting.endsAt, location: meeting.location, onlineUrl: meeting.onlineUrl, orgIds: data.orgIds }}
          orgs={data.orgs}
        />
      ) : null}
      {followup ? (
        <FollowupDialog
          open
          onOpenChange={(v) => !v && setFollowup(null)}
          meetingId={meeting.id}
          initial={meeting.followupEmail}
          defaultLanguage={followup}
          aiReady={aiReady}
        />
      ) : null}
      {merged !== null ? <MergeDialog markdown={merged} onCancel={() => setMerged(null)} onApply={applyMerge} /> : null}
    </article>
  );
}
