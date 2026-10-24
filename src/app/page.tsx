import { redirect } from "next/navigation";
import { getCurrentUser, hasAnyUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await hasAnyUser())) redirect("/setup");
  if (!(await getCurrentUser())) redirect("/sign-in");
  redirect("/today");
}
