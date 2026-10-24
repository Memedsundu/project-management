import { getTranslations } from "next-intl/server";
import { MeetingsScreen } from "@/components/meetings/meetings-screen";
import { loadMeetingsScreen } from "@/server/views/meetings";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("meetings");
  return { title: t("title") };
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MeetingsRoute({ searchParams }: { searchParams: SP }) {
  const data = await loadMeetingsScreen(await searchParams);
  return <MeetingsScreen key={`${data.tab}:${data.org ?? ""}:${data.newMeeting ? "new" : ""}`} data={data} />;
}
