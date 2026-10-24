"use client";

import { Hash, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { allTagsAction, setTagsAction } from "@/app/actions/common";
import { runAction } from "@/lib/client/run-action";
import { cn, slugify } from "@/lib/utils";
import type { EntityType } from "@/server/entities";

/** Tags as small chips; type to add, Enter or comma to confirm. */
export function TagEditor({
  self,
  initial,
  readOnly,
}: {
  self: { type: EntityType; id: string };
  initial: { name: string; slug: string }[];
  readOnly?: boolean;
}) {
  const t = useTranslations("common");
  const [tags, setTags] = useState(initial);
  const [text, setText] = useState("");
  const [all, setAll] = useState<{ name: string; slug: string }[]>([]);
  const [focus, setFocus] = useState(false);

  const initialKey = initial.map((x) => x.slug).join(",");
  const [seenKey, setSeenKey] = useState(initialKey);
  if (seenKey !== initialKey) {
    setSeenKey(initialKey);
    setTags(initial);
  }
  useEffect(() => {
    if (!focus || all.length) return;
    runAction(allTagsAction(), { silent: true }).then((r) => r && setAll(r));
  }, [focus, all.length]);

  const save = async (next: { name: string; slug: string }[]) => {
    setTags(next);
    await runAction(setTagsAction(self, next.map((x) => x.name)), { silent: false });
  };
  const add = (name: string) => {
    const clean = name.replace(/^#/, "").trim();
    if (!clean) return;
    const slug = slugify(clean);
    if (tags.some((x) => x.slug === slug)) return;
    void save([...tags, { name: clean, slug }]);
    setText("");
  };
  const suggestions = text
    ? all.filter((x) => x.slug.includes(slugify(text)) && !tags.some((y) => y.slug === x.slug)).slice(0, 6)
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span key={tag.slug} className="inline-flex h-7 items-center gap-1 rounded-full bg-panel-2 pl-2.5 pr-1 text-[13px]">
            <Hash size={12} className="text-muted" />
            {tag.name}
            {!readOnly ? (
              <button
                type="button"
                aria-label={t("removeTag", { tag: tag.name })}
                onClick={() => save(tags.filter((x) => x.slug !== tag.slug))}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink"
              >
                <X size={12} />
              </button>
            ) : null}
          </span>
        ))}
        {!readOnly ? (
          <input
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              if (v.endsWith(",")) add(v.slice(0, -1));
              else setText(v);
            }}
            onFocus={() => setFocus(true)}
            onBlur={() => window.setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
              } else if (e.key === "Backspace" && !text && tags.length) {
                void save(tags.slice(0, -1));
              }
            }}
            placeholder={tags.length ? "" : t("addTag")}
            aria-label={t("addTag")}
            className="h-7 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        ) : null}
      </div>
      {focus && suggestions.length ? (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s.slug}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s.name)}
              className={cn("h-7 rounded-full border border-line-strong px-2.5 text-[12px] hover:border-ink")}
            >
              #{s.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
