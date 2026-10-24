import { getTranslations } from "next-intl/server";
import { CollectionsScreen } from "@/components/collections/collections-screen";
import { loadCollections } from "@/server/views/collections";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("collections");
  return { title: t("title") };
}

export default async function CollectionsRoute() {
  const data = await loadCollections();
  return <CollectionsScreen data={data} />;
}
