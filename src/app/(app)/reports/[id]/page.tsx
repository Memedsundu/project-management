import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ReportPage } from "@/components/reports/report-page";
import { getReport } from "@/server/services/reports";
import { loadReport } from "@/server/views/reports";

export const dynamic = "force-dynamic";
// Drafting a long section with Opus can take a few minutes.
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("reports");
  const r = UUID.test(id) ? await getReport(id) : null;
  return { title: r && !r.deletedAt ? r.title : t("title") };
}

export default async function ReportRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await loadReport(id);
  if (!data) notFound();
  return <ReportPage key={id} data={data} />;
}
