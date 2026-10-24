import { getCurrentUser } from "@/server/auth/session";
import { createContact, createOrganisation } from "@/server/services/partners";
import { listOrganisationsLite } from "@/server/services/partners-lite";

export const dynamic = "force-dynamic";

/**
 * Three made-up partners with two contacts each, for automated browser tests.
 * Same guard as the test sign-in: 404 unless outside production with E2E_LOGIN=1.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_LOGIN !== "1") return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const existing = await listOrganisationsLite();
  if (existing.length) return Response.json({ orgs: existing });
  const partners = [
    { name: "Kır Çocukları Derneği", shortName: "KÇD", provinces: ["Adana", "Hatay"], contacts: [["Ayşe Demir", "Proje koordinatörü"], ["Murat Kaya", "Saha sorumlusu"]] },
    { name: "Mevsimlik Tarım Ağı", shortName: "MTA", provinces: ["Şanlıurfa"], contacts: [["Elif Şahin", "Program müdürü"], ["Can Aydın", "İzleme uzmanı"]] },
    { name: "Eğitim Gönüllüleri Vakfı", shortName: "EGV", provinces: ["Ankara", "Eskişehir"], contacts: [["Zeynep Arslan", "Genel koordinatör"], ["Emre Yıldız", "Finans sorumlusu"]] },
  ];
  for (const p of partners) {
    const org = await createOrganisation({ name: p.name, shortName: p.shortName, kind: "partner", provinces: p.provinces, reportingRhythm: "quarterly", reportDueDays: 20, agreementStart: "2026-01-01", agreementEnd: "2028-12-31" });
    for (const [name, role] of p.contacts) await createContact({ organisationId: org.id, name: name!, role });
  }
  return Response.json({ orgs: await listOrganisationsLite() });
}
