import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BriefPage } from "@/components/briefs/brief-page";
import { getBrief } from "@/server/services/briefs";

export const dynamic = "force-dynamic";
// "Yeniden hazırla" writes with Claude from this page.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("briefs");
  const brief = UUID.test(id) ? await getBrief(id) : null;
  return { title: brief?.title ?? t("title") };
}

export default async function BriefRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const brief = await getBrief(id);
  if (!brief) notFound();
  return (
    <BriefPage
      key={brief.id}
      brief={{
        id: brief.id,
        kind: brief.kind,
        day: brief.day,
        title: brief.title,
        content: brief.content,
        read: brief.read,
        model: brief.model,
        recipe: brief.recipe,
        about: brief.about,
        createdAt: brief.createdAt,
      }}
    />
  );
}
