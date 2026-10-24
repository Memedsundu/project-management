import { getTranslations } from "next-intl/server";
import { LogframeScreen } from "@/components/indicators/logframe-screen";
import { loadLogframe } from "@/server/views/indicators";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("indicators.logframe");
  return { title: t("title") };
}

export default async function LogframeRoute() {
  const data = await loadLogframe();
  return <LogframeScreen data={data} />;
}
