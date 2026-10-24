"use client";

import { FilePlus2, LayoutTemplate, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { createPageAction } from "@/app/(app)/notes/actions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlay";
import { runAction } from "@/lib/client/run-action";

export type TemplateOption = { id: string; name: string; description: string | null; builtin: boolean };

/** "Yeni sayfa": blank, or from one of the page templates (Notion template picker). */
export function NewPageMenu({
  templates,
  parentId,
  trigger,
  onCreated,
}: {
  templates: TemplateOption[];
  parentId: string | null;
  trigger: React.ReactNode;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("notes.newPage");
  const create = async (templateId: string | null, title = "") => {
    const res = await runAction(createPageAction({ parentId, templateId, title }));
    if (res) onCreated(res.id);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px]">
        <DropdownMenuItem onSelect={() => create(null)}>
          <FilePlus2 size={15} />
          {t("blank")}
        </DropdownMenuItem>
        {templates.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("fromTemplate")}</DropdownMenuLabel>
            {templates.map((tpl) => (
              <DropdownMenuItem key={tpl.id} onSelect={() => create(tpl.id, tpl.name)} className="items-start py-2">
                <LayoutTemplate size={15} className="mt-0.5" />
                <span className="flex min-w-0 flex-col">
                  <span>{tpl.name}</span>
                  {tpl.description ? <span className="line-clamp-2 text-[12px] text-muted">{tpl.description}</span> : null}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem href="/settings#lists">
          <Settings2 size={15} />
          {t("manage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
