"use client";

import { ArrowDown, ArrowUp, Combine, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { deleteTagAction, mergeTagsAction, renameTagAction, renameTemplateAction, saveDocTypesAction } from "@/app/(app)/settings/actions";
import { useTrash } from "@/components/common/use-trash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import type { SettingsData } from "@/server/views/settings";

type DocType = { key: string | null; tr: string; en: string; description: string; used: number };

/**
 * Belge türleri (Paperless document types): the names Claude files by. A
 * type with files can go only after she says where its files move.
 */
export function DocTypesDialog({ open, onOpenChange, types, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; types: SettingsData["docTypes"]; readOnly: boolean }) {
  const t = useTranslations("settings.lists.docTypes");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<DocType[]>(types.map((d) => ({ ...d })));
  const [moveTo, setMoveTo] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const removed = types.filter((d) => !rows.some((r) => r.key === d.key));
  const valid = rows.length > 0 && rows.every((r) => r.tr.trim() && r.en.trim());

  const update = (i: number, patch: Partial<DocType>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  async function save() {
    setBusy(true);
    const res = await runAction(
      saveDocTypesAction(
        rows.map((r) => ({ key: r.key, tr: r.tr, en: r.en, description: r.description })),
        moveTo,
      ),
      { success: t("saved") },
    );
    setBusy(false);
    if (res) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} wide>
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col" data-testid="doc-types">
            {rows.map((r, i) => (
              <li key={r.key ?? `new-${i}`} className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-right text-[13px] tabular-nums text-faint">{i + 1}</span>
                  <Input value={r.tr} onChange={(e) => update(i, { tr: e.target.value })} maxLength={80} placeholder={t("nameTr")} aria-label={t("nameTr")} className="h-10 min-w-0 flex-1 basis-40" disabled={readOnly} />
                  <Input value={r.en} onChange={(e) => update(i, { en: e.target.value })} maxLength={80} placeholder={t("nameEn")} aria-label={t("nameEn")} className="h-10 min-w-0 flex-1 basis-40" disabled={readOnly} />
                  <span className="flex items-center gap-1">
                    {r.used ? (
                      <Badge variant="outline" size="sm">
                        {t("files", { count: r.used })}
                      </Badge>
                    ) : null}
                    {!readOnly ? (
                      <>
                        <Button variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("up")}>
                          <ArrowUp size={15} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={t("down")}>
                          <ArrowDown size={15} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setRows((list) => list.filter((_, j) => j !== i))} aria-label={t("remove", { name: r.tr || r.en })} data-testid="doc-type-remove">
                          <Trash2 size={15} />
                        </Button>
                      </>
                    ) : null}
                  </span>
                </div>
                <Input
                  value={r.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  maxLength={300}
                  placeholder={t("descriptionPlaceholder")}
                  aria-label={t("descriptionLabel")}
                  className="ml-8 h-9 w-[calc(100%-2rem)] text-[14px]"
                  disabled={readOnly}
                />
              </li>
            ))}
          </ol>
          {!readOnly ? (
            <Button variant="outline" className="self-start" onClick={() => setRows((list) => [...list, { key: null, tr: "", en: "", description: "", used: 0 }])} data-testid="doc-type-add">
              <Plus size={15} />
              {t("add")}
            </Button>
          ) : null}
          {removed.some((d) => d.used) ? (
            <div className="flex flex-col gap-2 rounded-2xl bg-panel px-4 py-3">
              <p className="text-[14px] font-medium">{t("moveTitle")}</p>
              {removed
                .filter((d) => d.used)
                .map((d) => (
                  <label key={d.key} className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="min-w-0 flex-1">{t("moveRow", { name: locale === "en" ? d.en : d.tr, count: d.used })}</span>
                    <Select value={moveTo[d.key] ?? ""} onChange={(e) => setMoveTo((m) => ({ ...m, [d.key]: e.target.value || null }))} className="h-9 w-[200px] text-[14px]" data-testid="doc-type-move">
                      <option value="">{t("noType")}</option>
                      {rows
                        .filter((r) => r.key)
                        .map((r) => (
                          <option key={r.key} value={r.key!}>
                            {locale === "en" ? r.en : r.tr}
                          </option>
                        ))}
                    </Select>
                  </label>
                ))}
            </div>
          ) : null}
          {!readOnly ? (
            <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </Button>
              <Button onClick={save} disabled={!valid || busy} data-testid="doc-types-save">
                {tc("save")}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Etiketler (Bear, Things): rename, merge into another, or remove from everything. */
export function TagsDialog({ open, onOpenChange, tags, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; tags: SettingsData["tags"]; readOnly: boolean }) {
  const t = useTranslations("settings.lists.tags");
  const tc = useTranslations("common");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("tr").replace(/^#/, "");
    return needle ? tags.filter((x) => x.name.toLocaleLowerCase("tr").includes(needle)) : tags;
  }, [q, tags]);

  async function rename() {
    if (!editing) return;
    const res = await runAction(renameTagAction(editing.id, editing.name));
    if (!res) return;
    toast(res.mergedInto ? t("mergedInto", { name: res.mergedInto }) : t("renamed"));
    setEditing(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-3">
          {tags.length > 8 ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filter")} aria-label={t("filter")} className="h-10" /> : null}
          {tags.length === 0 ? <p className="text-[14px] text-muted">{t("none")}</p> : null}
          <ul className="flex max-h-[55vh] flex-col overflow-y-auto" data-testid="tags-list">
            {shown.map((tag) => (
              <li key={tag.id} className="flex flex-col gap-2 border-b border-line-soft py-2.5 last:border-0">
                {editing?.id === tag.id ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={60} autoFocus aria-label={t("newName")} className="h-9 flex-1" data-testid="tag-name" />
                    <Button type="submit" size="sm" disabled={!editing.name.trim()}>
                      {tc("save")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {tc("cancel")}
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px]">#{tag.name}</span>
                    <span className="shrink-0 text-[13px] tabular-nums text-muted">{t("uses", { count: tag.count })}</span>
                    {!readOnly ? (
                      <span className="flex shrink-0 items-center">
                        <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ id: tag.id, name: tag.name })} aria-label={t("rename", { name: tag.name })} data-testid="tag-rename">
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setMerging(merging === tag.id ? null : tag.id)} aria-label={t("merge", { name: tag.name })} disabled={tags.length < 2}>
                          <Combine size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className={confirm === tag.id ? "text-overdue" : undefined}
                          onClick={async () => {
                            if (tag.count && confirm !== tag.id) {
                              setConfirm(tag.id);
                              return;
                            }
                            await runAction(deleteTagAction(tag.id), { success: t("deleted", { name: tag.name }) });
                            setConfirm(null);
                          }}
                          aria-label={t("delete", { name: tag.name })}
                          data-testid="tag-delete"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </span>
                    ) : null}
                  </div>
                )}
                {confirm === tag.id ? <p className="text-[13px] text-overdue">{t("confirmDelete", { count: tag.count })}</p> : null}
                {merging === tag.id ? (
                  <label className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className="text-muted">{t("mergeInto")}</span>
                    <Select
                      defaultValue=""
                      onChange={async (e) => {
                        const into = tags.find((x) => x.id === e.target.value);
                        if (!into) return;
                        await runAction(mergeTagsAction(tag.id, into.id), { success: t("mergedInto", { name: into.name }) });
                        setMerging(null);
                      }}
                      className="h-9 w-[200px] text-[14px]"
                      data-testid="tag-merge"
                    >
                      <option value="" disabled>
                        {t("pick")}
                      </option>
                      {tags
                        .filter((x) => x.id !== tag.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            #{x.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const KIND_ORDER = ["note", "meeting", "report", "task_set"] as const;

/** Şablonlar: hers can be renamed or deleted; the built-in ones stay. */
export function TemplatesDialog({ open, onOpenChange, templates, readOnly }: { open: boolean; onOpenChange: (v: boolean) => void; templates: SettingsData["templates"]; readOnly: boolean }) {
  const t = useTranslations("settings.lists.templates");
  const tc = useTranslations("common");
  const trash = useTrash();
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")}>
        <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto">
          {KIND_ORDER.map((kind) => {
            const list = templates.filter((x) => x.kind === kind);
            if (!list.length) return null;
            return (
              <section key={kind} className="flex flex-col gap-1">
                <h3 className="label-caps">{t(`kinds.${kind}`)}</h3>
                <ul className="flex flex-col">
                  {list.map((tpl) => (
                    <li key={tpl.id} className="border-b border-line-soft py-2.5 last:border-0">
                      {editing?.id === tpl.id ? (
                        <form
                          className="flex flex-col gap-2"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const res = await runAction(renameTemplateAction(tpl.id, { name: editing.name, description: editing.description }), { success: t("saved") });
                            if (res !== undefined) setEditing(null);
                          }}
                        >
                          <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} autoFocus aria-label={t("name")} className="h-9" />
                          <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={400} placeholder={t("about")} aria-label={t("about")} className="h-9 text-[14px]" />
                          <span className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                              {tc("cancel")}
                            </Button>
                            <Button type="submit" size="sm" disabled={!editing.name.trim()}>
                              {tc("save")}
                            </Button>
                          </span>
                        </form>
                      ) : (
                        <div className="flex items-start gap-2">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-[15px]">{tpl.name}</span>
                            {tpl.description ? <span className="text-[13px] text-muted">{tpl.description}</span> : null}
                          </span>
                          {tpl.builtin ? (
                            <Badge variant="outline" size="sm">
                              {t("builtin")}
                            </Badge>
                          ) : !readOnly ? (
                            <span className="flex shrink-0 items-center">
                              <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ id: tpl.id, name: tpl.name, description: tpl.description ?? "" })} aria-label={t("rename", { name: tpl.name })}>
                                <Pencil size={14} />
                              </Button>
                              <Button variant="ghost" size="icon-sm" onClick={() => trash("template", tpl.id, { title: tpl.name })} aria-label={t("delete", { name: tpl.name })}>
                                <Trash2 size={15} />
                              </Button>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-[13px] text-muted">{t("howToAdd")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
