import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TrashScreen } from "@/components/trash/trash-screen";
import { requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/services/settings";
import { daysLeft, listTrash } from "@/server/services/trash";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trash");
  return { title: t("title") };
}

export default async function TrashPage() {
  await requireUser();
  const [items, archive] = await Promise.all([listTrash(), getSetting("archive")]);
  const now = new Date();
  return (
    <TrashScreen
      readOnly={archive.readOnly}
      items={items.map((i) => ({ type: i.type, id: i.id, title: i.title, href: i.href, deletedAt: i.deletedAt.toISOString(), daysLeft: daysLeft(i.deletedAt, now), inside: i.inside }))}
    />
  );
}
