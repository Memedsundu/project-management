import { getTranslations } from "next-intl/server";
import { PartnersScreen } from "@/components/partners/partners-screen";
import { loadPartnersScreen } from "@/server/views/partners";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("partners");
  return { title: t("tabs.contacts") };
}

/** "Kişiler": every work contact, also the target of contact links without an organisation. */
export default async function ContactsRoute() {
  const data = await loadPartnersScreen({ tab: "contacts" });
  return <PartnersScreen key="contacts" data={data} />;
}
