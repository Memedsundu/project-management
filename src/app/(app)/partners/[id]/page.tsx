import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/components/common/history-list";
import { PartnerPage } from "@/components/partners/partner-page";
import { getOrganisation } from "@/server/services/partners";
import { loadPartnerPage } from "@/server/views/partners";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("partners");
  const o = UUID.test(id) ? await getOrganisation(id) : null;
  return { title: o ? o.shortName || o.name : t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PartnerRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadPartnerPage(id, await searchParams);
  if (!data) notFound();
  return <PartnerPage key={id} data={data} history={<HistoryList type="organisation" id={id} limit={12} />} />;
}
