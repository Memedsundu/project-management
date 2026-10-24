import { getLocale, getTranslations } from "next-intl/server";
import { WorkplanScreen } from "@/components/workplan/workplan-screen";
import { loadWorkplan } from "@/server/views/workplan";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("workplan");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function WorkplanRoute({ searchParams }: { searchParams: SP }) {
  const locale = (await getLocale()) === "en" ? "en" : "tr";
  const data = await loadWorkplan(await searchParams, locale);
  return <WorkplanScreen data={data} />;
}
