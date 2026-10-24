import { getTranslations } from "next-intl/server";
import { PairForm } from "./pair-form";

export async function generateMetadata() {
  const t = await getTranslations("auth");
  return { title: t("addThisDevice") };
}

export default function PairPage() {
  return <PairForm />;
}
