import { getTranslations } from "next-intl/server";
import { AskScreen } from "@/components/search/ask-screen";
import { loadAskPage } from "@/server/views/search";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("search.ask");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AskRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadAskPage(await searchParams);
  return <AskScreen key={data.thread?.id ?? `new:${data.q}`} data={data} />;
}
