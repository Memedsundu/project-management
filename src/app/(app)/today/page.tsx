import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/card";

export default async function TodayPage() {
  const t = await getTranslations("nav");
  return <PageHeader title={t("today")} />;
}
