"use client";

import {
  CalendarClock,
  Check,
  CheckSquare,
  Download,
  FolderInput,
  Gauge,
  History,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { extractTasksAction } from "@/app/actions/common";
import {
  clearChildFlagAction,
  readIndicatorsAction,
  reclassifyAction,
  restoreDocumentVersionAction,
  updateDocumentAction,
} from "@/app/(app)/files/actions";
import { createTaskAction } from "@/app/(app)/tasks/actions";
import { LinksPanel, type LinkItem } from "@/components/common/links-panel";
import { TagEditor } from "@/components/common/tag-editor";
import { useTrash } from "@/components/common/use-trash";
import { SuggestionCard, type InboxSuggestion } from "@/components/inbox/suggestion-card";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { ExtractTasksDialog, type Proposal } from "@/components/tasks/extract-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { formatDateTime, formatDay, todayStr } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn, formatBytes } from "@/lib/utils";
import { ClassificationCard, folderPath } from "./classification-card";
import { FileIcon } from "./file-icon";
import { FilePreview } from "./file-preview";
import { FolderPickerDialog } from "./folder-picker";
import type { DocTypeOption, FolderNode } from "./types";
import { useUploader } from "./use-uploader";

type Org = { id: string; name: string; shortName: string | null };

export type DocumentPageData = {
  doc: {
    id: string;
    title: string;
    filename: string;
    mime: string;
    size: number;
    docType: string | null;
    status: string;
    language: string | null;
    periodLabel: string | null;
    summary: string | null;
    keyDates: { date: string; label: string }[];
    starred: boolean;
    aiOff: boolean;
    classificationStatus: string;
    childDataFlag: boolean;
    childDataReason: string | null;
    textStatus: string;
    pageCount: number | null;
    folderId: string | null;
    currentVersionId: string | null;
    createdAt: string;
    updatedAt: string;
    orgIds: string[];
    tags: { name: string; slug: string }[];
    source: string;
  };
  folderPath: { id: string; name: string }[];
  inheritedAiOff: boolean;
  versions: { id: string; version: number; filename: string; size: number; mime: string; note: string | null; createdAt: string; current: boolean }[];
  links: LinkItem[];
  docTypes: DocTypeOption[];
  orgs: Org[];
  allFolders: FolderNode[];
  folderNames: Record<string, string>;
  classification: InboxSuggestion | null;
  suggestions: InboxSuggestion[];
  periods: { id: string; label: string }[];
  page: number | null;
};

/** One file: Drive's preview on the left, Paperless details on the right. */
export function DocumentScreen({ data, history }: { data: DocumentPageData; history: React.ReactNode }) {
  const t = useTranslations("files.doc");
  const tf = useTranslations("files");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const shell = useShell();
  const trash = useTrash();
  const uploader = useUploader();
  const versionInput = useRef<HTMLInputElement>(null);
  const { doc } = data;
  const readOnly = shell.readOnly;
  const aiBlocked = doc.aiOff || data.inheritedAiOff || doc.childDataFlag;
  const aiReady = shell.aiConfigured && !aiBlocked;
  const [rename, setRename] = useState(false);
  const [move, setMove] = useState(false);
  const [extract, setExtract] = useState<Proposal[] | null>(null);
  const [working, setWorking] = useState<null | "extract" | "indicators" | "classify">(null);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [viewVersion, setViewVersion] = useState<string | null>(null);
  useScreenContext({ kind: "document", id: doc.id, title: doc.title });

  const typeName = (key: string | null) => {
    if (!key) return null;
    const d = data.docTypes.find((x) => x.key === key);
    return d ? (locale === "en" ? d.en : d.tr) : key;
  };
  const save = (patch: Parameters<typeof updateDocumentAction>[1]) => runAction(updateDocumentAction(doc.id, patch));

  const runExtract = async () => {
    setWorking("extract");
    const res = await runAction(extractTasksAction({ type: "document", id: doc.id }));
    setWorking(null);
    if (res) setExtract(res.map((p) => ({ ...p, keep: true })));
  };
  const runClassify = async () => {
    setWorking("classify");
    const res = await runAction(reclassifyAction(doc.id), { success: t("classifyDone") });
    setWorking(null);
    if (res !== undefined) router.refresh();
  };
  const shownVersion = viewVersion ? data.versions.find((v) => v.id === viewVersion) : null;

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={versionInput}
        type="file"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) await uploader.upload([file], { folderId: doc.folderId, documentId: doc.id });
        }}
      />

      <PageHeader
        compact
        eyebrow={
          <nav aria-label={tf("breadcrumb")} className="flex flex-wrap items-center gap-1">
            <Link href="/files" className="hover:text-ink">
              {tf("title")}
            </Link>
            {data.folderPath.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <Link href={`/files/f/${f.id}`} className="hover:text-ink">
                  {f.name}
                </Link>
              </span>
            ))}
          </nav>
        }
        title={
          <span className="flex items-start gap-3">
            <FileIcon mime={doc.mime} filename={doc.filename} size={20} className="mt-1 shrink-0" boxed />
            <span className="min-w-0 break-words">{doc.title}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {typeName(doc.docType) ? <Badge size="sm">{typeName(doc.docType)}</Badge> : null}
            {doc.status !== "final" ? (
              <Badge variant="outline" size="sm">
                {tf(`statuses.${doc.status as "draft"}`)}
              </Badge>
            ) : null}
            {doc.aiOff || data.inheritedAiOff ? (
              <Badge variant="outline" size="sm">
                <ShieldOff size={12} /> {tc("aiOff")}
              </Badge>
            ) : null}
            <span className="text-[13px] text-muted">
              {[formatBytes(doc.size, locale), doc.pageCount ? t("pages", { count: doc.pageCount }) : null, t("updatedAt", { when: formatDateTime(doc.updatedAt, locale) })]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        }
        actions={
          <>
            {uploader.busy ? <span className="text-[13px] text-muted">{uploader.label}</span> : null}
            <Button variant="outline" asChild>
              <a href={`/api/files/${doc.id}/content?download=1`}>
                <Download size={16} />
                {tc("download")}
              </a>
            </Button>
            {aiReady ? (
              <Button onClick={() => shell.openAssistant(t("askPrompt", { title: doc.title }))}>
                <MessageCircleQuestion size={16} />
                {t("ask")}
              </Button>
            ) : null}
            {!readOnly ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={doc.starred ? tf("unstar") : tf("star")}
                aria-pressed={doc.starred}
                onClick={() => save({ starred: !doc.starred })}
              >
                <Star size={18} className={cn(doc.starred && "fill-current")} />
              </Button>
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
                    <DropdownMenuItem onSelect={() => setRename(true)}>
                      <Pencil size={15} />
                      {tf("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMove(true)}>
                      <FolderInput size={15} />
                      {tf("move.action")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => versionInput.current?.click()} disabled={uploader.busy}>
                      <Upload size={15} />
                      {t("newVersion")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                {aiReady && !readOnly ? (
                  <>
                    <DropdownMenuItem onSelect={runExtract} disabled={Boolean(working)}>
                      <CheckSquare size={15} />
                      {t("extractTasks")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIndicatorsOpen(true)} disabled={Boolean(working)}>
                      <Gauge size={15} />
                      {t("readIndicators")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={runClassify} disabled={Boolean(working)}>
                      <RefreshCw size={15} />
                      {t("reclassify")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                {!readOnly ? (
                  <>
                    <DropdownMenuItem onSelect={() => save({ aiOff: !doc.aiOff })} disabled={data.inheritedAiOff}>
                      {doc.aiOff ? <Sparkles size={15} /> : <ShieldOff size={15} />}
                      {doc.aiOff ? tf("allowAi") : tf("closeToAi")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      danger
                      onSelect={() => trash("document", doc.id, { title: doc.title, redirectTo: doc.folderId ? `/files/f/${doc.folderId}` : "/files" })}
                    >
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

      {doc.childDataFlag ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-accent-soft px-5 py-4 text-accent-ink" aria-labelledby="hold-title">
          <div className="flex items-start gap-3">
            <ShieldAlert size={20} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <h2 id="hold-title" className="text-[15px] font-semibold">
                {t("hold.title")}
              </h2>
              <p className="text-[14px]">{t("hold.body")}</p>
              {doc.childDataReason ? <p className="text-[13px] opacity-80">{t("hold.reason", { reason: doc.childDataReason })}</p> : null}
            </div>
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap gap-2 pl-8">
              <Button size="sm" variant="outline" onClick={() => versionInput.current?.click()} disabled={uploader.busy}>
                <Upload size={14} />
                {t("hold.upload")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => runAction(clearChildFlagAction(doc.id), { success: t("hold.cleared") })}>
                <Check size={14} />
                {t("hold.clear")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => trash("document", doc.id, { title: doc.title, redirectTo: "/files/check?tab=flagged" })}>
                <Trash2 size={14} />
                {tc("delete")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {working ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4 text-[14px] text-muted" role="status">
          <Sparkles size={16} className="animate-pulse text-accent" />
          {t(`working.${working}`)}
        </div>
      ) : null}

      {data.classification ? (
        <ClassificationCard
          s={data.classification}
          docTypes={data.docTypes}
          orgs={data.orgs}
          folders={data.allFolders}
          readOnly={readOnly}
          showFile={false}
          onDone={() => router.refresh()}
        />
      ) : null}
      {data.suggestions.map((s) => (
        <SuggestionCard key={s.id} s={s} readOnly={readOnly} folderNames={data.folderNames} />
      ))}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          {shownVersion && !shownVersion.current ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-panel px-4 py-2.5 text-[14px]">
              <History size={15} />
              {t("viewingVersion", { version: shownVersion.version })}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setViewVersion(null)}>
                {t("backToCurrent")}
              </Button>
            </div>
          ) : null}
          <FilePreview
            docId={doc.id}
            versionId={shownVersion && !shownVersion.current ? shownVersion.id : null}
            mime={shownVersion?.mime ?? doc.mime}
            filename={shownVersion?.filename ?? doc.filename}
            page={data.page}
            textStatus={doc.textStatus}
          />
          <Versions
            data={data}
            readOnly={readOnly}
            busy={uploader.busy}
            onUpload={() => versionInput.current?.click()}
            onView={(id) => setViewVersion(id)}
          />
          <LinksPanel self={{ type: "document", id: doc.id }} items={data.links} readOnly={readOnly} />
          {history}
        </div>
        <Details data={data} readOnly={readOnly} onMove={() => setMove(true)} />
      </div>

      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent title={tf("rename")}>
          <RenameForm
            initial={doc.title}
            onCancel={() => setRename(false)}
            onSubmit={async (title) => {
              const res = await save({ title });
              if (res !== undefined) setRename(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {move ? (
        <FolderPickerDialog
          open
          onOpenChange={(v) => !v && setMove(false)}
          folders={data.allFolders}
          current={doc.folderId}
          exclude={[]}
          title={tf("move.title", { count: 1 })}
          onPick={async (target) => {
            const res = await runAction(updateDocumentAction(doc.id, { folderId: target }), { success: tf("moved") });
            if (res !== undefined) setMove(false);
          }}
        />
      ) : null}

      {extract ? (
        <ExtractTasksDialog
          open
          onOpenChange={(v) => !v && setExtract(null)}
          title={t("extractTitle", { title: doc.title })}
          proposals={extract}
          source={{ type: "document", id: doc.id }}
          onDone={() => setExtract(null)}
        />
      ) : null}

      <Dialog open={indicatorsOpen} onOpenChange={setIndicatorsOpen}>
        <DialogContent title={t("readIndicators")} description={t("indicatorsHint")}>
          <IndicatorForm
            periods={data.periods}
            orgs={data.orgs.filter((o) => doc.orgIds.includes(o.id)).concat(data.orgs.filter((o) => !doc.orgIds.includes(o.id)))}
            defaultOrg={doc.orgIds[0] ?? ""}
            defaultPeriod={data.periods.find((p) => p.label === doc.periodLabel)?.id ?? ""}
            onCancel={() => setIndicatorsOpen(false)}
            onSubmit={async (opts) => {
              setIndicatorsOpen(false);
              setWorking("indicators");
              const res = await runAction(readIndicatorsAction(doc.id, opts));
              setWorking(null);
              if (res?.suggestionId) router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Details({ data, readOnly, onMove }: { data: DocumentPageData; readOnly: boolean; onMove: () => void }) {
  const t = useTranslations("files.doc");
  const tf = useTranslations("files");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { doc } = data;
  const [summary, setSummary] = useState(doc.summary ?? "");
  const [period, setPeriod] = useState(doc.periodLabel ?? "");
  const [partnerIds, setPartnerIds] = useState(doc.orgIds);
  const [keyDates, setKeyDates] = useState(doc.keyDates);
  const [addingDate, setAddingDate] = useState(false);
  const save = (patch: Parameters<typeof updateDocumentAction>[1]) => runAction(updateDocumentAction(doc.id, patch));
  const today = todayStr();

  return (
    <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start" aria-label={tc("details")}>
      <h2 className="label-caps">{tc("details")}</h2>
      <Field label={t("fields.type")} htmlFor="d-type">
        <Select id="d-type" value={doc.docType ?? ""} disabled={readOnly} onChange={(e) => save({ docType: e.target.value || null, classificationStatus: "confirmed" })}>
          <option value="">{t("noType")}</option>
          {data.docTypes.map((d) => (
            <option key={d.key} value={d.key}>
              {locale === "en" ? d.en : d.tr}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("fields.status")} htmlFor="d-status">
          <Select id="d-status" value={doc.status} disabled={readOnly} onChange={(e) => save({ status: e.target.value as "final" })}>
            {(["draft", "final", "signed"] as const).map((x) => (
              <option key={x} value={x}>
                {tf(`statuses.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("fields.language")} htmlFor="d-lang">
          <Select id="d-lang" value={doc.language ?? ""} disabled={readOnly} onChange={(e) => save({ language: (e.target.value || null) as "tr" | null })}>
            <option value="">—</option>
            {(["tr", "en", "other"] as const).map((l) => (
              <option key={l} value={l}>
                {tf(`languages.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("fields.period")} htmlFor="d-period">
        <Input
          id="d-period"
          value={period}
          disabled={readOnly}
          list="d-period-options"
          placeholder={t("periodPlaceholder")}
          onChange={(e) => setPeriod(e.target.value)}
          onBlur={() => period !== (doc.periodLabel ?? "") && save({ periodLabel: period.trim() || null })}
        />
        <datalist id="d-period-options">
          {data.periods.map((p) => (
            <option key={p.id} value={p.label} />
          ))}
        </datalist>
      </Field>
      <Field label={t("fields.folder")}>
        <Button variant="outline" className="justify-start" disabled={readOnly} onClick={onMove}>
          <FolderInput size={16} />
          <span className="truncate">{folderPath(data.allFolders, doc.folderId, tf("move.root"))}</span>
        </Button>
      </Field>
      {data.orgs.length ? (
        <Field label={t("fields.partners")}>
          <div className="flex flex-wrap gap-1.5">
            {data.orgs.map((o) => {
              const on = partnerIds.includes(o.id);
              return (
                <Chip
                  key={o.id}
                  active={on}
                  aria-pressed={on}
                  disabled={readOnly}
                  onClick={() => {
                    const next = on ? partnerIds.filter((x) => x !== o.id) : [...partnerIds, o.id];
                    setPartnerIds(next);
                    void save({ partnerIds: next });
                  }}
                >
                  {on ? <Check size={13} /> : null}
                  {o.shortName || o.name}
                </Chip>
              );
            })}
          </div>
        </Field>
      ) : null}
      <Field label={tc("tags")}>
        <TagEditor self={{ type: "document", id: doc.id }} initial={doc.tags} readOnly={readOnly} />
      </Field>
      <Field label={t("fields.summary")} htmlFor="d-summary">
        <Textarea
          id="d-summary"
          value={summary}
          disabled={readOnly}
          rows={5}
          placeholder={t("summaryPlaceholder")}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => summary !== (doc.summary ?? "") && save({ summary: summary.trim() || null })}
        />
      </Field>

      <section className="flex flex-col gap-2" aria-labelledby="kd-title">
        <div className="flex items-center justify-between">
          <h3 id="kd-title" className="flex items-center gap-1.5 text-[14px] font-medium">
            <CalendarClock size={14} />
            {t("keyDates")}
          </h3>
          {!readOnly ? (
            <Button size="icon-sm" variant="ghost" onClick={() => setAddingDate(true)} aria-label={t("addKeyDate")}>
              <Plus size={15} />
            </Button>
          ) : null}
        </div>
        {keyDates.length === 0 && !addingDate ? <p className="text-[13px] text-muted">{t("noKeyDates")}</p> : null}
        <ul className="flex flex-col gap-1">
          {keyDates.map((k, i) => (
            <li key={`${k.date}-${i}`} className="group flex items-start gap-2 text-[14px]">
              <span className={cn("w-[88px] shrink-0 tabular-nums", k.date < today ? "text-faint" : "font-medium")}>{formatDay(k.date, locale, true)}</span>
              <span className={cn("min-w-0 flex-1", k.date < today && "text-muted")}>{k.label}</span>
              {!readOnly ? (
                <span className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
                  {k.date >= today ? (
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                      aria-label={t("makeTask", { label: k.label })}
                      title={t("makeTask", { label: k.label })}
                      onClick={() =>
                        runAction(createTaskAction({ title: k.label, dueDate: k.date, sourceType: "document", sourceId: doc.id, orgIds: doc.orgIds, links: [{ type: "document", id: doc.id }] }), {
                          success: t("taskMade"),
                        })
                      }
                    >
                      <CheckSquare size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-ink"
                    aria-label={tc("delete")}
                    onClick={() => {
                      const next = keyDates.filter((_, j) => j !== i);
                      setKeyDates(next);
                      void save({ keyDates: next });
                    }}
                  >
                    <X size={14} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {addingDate ? (
          <KeyDateForm
            onCancel={() => setAddingDate(false)}
            onAdd={(k) => {
              const next = [...keyDates, k].sort((a, b) => a.date.localeCompare(b.date));
              setKeyDates(next);
              setAddingDate(false);
              void save({ keyDates: next });
            }}
          />
        ) : null}
      </section>

      <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-[13px]">
        <Info label={t("info.file")} value={doc.filename} />
        <Info label={t("info.added")} value={formatDateTime(doc.createdAt, locale)} />
        <Info label={t("info.text")} value={t(`textStatus.${["pending", "done", "partial", "failed", "none"].includes(doc.textStatus) ? (doc.textStatus as "done") : "none"}`)} />
        {doc.classificationStatus === "confirmed" ? <Info label={t("info.filing")} value={t("filingConfirmed")} /> : null}
      </dl>
    </aside>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink-2">{value}</dd>
    </div>
  );
}

function Versions({ data, readOnly, busy, onUpload, onView }: { data: DocumentPageData; readOnly: boolean; busy: boolean; onUpload: () => void; onView: (id: string) => void }) {
  const t = useTranslations("files.doc");
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-2" aria-labelledby="versions-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="versions-title" className="label-caps flex items-center gap-1.5">
          <History size={13} />
          {t("versions")}
        </h3>
        {!readOnly ? (
          <Button size="sm" variant="ghost" onClick={onUpload} disabled={busy}>
            <Upload size={14} />
            {t("newVersion")}
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-col">
        {data.versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 text-[14px] last:border-0">
            <span className="w-8 shrink-0 font-mono text-[13px] text-muted">v{v.version}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{v.filename}</span>
              <span className="text-[12px] text-muted">
                {[formatDateTime(v.createdAt, locale), formatBytes(v.size, locale), v.note].filter(Boolean).join(" · ")}
              </span>
            </span>
            {v.current ? (
              <Badge variant="ink" size="sm">
                {t("current")}
              </Badge>
            ) : (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onView(v.id)}>
                  {t("view")}
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/api/files/${data.doc.id}/content?v=${v.id}&download=1`}>
                    <Download size={14} />
                  </a>
                </Button>
                {!readOnly ? (
                  <Button size="sm" variant="ghost" onClick={() => runAction(restoreDocumentVersionAction(data.doc.id, v.id), { success: t("restored", { version: v.version }) })}>
                    {t("makeCurrent")}
                  </Button>
                ) : null}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function KeyDateForm({ onAdd, onCancel }: { onAdd: (k: { date: string; label: string }) => void; onCancel: () => void }) {
  const t = useTranslations("files.doc");
  const tc = useTranslations("common");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-panel p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (date && label.trim()) onAdd({ date, label: label.trim() });
      }}
    >
      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("keyDate")} className="h-10" />
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("keyDateLabel")} aria-label={t("keyDateLabel")} className="h-10" />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={!date || !label.trim()}>
          {tc("add")}
        </Button>
      </div>
    </form>
  );
}

function RenameForm({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (v: string) => Promise<void>; onCancel: () => void }) {
  const tc = useTranslations("common");
  const tf = useTranslations("files");
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        await onSubmit(value.trim());
        setBusy(false);
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={tf("fileName")} autoFocus onFocus={(e) => e.currentTarget.select()} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={!value.trim() || busy}>
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}

function IndicatorForm({
  periods,
  orgs,
  defaultOrg,
  defaultPeriod,
  onSubmit,
  onCancel,
}: {
  periods: { id: string; label: string }[];
  orgs: Org[];
  defaultOrg: string;
  defaultPeriod: string;
  onSubmit: (opts: { periodId: string | null; organisationId: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("files.doc");
  const tc = useTranslations("common");
  const [period, setPeriod] = useState(defaultPeriod);
  const [org, setOrg] = useState(defaultOrg);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSubmit({ periodId: period || null, organisationId: org || null });
      }}
    >
      <Field label={t("fields.period")} htmlFor="ind-period" hint={t("periodAuto")}>
        <Select id="ind-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="">{t("periodFromFile")}</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      {orgs.length ? (
        <Field label={t("fields.partner")} htmlFor="ind-org">
          <Select id="ind-org" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">—</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName || o.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit">
          <Gauge size={15} />
          {t("readIndicatorsGo")}
        </Button>
      </div>
    </form>
  );
}
