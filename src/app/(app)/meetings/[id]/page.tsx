import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HistoryList } from "@/components/common/history-list";
import { MeetingPage } from "@/components/meetings/meeting-page";
import { getMeeting } from "@/server/services/meetings";
import { loadMeetingPage } from "@/server/views/meeting-page";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("meetings");
  const m = UUID.test(id) ? await getMeeting(id) : null;
  return { title: m?.title ?? t("title") };
}

export default async function MeetingRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadMeetingPage(id);
  if (!data) notFound();
  return <MeetingPage key={id} data={data} history={<HistoryList type="meeting" id={id} limit={15} />} />;
}
