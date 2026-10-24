import { getTranslations } from "next-intl/server";
import { BriefsScreen } from "@/components/briefs/briefs-screen";
import { aiStatus } from "@/server/ai/client";
import { BRIEF_KINDS, lastBriefDays, listBriefs, type BriefKind } from "@/server/services/briefs";
import { getSetting } from "@/server/services/settings";

export const dynamic = "force-dynamic";
// "Şimdi hazırla" writes with Claude from this page.
export const maxDuration = 120;

export async function generateMetadata() {
  const t = await getTranslations("briefs");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function BriefsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && (BRIEF_KINDS as readonly string[]).includes(sp.kind) ? (sp.kind as BriefKind) : null;
  const [items, helpers, last, ai] = await Promise.all([listBriefs({ kind }), getSetting("scheduledHelpers"), lastBriefDays(), aiStatus()]);
  return <BriefsScreen items={items} kind={kind} helpers={helpers} last={last} aiReady={ai.configured && ai.enabled && !ai.capReached} />;
}
