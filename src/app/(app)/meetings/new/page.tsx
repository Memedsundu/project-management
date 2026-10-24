import { redirect } from "next/navigation";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** "Yeni toplantı" from the command menu or another record: the list with the form open. */
export default async function NewMeetingRoute({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ new: "1" });
  for (const key of ["day", "org", "title", "link"]) {
    const v = sp[key];
    if (typeof v === "string" && v) q.set(key, v);
  }
  redirect(`/meetings?${q}`);
}
