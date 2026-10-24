import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/shell/language-switch";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-dvh flex-col bg-bg-subtle">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="font-display text-[28px] leading-none">{t("appName")}</span>
        <LanguageSwitch />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 md:pt-16">
        <div className="w-full max-w-[460px] rounded-2xl border border-line bg-bg p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
