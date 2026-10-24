import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasAnyUser } from "@/server/auth/session";
import { setupTokenRequired } from "@/server/auth/webauthn";
import { SetupForm } from "./setup-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("setupTitle") };
}

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/sign-in");
  const needsToken = setupTokenRequired();
  const tokenMissing = needsToken && !process.env.SETUP_TOKEN;
  return <SetupForm needsToken={needsToken} tokenMissing={tokenMissing} />;
}
