import { redirect } from "next/navigation";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** "Yeni kurum" from the command menu: the list with the form open. */
export default async function NewOrganisationRoute({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  redirect(sp.kind === "stakeholder" ? "/partners?tab=stakeholders&new=stakeholder" : "/partners?new=1");
}
