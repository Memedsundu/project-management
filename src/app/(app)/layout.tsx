import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { getShellData } from "@/server/services/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const data = await getShellData();
  return <AppShell data={data}>{children}</AppShell>;
}
