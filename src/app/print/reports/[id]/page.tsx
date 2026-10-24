import { notFound } from "next/navigation";
import { formatDay } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { markdownToSafeHtml } from "@/server/export/html";
import { CITE_TOKEN, exportWords, reportForExport } from "@/server/views/report-export";
import { PrintOnLoad } from "../../print-on-load";

export const dynamic = "force-dynamic";

/** "⟦1,3⟧" becomes superscript links to the source list at the end. */
const withCitations = (html: string) => html.replace(CITE_TOKEN, (_m, ns: string) => `<sup class="cite">${ns.split(",").map((n) => `<a href="#src-${n}">${n}</a>`).join(",")}</sup>`);

/** Print view of a report: the browser's "Save as PDF" turns this into the PDF export. */
export default async function PrintReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ clean?: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { clean } = await searchParams;
  const rep = await reportForExport(id, { clean: clean === "1" });
  if (!rep) notFound();
  const w = exportWords(rep.language);
  const locale = rep.language === "tr" ? "tr" : "en";
  const meta = [rep.periodLabel, rep.audience, rep.dueDate ? `${w.due}: ${formatDay(rep.dueDate, locale, true)}` : null, rep.status === "draft" ? w.draft : null].filter(Boolean);
  return (
    <main className="print-page print-report mx-auto max-w-[760px] px-8 py-10" lang={rep.language}>
      <h1 className="font-display text-[40px] leading-tight">{rep.title}</h1>
      {meta.length ? <p className="mt-2 text-[14px] text-muted">{meta.join(" · ")}</p> : null}
      {rep.sections.map((s, i) => (
        <section key={i} className="mt-8">
          <h2 className="text-[22px] font-semibold leading-snug">{s.heading}</h2>
          {s.content ? <div className="prose-app mt-2" dangerouslySetInnerHTML={{ __html: withCitations(markdownToSafeHtml(s.content)) }} /> : <p className="mt-2 text-[14px] italic text-faint">{w.empty}</p>}
        </section>
      ))}
      {rep.sources.length ? (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-[18px] font-semibold">{w.sources}</h2>
          <ol className="mt-3 flex flex-col gap-1 text-[13px] leading-relaxed">
            {rep.sources.map((src) => (
              <li key={src.n} id={`src-${src.n}`} className="flex gap-2">
                <span className="w-6 shrink-0 text-right text-muted">{src.n}.</span>
                <span>{src.page ? `${src.title}, ${w.page(src.page)}` : src.title}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <PrintOnLoad />
    </main>
  );
}
