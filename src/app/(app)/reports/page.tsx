import { getTranslations } from "next-intl/server";
import { ReportsScreen } from "@/components/reports/reports-screen";
import { loadReportsHome } from "@/server/views/reports";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

export default async function ReportsRoute() {
  const data = await loadReportsHome();
  return <ReportsScreen data={data} />;
}
