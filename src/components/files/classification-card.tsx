"use client";

import { ArrowRight, CalendarClock, Check, Folder, Hash, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/actions/suggestions";
import type { InboxSuggestion } from "@/components/inbox/suggestion-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Chip } from "@/components/ui/controls";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatDay, todayStr } from "@/lib/dates";
import { runAction } from "@/lib/client/run-action";
import { cn, formatBytes } from "@/lib/utils";
import { FileIcon } from "./file-icon";
import { FolderPickerDialog } from "./folder-picker";
import type { DocTypeOption, FolderNode } from "./types";

type Payload = {
  documentId: string;
  docType: string;
  confidence: number;
  title: string;
  language: "tr" | "en" | "other";
  status: "draft" | "final" | "signed";
  periodLabel: string | null;
  folderId: string | null;
  partnerIds: string[];
  tags: string[];
  summary: string;
  keyDates: { date: string; label: string }[];
  previous: { title: string; folderId: string | null };
};

type Org = { id: string; name: string; shortName: string | null };

export function folderPath(folders: FolderNode[], id: string | null, root: string) {
  if (!id) return root;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 30) {
    names.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return names.length ? names.join(" / ") : root;
}

/**
 * Paperless-style filing proposal: every field Claude chose, editable in place.
 * Nothing about the file changes until she presses "Dosyala".
 */
export function ClassificationCard({
  s,
  file,
  docTypes,
  orgs,
  folders,
  readOnly,
  onDone,
  showFile = true,
}: {
  s: InboxSuggestion;
  file?: { id: string; filename: string; mime: string; size: number } | null;
  docTypes: DocTypeOption[];
  orgs: Org[];
  folders: FolderNode[];
  readOnly: boolean;
  onDone?: () => void;
  showFile?: boolean;
}) {
  const t = useTranslations("files.classify");
  const tf = useTranslations("files");
  const tc = useTranslations("common");
  const locale = useLocale();
  const p = s.payload as Payload;
  const today = todayStr();
  const [title, setTitle] = useState(p.title);
  const [docType, setDocType] = useState(p.docType);
  const [folderId, setFolderId] = useState<string | null>(p.folderId);
  const [partnerIds, setPartnerIds] = useState<string[]>(p.partnerIds ?? []);
  const [periodLabel, setPeriodLabel] = useState(p.periodLabel ?? "");
  const [language, setLanguage] = useState(p.language);
  const [status, setStatus] = useState(p.status);
  const [tags, setTags] = useState<string[]>(p.tags ?? []);
  const [tagText, setTagText] = useState("");
  const [summary, setSummary] = useState(p.summary ?? "");
  const [keyDates, setKeyDates] = useState(p.keyDates ?? []);
  const [keyDateTasks, setKeyDateTasks] = useState(() => (p.keyDates ?? []).some((k) => k.date >= today));
  const [editing, setEditing] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  const futureDates = useMemo(() => keyDates.filter((k) => k.date >= today), [keyDates, today]);
  const typeName = (key: string) => {
    const d = docTypes.find((x) => x.key === key);
    return d ? (locale === "en" ? d.en : d.tr) : key;
  };
  const orgName = (id: string) => {
    const o = orgs.find((x) => x.id === id);
    return o ? o.shortName || o.name : null;
  };
  const sure = p.confidence >= 0.75;

  if (gone) return null;

  const accept = async () => {
    setBusy(true);
    const decision = {
      title: title.trim() || p.title,
      docType,
      folderId,
      partnerIds,
      periodLabel: periodLabel.trim() || null,
      language,
      status,
      tags,
      summary,
      keyDates,
      keyDateTasks: keyDateTasks && futureDates.length > 0,
    };
    const res = await runAction(acceptSuggestionAction(s.id, decision), { success: t("filed") });
    setBusy(false);
    if (res) {
      setGone(true);
      onDone?.();
    }
  };
  const reject = async () => {
    setBusy(true);
    const res = await runAction(rejectSuggestionAction(s.id), { success: t("rejected") });
    setBusy(false);
    if (res !== undefined) {
      setGone(true);
      onDone?.();
    }
  };
  const addTag = () => {
    const clean = tagText.replace(/^#/, "").trim();
    if (clean && !tags.some((x) => x.toLocaleLowerCase("tr") === clean.toLocaleLowerCase("tr"))) setTags([...tags, clean]);
    setTagText("");
  };

  const rows: { label: string; value: React.ReactNode; changed?: boolean }[] = [
    { label: t("fields.type"), value: typeName(docType) },
    { label: t("fields.folder"), value: folderPath(folders, folderId, tf("move.root")), changed: folderId !== p.previous.folderId },
    { label: t("fields.partners"), value: partnerIds.map(orgName).filter(Boolean).join(", ") || "—" },
    { label: t("fields.period"), value: periodLabel || "—" },
    { label: t("fields.language"), value: tf(`languages.${language}`) },
    { label: t("fields.status"), value: tf(`statuses.${status}`) },
  ];

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-line px-5 py-4" aria-label={title}>
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="ai" size="sm">
          <Sparkles size={12} />
          {t("badge")}
        </Badge>
        <Badge variant={sure ? "outline" : "overdue"} size="sm">
          {sure ? t("sure") : t("unsure")}
        </Badge>
        <span className="flex-1" />
        {!readOnly ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? t("doneEditing") : t("edit")}
          </Button>
        ) : null}
      </header>

      {showFile && file ? (
        <Link href={`/files/d/${file.id}`} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 hover:bg-panel-2">
          <FileIcon mime={file.mime} filename={file.filename} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-medium">{file.filename}</span>
            <span className="text-[12px] text-muted">{formatBytes(file.size, locale)}</span>
          </span>
          <ArrowRight size={15} className="ml-auto shrink-0 text-muted" />
        </Link>
      ) : null}

      {!editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            {p.previous.title !== title ? <span className="text-[13px] text-muted line-through">{p.previous.title}</span> : null}
            <h3 className="text-[17px] font-semibold leading-snug">{title}</h3>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex min-w-0 gap-2">
                <dt className="w-24 shrink-0 text-muted">{r.label}</dt>
                <dd className={cn("min-w-0 truncate", r.changed && "font-medium")}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-full bg-panel-2 px-2.5 text-[12.5px]">
                  <Hash size={11} className="text-muted" />
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {summary ? <p className="text-[14px] leading-relaxed text-ink-2">{summary}</p> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("fields.title")} htmlFor={`t-${s.id}`} className="sm:col-span-2">
            <Input id={`t-${s.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("fields.type")} htmlFor={`ty-${s.id}`}>
            <Select id={`ty-${s.id}`} value={docType} onChange={(e) => setDocType(e.target.value)}>
              {docTypes.map((d) => (
                <option key={d.key} value={d.key}>
                  {locale === "en" ? d.en : d.tr}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("fields.folder")}>
            <Button variant="outline" className="justify-start" onClick={() => setPickFolder(true)}>
              <Folder size={16} />
              <span className="truncate">{folderPath(folders, folderId, tf("move.root"))}</span>
            </Button>
          </Field>
          <Field label={t("fields.period")} htmlFor={`pe-${s.id}`}>
            <Input id={`pe-${s.id}`} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder={t("periodPlaceholder")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("fields.language")} htmlFor={`la-${s.id}`}>
              <Select id={`la-${s.id}`} value={language} onChange={(e) => setLanguage(e.target.value as Payload["language"])}>
                {(["tr", "en", "other"] as const).map((l) => (
                  <option key={l} value={l}>
                    {tf(`languages.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.status")} htmlFor={`st-${s.id}`}>
              <Select id={`st-${s.id}`} value={status} onChange={(e) => setStatus(e.target.value as Payload["status"])}>
                {(["draft", "final", "signed"] as const).map((x) => (
                  <option key={x} value={x}>
                    {tf(`statuses.${x}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {orgs.length ? (
            <Field label={t("fields.partners")} className="sm:col-span-2">
              <div className="flex flex-wrap gap-1.5">
                {orgs.map((o) => {
                  const on = partnerIds.includes(o.id);
                  return (
                    <Chip key={o.id} active={on} aria-pressed={on} onClick={() => setPartnerIds(on ? partnerIds.filter((x) => x !== o.id) : [...partnerIds, o.id])}>
                      {on ? <Check size={13} /> : null}
                      {o.shortName || o.name}
                    </Chip>
                  );
                })}
              </div>
            </Field>
          ) : null}
          <Field label={t("fields.tags")} className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-full bg-panel-2 pl-2.5 pr-1 text-[13px]">
                  <Hash size={12} className="text-muted" />
                  {tag}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== tag))} aria-label={tc("removeTag", { tag })} className="flex size-5 items-center justify-center rounded-full hover:bg-line">
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder={tc("addTag")}
                aria-label={tc("addTag")}
                className="h-7 min-w-[120px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
            </div>
          </Field>
          <Field label={t("fields.summary")} htmlFor={`su-${s.id}`} className="sm:col-span-2">
            <Textarea id={`su-${s.id}`} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
          </Field>
        </div>
      )}

      {keyDates.length ? (
        <div className="flex flex-col gap-2 rounded-xl bg-panel px-4 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <CalendarClock size={14} />
            {t("keyDates")}
          </p>
          <ul className="flex flex-col gap-1">
            {keyDates.map((k, i) => (
              <li key={`${k.date}-${i}`} className="flex items-center gap-2 text-[14px]">
                <span className={cn("w-28 shrink-0 tabular-nums", k.date < today ? "text-faint" : "font-medium")}>{formatDay(k.date, locale, true)}</span>
                <span className={cn("min-w-0 flex-1", k.date < today && "text-muted")}>{k.label}</span>
                {editing ? (
                  <button type="button" onClick={() => setKeyDates(keyDates.filter((_, j) => j !== i))} aria-label={tc("delete")} className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-line hover:text-ink">
                    <X size={13} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {futureDates.length ? (
            <label className="flex items-center gap-2.5 pt-1 text-[14px]">
              <Checkbox checked={keyDateTasks} onCheckedChange={(v) => setKeyDateTasks(v === true)} disabled={readOnly} />
              {t("keyDateTasks", { count: futureDates.length })}
            </label>
          ) : null}
        </div>
      ) : editing ? (
        <AddKeyDate onAdd={(k) => setKeyDates([...keyDates, k])} />
      ) : null}

      {!readOnly ? (
        <footer className="flex flex-wrap gap-2">
          <Button size="sm" onClick={accept} disabled={busy}>
            <Check size={14} />
            {t("accept")}
          </Button>
          <Button size="sm" variant="ghost" onClick={reject} disabled={busy}>
            <X size={14} />
            {t("reject")}
          </Button>
        </footer>
      ) : null}

      {pickFolder ? (
        <FolderPickerDialog
          open
          onOpenChange={(v) => !v && setPickFolder(false)}
          folders={folders}
          current={folderId}
          exclude={[]}
          title={t("pickFolder")}
          onPick={async (target) => {
            setFolderId(target);
            setPickFolder(false);
          }}
        />
      ) : null}
    </article>
  );
}

function AddKeyDate({ onAdd }: { onAdd: (k: { date: string; label: string }) => void }) {
  const t = useTranslations("files.classify");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("keyDate")} htmlFor="kd-date">
        <Input id="kd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-[170px]" />
      </Field>
      <Field label={t("keyDateLabel")} htmlFor="kd-label" className="min-w-[200px] flex-1">
        <Input id="kd-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Button
        variant="outline"
        disabled={!date || !label.trim()}
        onClick={() => {
          onAdd({ date, label: label.trim() });
          setDate("");
          setLabel("");
        }}
      >
        <Plus size={15} />
        {t("addKeyDate")}
      </Button>
    </div>
  );
}
