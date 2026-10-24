import { getTranslations } from "next-intl/server";
import { CheckScreen } from "@/components/files/check-screen";
import { loadCheckScreen } from "@/server/views/files";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("files.check");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CheckRoute({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const data = await loadCheckScreen();
  return <CheckScreen data={data} tab={sp.tab === "flagged" ? "flagged" : "suggestions"} />;
}
