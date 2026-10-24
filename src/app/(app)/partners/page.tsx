import { getTranslations } from "next-intl/server";
import { PartnersScreen } from "@/components/partners/partners-screen";
import { loadPartnersScreen } from "@/server/views/partners";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("partners");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function PartnersRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadPartnersScreen(await searchParams);
  return <PartnersScreen key={`${data.tab}:${data.newOrg ?? ""}`} data={data} />;
}
