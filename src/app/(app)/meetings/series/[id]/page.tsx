import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SeriesScreen } from "@/components/meetings/series-screen";
import { loadSeriesPage } from "@/server/views/meetings";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("meetings");
  const data = UUID.test(id) ? await loadSeriesPage(id) : null;
  return { title: data?.series.title ?? t("title") };
}

export default async function SeriesRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadSeriesPage(id);
  if (!data) notFound();
  return <SeriesScreen key={id} data={data} />;
}
