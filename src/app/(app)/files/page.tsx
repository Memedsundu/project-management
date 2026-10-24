import { getTranslations } from "next-intl/server";
import { FilesScreen } from "@/components/files/files-screen";
import { loadFilesScreen } from "@/server/views/files";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("files");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function FilesRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadFilesScreen({ folderId: null, sp: await searchParams });
  return <FilesScreen {...data!} />;
}
