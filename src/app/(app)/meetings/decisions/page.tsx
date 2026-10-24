import { getTranslations } from "next-intl/server";
import { DecisionsScreen } from "@/components/meetings/decisions-screen";
import { loadDecisionsScreen } from "@/server/views/meetings";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("meetings.decisionsLog");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function DecisionsRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadDecisionsScreen(await searchParams);
  return <DecisionsScreen key={`${data.org ?? ""}:${data.q ?? ""}`} data={data} />;
}
