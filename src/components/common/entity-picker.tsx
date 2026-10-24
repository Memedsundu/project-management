"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { searchEntitiesAction } from "@/app/actions/common";
import { inputClass } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";
import { cn } from "@/lib/utils";
import type { EntityType } from "@/server/entities";
import { EntityIcon } from "./entity-icon";
import { Highlight } from "./highlight";

export type PickedEntity = { type: EntityType; id: string; title: string; href: string };

/** Search any record and pick it: used for links, collections, owners and @mentions. */
export function EntityPicker({
  trigger,
  types,
  onPick,
  exclude = [],
  placeholder,
  align = "start",
  keepOpen,
}: {
  trigger: React.ReactNode;
  types?: EntityType[];
  onPick: (item: PickedEntity) => void;
  exclude?: string[];
  placeholder?: string;
  align?: "start" | "end";
  /** Stay open to pick several (adding sources to a collection). */
  keepOpen?: boolean;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-[min(420px,calc(100vw-24px))] p-2">
        {open ? (
          <PickerBody
            types={types}
            exclude={exclude}
            placeholder={placeholder ?? t("searchToLink")}
            onPick={(item) => {
              onPick(item);
              if (!keepOpen) setOpen(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function PickerBody({
  types,
  exclude = [],
  placeholder,
  onPick,
  autoFocus = true,
}: {
  types?: EntityType[];
  exclude?: string[];
  placeholder?: string;
  onPick: (item: PickedEntity) => void;
  autoFocus?: boolean;
}) {
  const tk = useTranslations("common.kinds");
  const t = useTranslations("common");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickedEntity[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const typesKey = (types ?? []).join(",");

  useEffect(() => {
    const n = ++seq.current;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const res = await runAction(searchEntitiesAction(q, types), { silent: true });
      if (n !== seq.current) return;
      setLoading(false);
      setItems((res ?? []).filter((r) => !exclude.includes(`${r.type}:${r.id}`)) as PickedEntity[]);
      setActive(0);
    }, 140);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, typesKey]);

  // A picked item leaves the list, so the picker can stay open for the next one.
  const pick = (item: PickedEntity) => {
    onPick(item);
    setItems((list) => list.filter((x) => !(x.type === item.type && x.id === item.id)));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              pick(items[active]!);
            }
          }}
          placeholder={placeholder}
          className={cn(inputClass, "h-10 pl-9")}
          aria-label={placeholder}
        />
      </div>
      <ul className="scrollbar-thin max-h-72 overflow-y-auto" role="listbox">
        {items.map((item, i) => (
          <li key={`${item.type}:${item.id}`} role="option" aria-selected={i === active}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(item)}
              className={cn(
                "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px]",
                i === active ? "bg-panel" : "",
              )}
            >
              <EntityIcon type={item.type} className="text-muted" />
              <span className="min-w-0 flex-1 truncate">
                <Highlight text={item.title} query={q} />
              </span>
              <span className="text-[12px] text-faint">{tk(item.type as "task")}</span>
            </button>
          </li>
        ))}
        {!loading && items.length === 0 ? <li className="px-2.5 py-3 text-[14px] text-muted">{t("noResults")}</li> : null}
      </ul>
    </div>
  );
}
