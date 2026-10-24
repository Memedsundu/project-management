"use client";

import {
  ArrowDownUp,
  ChevronDown,
  Download,
  Folder,
  FolderInput,
  FolderPlus,
  FolderUp,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldAlert,
  ShieldOff,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trashManyAction } from "@/app/actions/common";
import {
  createFolderAction,
  moveDocumentsAction,
  organizeFolderAction,
  starDocumentsAction,
  updateDocumentAction,
  updateFolderAction,
} from "@/app/(app)/files/actions";
import { useTrash } from "@/components/common/use-trash";
import { SuggestionCard, type InboxSuggestion } from "@/components/inbox/suggestion-card";
import { useScreenContext, useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { Checkbox, Chip, SegmentedLinks } from "@/components/ui/controls";
import { Input, inputClass } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { relativeDayLabel, dayOf } from "@/lib/dates";
import { downloadFrom } from "@/lib/client/download";
import { runAction } from "@/lib/client/run-action";
import { cn, formatBytes } from "@/lib/utils";
import { FileDropOverlay, filesFromInput, uploadPicked } from "./drop-zone";
import { FileIcon } from "./file-icon";
import { FolderPickerDialog } from "./folder-picker";
import type { DocTypeOption, FileItem, FolderItem, FolderNode } from "./types";
import { useUploader } from "./use-uploader";

export type FilesMode = "folder" | "recent" | "starred" | "all";
export type FileFilters = { type?: string; org?: string; period?: string; lang?: string; mime?: string; q?: string; status?: string; tag?: string };
type Org = { id: string; name: string; shortName: string | null };

export type FilesScreenProps = {
  mode: FilesMode;
  folder: { id: string; name: string; aiOff: boolean; parentId: string | null } | null;
  breadcrumb: { id: string; name: string }[];
  subfolders: FolderItem[];
  files: FileItem[];
  allFolders: FolderNode[];
  docTypes: DocTypeOption[];
  orgs: Org[];
  periods: string[];
  filters: FileFilters;
  sort: string;
  dir: "asc" | "desc";
  counts: { toCheck: number; flagged: number };
  organize: InboxSuggestion | null;
  folderNames: Record<string, string>;
  inheritedAiOff: boolean;
};

const VIEW_KEY = "files.view";
const MIMES = ["pdf", "word", "sheet", "slides", "image", "email"] as const;

/** Belgeler: Google Drive's layout with Paperless filing; Claude only ever suggests. */
export function FilesScreen(props: FilesScreenProps) {
  const t = useTranslations("files");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const shell = useShell();
  const trash = useTrash();
  const uploader = useUploader();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<{ kind: "folder" | "document"; id: string; name: string } | null>(null);
  const [move, setMove] = useState<{ kind: "folder" | "documents"; ids: string[]; current: string | null } | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [q, setQ] = useState(props.filters.q ?? "");
  const readOnly = shell.readOnly;
  const folderId = props.folder?.id ?? null;
  const title = props.mode === "folder" ? (props.folder?.name ?? t("title")) : t(`views.${props.mode}`);
  useScreenContext({ kind: props.folder ? "folder" : "files", id: props.folder?.id, title });

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
      if (v === "grid" || v === "list") setView(v);
    } catch {
      // Private window: keep the list.
    }
  }, []);

  const hrefWith = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  // Title search follows typing with a short pause.
  useEffect(() => {
    if ((props.filters.q ?? "") === q) return;
    const h = window.setTimeout(() => router.replace(hrefWith({ q: q || null }), { scroll: false }), 300);
    return () => window.clearTimeout(h);
  }, [q, props.filters.q, hrefWith, router]);

  const typeName = useCallback((key: string | null) => {
    if (!key) return null;
    const d = props.docTypes.find((x) => x.key === key);
    return d ? (locale === "en" ? d.en : d.tr) : key;
  }, [props.docTypes, locale]);
  const orgName = useCallback((id: string) => {
    const o = props.orgs.find((x) => x.id === id);
    return o ? o.shortName || o.name : null;
  }, [props.orgs]);

  const selectedIds = [...selected].filter((id) => props.files.some((f) => f.id === id));
  const allSelected = props.files.length > 0 && selectedIds.length === props.files.length;
  const toggle = (id: string, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  const doUpload = async (list: FileList | null) => {
    const picked = filesFromInput(list);
    await uploadPicked(picked, folderId, uploader, { creating: t("drop.creatingFolders") });
  };

  const filterChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterMenu
        label={t("filters.type")}
        value={props.filters.type ? typeName(props.filters.type) : null}
        options={props.docTypes.map((d) => ({ value: d.key, label: locale === "en" ? d.en : d.tr }))}
        onPick={(v) => router.push(hrefWith({ type: v }), { scroll: false })}
        clear={tc("all")}
      />
      {props.orgs.length ? (
        <FilterMenu
          label={t("filters.partner")}
          value={props.filters.org ? orgName(props.filters.org) : null}
          options={props.orgs.map((o) => ({ value: o.id, label: o.shortName || o.name }))}
          onPick={(v) => router.push(hrefWith({ org: v }), { scroll: false })}
          clear={tc("all")}
        />
      ) : null}
      {props.periods.length ? (
        <FilterMenu
          label={t("filters.period")}
          value={props.filters.period ?? null}
          options={props.periods.map((p) => ({ value: p, label: p }))}
          onPick={(v) => router.push(hrefWith({ period: v }), { scroll: false })}
          clear={tc("all")}
        />
      ) : null}
      <FilterMenu
        label={t("filters.language")}
        value={props.filters.lang ? t(`languages.${props.filters.lang as "tr"}`) : null}
        options={["tr", "en", "other"].map((l) => ({ value: l, label: t(`languages.${l as "tr"}`) }))}
        onPick={(v) => router.push(hrefWith({ lang: v }), { scroll: false })}
        clear={tc("all")}
      />
      <FilterMenu
        label={t("filters.format")}
        value={props.filters.mime ? t(`formats.${props.filters.mime as "pdf"}`) : null}
        options={MIMES.map((m) => ({ value: m, label: t(`formats.${m}`) }))}
        onPick={(v) => router.push(hrefWith({ mime: v }), { scroll: false })}
        clear={tc("all")}
      />
      {Object.values(props.filters).some(Boolean) ? (
        <Button variant="ghost" size="sm" onClick={() => router.push(hrefWith({ type: null, org: null, period: null, lang: null, mime: null, q: null, status: null, tag: null }), { scroll: false })}>
          <X size={14} />
          {t("filters.clear")}
        </Button>
      ) : null}
    </div>
  );

  const sortLabels: Record<string, string> = { name: t("sort.name"), updated: t("sort.updated"), created: t("sort.created"), size: t("sort.size"), type: t("sort.type") };

  return (
    <div className="flex flex-col gap-6">
      <FileDropOverlay folderId={folderId} uploader={uploader} disabled={readOnly || props.mode !== "folder"} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => void doUpload(e.target.files).then(() => (e.target.value = ""))} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // @ts-expect-error -- non-standard attribute that lets the picker choose a whole folder
        webkitdirectory=""
        onChange={(e) => void doUpload(e.target.files).then(() => (e.target.value = ""))}
      />

      <PageHeader
        eyebrow={
          props.mode === "folder" && props.folder ? (
            <nav aria-label={t("breadcrumb")} className="flex flex-wrap items-center gap-1">
              <Link href="/files" className="hover:text-ink">
                {t("title")}
              </Link>
              {props.breadcrumb.map((b) => (
                <span key={b.id} className="flex items-center gap-1">
                  <span aria-hidden>/</span>
                  <Link href={`/files/f/${b.id}`} className="hover:text-ink">
                    {b.name}
                  </Link>
                </span>
              ))}
            </nav>
          ) : undefined
        }
        title={
          <span className="flex items-center gap-3">
            {title}
            {props.folder?.aiOff || props.inheritedAiOff ? (
              <Badge variant="outline" size="sm" className="font-sans">
                <ShieldOff size={12} /> {tc("aiOff")}
              </Badge>
            ) : null}
          </span>
        }
        subtitle={props.mode === "folder" && !props.folder ? t("subtitle") : undefined}
        actions={
          !readOnly ? (
            <>
              {uploader.busy ? <span className="text-[13px] text-muted">{uploader.label}</span> : null}
              {props.mode === "folder" ? (
                <>
                  <Button variant="outline" onClick={() => setNewFolder(true)}>
                    <FolderPlus size={16} />
                    {t("newFolder")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button disabled={uploader.busy}>
                        <Upload size={16} />
                        {t("uploadButton")}
                        <ChevronDown size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                        <Upload size={15} />
                        {t("uploadFiles")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => folderInput.current?.click()}>
                        <FolderUp size={15} />
                        {t("uploadFolder")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : null}
              {props.folder ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("folderMenu")}>
                      <MoreHorizontal size={18} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[260px]">
                    {shell.aiConfigured && !props.folder.aiOff && !props.inheritedAiOff ? (
                      <DropdownMenuItem
                        disabled={organizing}
                        onSelect={async () => {
                          setOrganizing(true);
                          const res = await runAction(organizeFolderAction(props.folder!.id));
                          setOrganizing(false);
                          if (res?.suggestionId) router.push(hrefWith({ organize: res.suggestionId }), { scroll: false });
                          else if (res) shellToast(t("organize.nothing"));
                        }}
                      >
                        <Wand2 size={15} />
                        {t("organize.action")}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => setRename({ kind: "folder", id: props.folder!.id, name: props.folder!.name })}>
                      <Pencil size={15} />
                      {t("rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMove({ kind: "folder", ids: [props.folder!.id], current: props.folder!.parentId })}>
                      <FolderInput size={15} />
                      {t("move.action")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        runAction(updateFolderAction(props.folder!.id, { aiOff: !props.folder!.aiOff }), { success: props.folder!.aiOff ? t("aiOnDone") : t("aiOffDone") })
                      }
                    >
                      {props.folder.aiOff ? <Sparkles size={15} /> : <ShieldOff size={15} />}
                      {props.folder.aiOff ? t("allowAi") : t("closeToAi")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      danger
                      onSelect={() => trash("folder", props.folder!.id, { title: props.folder!.name, redirectTo: props.folder!.parentId ? `/files/f/${props.folder!.parentId}` : "/files" })}
                    >
                      <Trash2 size={15} />
                      {t("deleteFolder")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : null
        }
      />

      <SegmentedLinks
        active={props.mode}
        items={[
          { key: "folder", label: t("views.folder"), href: "/files" },
          { key: "recent", label: t("views.recent"), href: "/files?view=recent" },
          { key: "starred", label: t("views.starred"), href: "/files?view=starred" },
          { key: "all", label: t("views.all"), href: "/files?view=all" },
          { key: "check", label: t("views.check"), href: "/files/check", count: props.counts.toCheck },
        ]}
      />

      {props.counts.flagged ? (
        <Link href="/files/check?tab=flagged" className="flex items-start gap-3 rounded-2xl bg-accent-soft px-5 py-3.5 text-accent-ink">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <span className="text-[14px]">{t("flaggedBanner", { count: props.counts.flagged })}</span>
        </Link>
      ) : null}

      {organizing ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4 text-[14px] text-muted">
          <Sparkles size={16} className="animate-pulse text-accent" />
          {t("organize.working")}
        </div>
      ) : null}
      {props.organize ? (
        <div className="flex flex-col gap-2">
          <SuggestionCard s={props.organize} readOnly={readOnly} folderNames={props.folderNames} />
          <Link href={hrefWith({ organize: null })} className="self-end text-[13px] text-muted hover:text-ink">
            {t("organize.hide")}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filterPlaceholder")} aria-label={t("filterPlaceholder")} className={cn(inputClass, "h-10 rounded-full pl-10")} />
          </div>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <ArrowDownUp size={15} />
                {sortLabels[props.sort] ?? sortLabels.updated}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{t("sort.label")}</DropdownMenuLabel>
              {Object.entries(sortLabels).map(([k, label]) => (
                <DropdownMenuItem key={k} onSelect={() => router.push(hrefWith({ sort: k === "updated" ? null : k, dir: null }), { scroll: false })}>
                  <span className={cn("size-1.5 rounded-full", props.sort === k ? "bg-ink" : "bg-transparent")} />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push(hrefWith({ dir: props.dir === "asc" ? "desc" : "asc" }), { scroll: false })}>
                <ArrowDownUp size={15} />
                {props.dir === "asc" ? t("sort.desc") : t("sort.asc")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex rounded-full border border-line-strong p-0.5" role="group" aria-label={t("viewMode")}>
            {(["list", "grid"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-label={v === "list" ? t("list") : t("grid")}
                onClick={() => {
                  setView(v);
                  try {
                    localStorage.setItem(VIEW_KEY, v);
                  } catch {
                    // ignore
                  }
                }}
                className={cn("flex h-8 w-9 items-center justify-center rounded-full", view === v ? "bg-ink text-on-ink" : "text-muted hover:text-ink")}
              >
                {v === "list" ? <List size={15} /> : <LayoutGrid size={15} />}
              </button>
            ))}
          </div>
        </div>
        {filterChips}
      </div>

      {props.mode === "folder" && props.subfolders.length ? (
        <section aria-labelledby="folders-title" className="flex flex-col gap-2">
          <h2 id="folders-title" className="label-caps">
            {t("folders")}
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {props.subfolders.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/files/f/${f.id}`}
                  className="flex min-h-14 items-center gap-3 rounded-2xl border border-line px-4 py-2.5 hover:border-ink"
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-doc-ids")) e.preventDefault();
                  }}
                  onDrop={async (e) => {
                    const raw = e.dataTransfer.getData("application/x-doc-ids");
                    if (!raw) return;
                    e.preventDefault();
                    e.stopPropagation();
                    await runAction(moveDocumentsAction(JSON.parse(raw) as string[], f.id), { success: t("moved") });
                    setSelected(new Set());
                  }}
                >
                  <Folder size={20} className="shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-medium">{f.name}</span>
                    <span className="text-[12px] text-muted">{t("folderCounts", { files: f.documentCount, folders: f.folderCount })}</span>
                  </span>
                  {f.aiOff ? <ShieldOff size={14} className="ml-auto shrink-0 text-muted" aria-label={tc("aiOff")} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="files-title" className="flex flex-col gap-2">
        {props.mode === "folder" && props.subfolders.length ? (
          <h2 id="files-title" className="label-caps">
            {t("files")}
          </h2>
        ) : (
          <h2 id="files-title" className="sr-only">
            {t("files")}
          </h2>
        )}
        {props.files.length === 0 ? (
          props.mode === "folder" && !props.subfolders.length && !Object.values(props.filters).some(Boolean) ? (
            <EmptyState
              title={props.folder ? t("emptyFolder.title") : t("empty.title")}
              body={props.folder ? t("emptyFolder.body") : t("empty.body")}
              action={
                !readOnly ? (
                  <Button onClick={() => fileInput.current?.click()}>
                    <Upload size={16} />
                    {t("uploadFiles")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <p className="py-6 text-[15px] text-muted">{t("noMatch")}</p>
          )
        ) : view === "list" ? (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="w-10 py-2 pl-1">
                    {!readOnly ? <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(props.files.map((f) => f.id)) : new Set())} aria-label={tc("selectAll")} /> : null}
                  </th>
                  <th className="py-2 pr-3 font-medium">{t("columns.name")}</th>
                  <th className="hidden w-[150px] py-2 pr-3 font-medium md:table-cell">{t("columns.type")}</th>
                  <th className="hidden w-[120px] py-2 pr-3 font-medium xl:table-cell">{t("columns.partner")}</th>
                  <th className="hidden w-[96px] py-2 pr-3 font-medium lg:table-cell">{t("columns.period")}</th>
                  <th className="w-[96px] py-2 pr-3 font-medium sm:w-[110px]">{t("columns.updated")}</th>
                  <th className="hidden w-[84px] py-2 pr-3 text-right font-medium sm:table-cell">{t("columns.size")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {props.files.map((f) => (
                  <tr
                    key={f.id}
                    className={cn("group border-b border-line-soft hover:bg-bg-subtle", selected.has(f.id) && "bg-panel hover:bg-panel")}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      const ids = selected.has(f.id) ? selectedIds : [f.id];
                      e.dataTransfer.setData("application/x-doc-ids", JSON.stringify(ids));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <td className="py-1.5 pl-1">
                      {!readOnly ? <Checkbox checked={selected.has(f.id)} onCheckedChange={(v) => toggle(f.id, v === true)} aria-label={f.title} /> : null}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Link href={`/files/d/${f.id}`} className="flex min-h-11 items-center gap-3">
                        <FileIcon mime={f.mime} filename={f.filename} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{f.title}</span>
                            {f.starred ? <Star size={13} className="shrink-0 fill-current" aria-label={t("starred")} /> : null}
                            {f.childDataFlag ? <ShieldAlert size={13} className="shrink-0 text-accent" aria-label={t("flagged")} /> : null}
                            {f.classificationStatus === "suggested" ? (
                              <Badge variant="ai" size="sm">
                                {t("toCheck")}
                              </Badge>
                            ) : null}
                          </span>
                          <span className="truncate text-[12px] text-muted md:hidden">{[typeName(f.docType), f.periodLabel].filter(Boolean).join(" · ") || f.filename}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="hidden truncate py-1.5 pr-3 text-ink-2 md:table-cell">{typeName(f.docType) ?? <span className="text-faint">—</span>}</td>
                    <td className="hidden truncate py-1.5 pr-3 text-ink-2 xl:table-cell">{f.orgIds.map(orgName).filter(Boolean).join(", ") || <span className="text-faint">—</span>}</td>
                    <td className="hidden truncate py-1.5 pr-3 text-ink-2 lg:table-cell">{f.periodLabel ?? <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-ink-2">{relativeDayLabel(dayOf(f.updatedAt), locale)}</td>
                    <td className="hidden whitespace-nowrap py-1.5 pr-3 text-right text-ink-2 sm:table-cell">{formatBytes(f.size, locale)}</td>
                    <td className="py-1.5 pr-1">
                      <RowMenu
                        file={f}
                        readOnly={readOnly}
                        onRename={() => setRename({ kind: "document", id: f.id, name: f.title })}
                        onMove={() => setMove({ kind: "documents", ids: [f.id], current: f.folderId })}
                        onTrash={() => trash("document", f.id, { title: f.title })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {props.files.map((f) => (
              <li key={f.id} className="group relative">
                <Link href={`/files/d/${f.id}`} className={cn("flex h-full flex-col gap-3 rounded-2xl border border-line p-3.5 hover:border-ink", selected.has(f.id) && "border-ink")}>
                  <span className="flex h-24 items-center justify-center rounded-xl bg-panel">
                    <FileIcon mime={f.mime} filename={f.filename} size={30} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="line-clamp-2 text-[14px] font-medium leading-snug">{f.title}</span>
                    <span className="truncate text-[12px] text-muted">{[typeName(f.docType), relativeDayLabel(dayOf(f.updatedAt), locale)].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
                {!readOnly ? (
                  <span className={cn("absolute left-2.5 top-2.5 rounded-md bg-bg p-1 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100", selected.has(f.id) && "opacity-100")}>
                    <Checkbox checked={selected.has(f.id)} onCheckedChange={(v) => toggle(f.id, v === true)} aria-label={f.title} />
                  </span>
                ) : null}
                {f.starred ? <Star size={14} className="absolute right-3 top-3 fill-current" aria-label={t("starred")} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedIds.length ? (
        <div className="sticky bottom-24 z-30 mx-auto flex flex-wrap items-center gap-1 rounded-full border border-line bg-bg px-3 py-1.5 shadow-[var(--shadow)] lg:bottom-6">
          <span className="px-2 text-[14px] font-medium">{tc("selected", { count: selectedIds.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => setMove({ kind: "documents", ids: selectedIds, current: folderId })}>
            <FolderInput size={15} />
            {t("move.action")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const allStarred = selectedIds.every((id) => props.files.find((f) => f.id === id)?.starred);
              await runAction(starDocumentsAction(selectedIds, !allStarred));
            }}
          >
            <Star size={15} />
            {t("star")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const res = await runAction(trashManyAction("document", selectedIds), { success: tc("movedToTrash") });
              if (res !== undefined) setSelected(new Set());
            }}
          >
            <Trash2 size={15} />
            {tc("delete")}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={t("clearSelection")}>
            <X size={15} />
          </Button>
        </div>
      ) : null}

      <Dialog open={newFolder} onOpenChange={setNewFolder}>
        <DialogContent title={t("newFolder")}>
          <NameForm
            initial=""
            placeholder={t("folderName")}
            submit={tc("create")}
            onCancel={() => setNewFolder(false)}
            onSubmit={async (name) => {
              const res = await runAction(createFolderAction(name, folderId));
              if (res) setNewFolder(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rename)} onOpenChange={(v) => !v && setRename(null)}>
        <DialogContent title={t("rename")}>
          {rename ? (
            <NameForm
              initial={rename.name}
              placeholder={rename.kind === "folder" ? t("folderName") : t("fileName")}
              submit={tc("save")}
              onCancel={() => setRename(null)}
              onSubmit={async (name) => {
                const res =
                  rename.kind === "folder" ? await runAction(updateFolderAction(rename.id, { name })) : await runAction(updateDocumentAction(rename.id, { title: name }));
                if (res !== undefined) setRename(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {move ? (
        <FolderPickerDialog
          open
          onOpenChange={(v) => !v && setMove(null)}
          folders={props.allFolders}
          current={move.current}
          exclude={move.kind === "folder" ? move.ids : []}
          title={move.kind === "folder" ? t("move.folderTitle") : t("move.title", { count: move.ids.length })}
          onPick={async (target) => {
            const res =
              move.kind === "folder"
                ? await runAction(updateFolderAction(move.ids[0]!, { parentId: target }), { success: t("moved") })
                : await runAction(moveDocumentsAction(move.ids, target), { success: t("moved") });
            if (res !== undefined) {
              setMove(null);
              setSelected(new Set());
            }
          }}
        />
      ) : null}
    </div>
  );
}

function shellToast(message: string) {
  void import("sonner").then(({ toast }) => toast(message));
}

function RowMenu({ file, readOnly, onRename, onMove, onTrash }: { file: FileItem; readOnly: boolean; onRename: () => void; onMove: () => void; onTrash: () => void }) {
  const t = useTranslations("files");
  const tc = useTranslations("common");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("fileMenu", { title: file.title })}
          className="flex size-9 items-center justify-center rounded-full text-muted opacity-60 hover:bg-panel hover:text-ink group-hover:opacity-100"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem href={`/files/d/${file.id}`}>{tc("open")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadFrom(`/api/files/${file.id}/content?download=1`)}>
          <Download size={15} />
          {tc("download")}
        </DropdownMenuItem>
        {!readOnly ? (
          <>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil size={15} />
              {t("rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <FolderInput size={15} />
              {t("move.action")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runAction(starDocumentsAction([file.id], !file.starred))}>
              <Star size={15} />
              {file.starred ? t("unstar") : t("star")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={onTrash}>
              <Trash2 size={15} />
              {tc("delete")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterMenu({ label, value, options, onPick, clear }: { label: string; value: string | null; options: { value: string; label: string }[]; onPick: (v: string | null) => void; clear: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => (q ? options.filter((o) => o.label.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))) : options), [options, q]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip active={Boolean(value)}>
          {value ? `${label}: ${value}` : label}
          <ChevronDown size={14} />
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-[260px] overflow-y-auto">
        {options.length > 8 ? (
          <div className="p-1" onKeyDown={(e) => e.stopPropagation()}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} aria-label={label} className="h-9" />
          </div>
        ) : null}
        <DropdownMenuItem onSelect={() => onPick(null)}>{clear}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {shown.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onPick(o.value)}>
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NameForm({ initial, placeholder, submit, onSubmit, onCancel }: { initial: string; placeholder: string; submit: string; onSubmit: (v: string) => Promise<void>; onCancel: () => void }) {
  const tc = useTranslations("common");
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
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus onFocus={(e) => e.currentTarget.select()} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={!value.trim() || busy}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
