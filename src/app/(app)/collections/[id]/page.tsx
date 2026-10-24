import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CollectionPage } from "@/components/collections/collection-page";
import { findCollection } from "@/server/services/collections";
import { loadCollectionPage } from "@/server/views/collections";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("collections");
  const c = UUID.test(id) ? await findCollection(id) : null;
  return { title: c ? c.name : t("title") };
}

export default async function CollectionRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadCollectionPage(id);
  if (!data) notFound();
  return <CollectionPage key={id} data={data} />;
}
