import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/components/common/history-list";
import { DocumentScreen } from "@/components/files/document-screen";
import { getDocument } from "@/server/services/documents";
import { loadDocumentPage } from "@/server/views/files";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("files");
  const doc = UUID.test(id) ? await getDocument(id) : null;
  return { title: doc?.title ?? t("title") };
}

export default async function DocumentRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadDocumentPage(id, await searchParams);
  if (!data) notFound();
  return <DocumentScreen key={id} data={data} history={<HistoryList type="document" id={id} limit={15} />} />;
}
