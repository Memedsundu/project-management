import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FilesScreen } from "@/components/files/files-screen";
import { folderChain } from "@/server/services/documents";
import { loadFilesScreen } from "@/server/views/files";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("files");
  const chain = UUID.test(id) ? await folderChain(id) : [];
  return { title: chain.at(-1)?.name ?? t("title") };
}

export default async function FolderRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadFilesScreen({ folderId: id, sp: await searchParams });
  if (!data) notFound();
  return <FilesScreen key={id} {...data} />;
}
