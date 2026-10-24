import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import type { EntityType } from "@/server/entities";
import { listActivity } from "@/server/services/activity";

/** "Geçmiş": what changed on a record, and whether she or Claude proposed it. */
export async function HistoryList({ type, id, limit = 12 }: { type: EntityType; id: string; limit?: number }) {
  const t = await getTranslations("common");
  const ta = await getTranslations("common.actions");
  const locale = await getLocale();
  const rows = await listActivity({ entityType: type, entityId: id, limit });
  return (
    <section className="flex flex-col gap-2" aria-label={t("history")}>
      <h3 className="label-caps">{t("history")}</h3>
      {rows.length === 0 ? (
        <p className="text-[14px] text-muted">{t("noHistory")}</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line-soft py-1.5 text-[13px] last:border-0">
              <span className="text-faint">{formatDateTime(r.at, locale)}</span>
              <span>{ta.has(r.action as "create") ? ta(r.action as "create") : r.action}</span>
              {r.summary ? <span className="text-muted">· {r.summary}</span> : null}
              {r.actor === "ai" ? (
                <Badge variant="ai" size="sm">
                  {t("aiBadge")}
                </Badge>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
