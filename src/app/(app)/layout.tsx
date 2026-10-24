import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { getSetting } from "@/server/services/settings";
import { getShellData } from "@/server/services/shell";

export const dynamic = "force-dynamic";

/** Page titles and the home-screen name follow the app name in Ayarlar. */
export async function generateMetadata(): Promise<Metadata> {
  const { appName } = await getSetting("profile");
  return {
    title: { default: appName, template: `%s · ${appName}` },
    applicationName: appName,
    appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
  };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const data = await getShellData();
  return <AppShell data={data}>{children}</AppShell>;
}
