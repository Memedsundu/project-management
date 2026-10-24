import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, hasAnyUser } from "@/server/auth/session";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function SignInPage() {
  if (!(await hasAnyUser())) redirect("/setup");
  if (await getCurrentUser()) redirect("/today");
  return <SignInForm />;
}
