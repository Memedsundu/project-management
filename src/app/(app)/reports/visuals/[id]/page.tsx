import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VisualPage } from "@/components/reports/visual-page";
import { getVisual } from "@/server/services/reports";
import { loadVisual } from "@/server/views/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("reports.visuals");
  const v = UUID.test(id) ? await getVisual(id) : null;
  return { title: v && !v.deletedAt ? v.title : t("title") };
}

export default async function VisualRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadVisual(id);
  if (!data) notFound();
  return <VisualPage key={id} data={data} />;
}
