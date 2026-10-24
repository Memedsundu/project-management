import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflineScreen } from "@/components/shell/offline-screen";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.offline");
  return { title: t("pageTitle") };
}

/**
 * Shown by the service worker when there is no connection and the page
 * was never opened before. Public, so it can be saved while installing.
 */
export default function OfflinePage() {
  return <OfflineScreen />;
}
