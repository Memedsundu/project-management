import { getTranslations } from "next-intl/server";
import { IndicatorsScreen } from "@/components/indicators/indicators-screen";
import { loadIndicators } from "@/server/views/indicators";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("indicators");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function IndicatorsRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadIndicators(await searchParams);
  return <IndicatorsScreen data={data} />;
}
