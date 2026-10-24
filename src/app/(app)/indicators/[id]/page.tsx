import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/components/common/history-list";
import { IndicatorPage } from "@/components/indicators/indicator-page";
import { getIndicator } from "@/server/services/indicators";
import { loadIndicatorPage } from "@/server/views/indicators";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("indicators");
  const i = UUID.test(id) ? await getIndicator(id) : null;
  return { title: i ? `${i.code} ${i.name}` : t("title") };
}

export default async function IndicatorRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadIndicatorPage(id);
  if (!data) notFound();
  return <IndicatorPage key={id} data={data} history={<HistoryList type="indicator" id={id} limit={12} />} />;
}
