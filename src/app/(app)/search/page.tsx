import { getTranslations } from "next-intl/server";
import { SearchScreen } from "@/components/search/search-screen";
import { loadSearchPage } from "@/server/views/search";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations("search");
  const q = (await searchParams).q;
  return { title: typeof q === "string" && q.trim() ? `${q.trim()} · ${t("title")}` : t("title") };
}

export default async function SearchRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadSearchPage(await searchParams);
  return <SearchScreen key={`${data.q}:${data.type ?? ""}:${data.org ?? ""}:${data.date ?? ""}:${data.owner ?? ""}`} data={data} />;
}
