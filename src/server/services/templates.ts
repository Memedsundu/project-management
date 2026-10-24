import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { templates } from "@/server/db/schema";
import { logActivity } from "./activity";

/**
 * Templates for pages, meetings, reports and task sets. Built-in ones live
 * in code (so they improve with updates); hers live in the database.
 */

export type TemplateKind = "note" | "meeting" | "report" | "task_set";

export type TemplateContent = {
  /** note: Markdown body. */
  markdown?: string;
  /** meeting: agenda items, and optional notes skeleton. */
  agenda?: string[];
  /** report: sections with guidance and word limits. */
  sections?: { heading: string; guidance?: string; wordLimit?: number | null }[];
  /** task_set: tasks with day offsets from a start date (Things project templates). */
  tasks?: { title: string; offsetDays: number; ownerName?: string | null; notes?: string | null }[];
};

export type TemplateItem = { id: string; kind: TemplateKind; name: string; description: string | null; builtin: boolean; content: TemplateContent };

const B = (key: string) => `builtin:${key}`;

export const BUILTIN_TEMPLATES: TemplateItem[] = [
  {
    id: B("field-visit"),
    kind: "note",
    name: "Saha ziyareti notu",
    description: "Ziyaret, gözlemler, takip edilecekler. Çocuk adı yazma; sadece toplamlar.",
    builtin: true,
    content: {
      markdown:
        "## Ziyaret\n\n- **Tarih:** \n- **Yer (il / ilçe):** \n- **Ortak:** \n- **Katılanlar (kurum ve rol):** \n\n## Amaç\n\n\n## Gözlemler\n\n\n## Sayılar (yalnızca toplamlar)\n\n| Konu | Toplam |\n| --- | --- |\n|  |  |\n\n## Riskler ve koruma notları\n\n\n## Takip edilecekler\n\n- [ ] \n",
    },
  },
  {
    id: B("partner-call"),
    kind: "note",
    name: "Ortak görüşmesi",
    description: "Kısa ortak görüşmesi: güncelleme, sorunlar, kararlar, işler.",
    builtin: true,
    content: { markdown: "## Güncelleme\n\n\n## Sorunlar ve destek ihtiyacı\n\n\n## Kararlar\n\n- \n\n## İşler\n\n- [ ] \n" },
  },
  {
    id: B("weekly-plan"),
    kind: "note",
    name: "Haftalık plan",
    description: "Haftanın üç önceliği, toplantılar, beklenenler.",
    builtin: true,
    content: { markdown: "## Bu haftanın üç önceliği\n\n1. \n2. \n3. \n\n## Toplantılar\n\n\n## Ortaklardan beklenenler\n\n- \n\n## Notlar\n\n" },
  },
  {
    id: B("decision-record"),
    kind: "note",
    name: "Karar kaydı",
    description: "Bir kararı gerekçesi ve seçenekleriyle kaydet.",
    builtin: true,
    content: { markdown: "## Karar\n\n\n## Neden\n\n\n## Değerlendirilen seçenekler\n\n- \n\n## Kim, ne zaman\n\n\n## Etkilenen faaliyetler ve göstergeler\n\n" },
  },
  {
    id: B("risk-log"),
    kind: "note",
    name: "Risk günlüğü",
    description: "Riskler, olasılık, etki ve önlemler tablosu.",
    builtin: true,
    content: { markdown: "## Riskler\n\n| Risk | Olasılık | Etki | Önlem | Sorumlu |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n" },
  },
  {
    id: B("partner-meeting"),
    kind: "meeting",
    name: "Aylık ortak toplantısı",
    description: "İlerleme, göstergeler, bütçe, riskler, sonraki adımlar.",
    builtin: true,
    content: { agenda: ["Geçen toplantının işleri", "Faaliyet ilerlemesi", "Gösterge verileri (toplamlar)", "Bütçe ve harcama", "Riskler ve koruma", "Sonraki adımlar ve tarihler"] },
  },
  {
    id: B("steering"),
    kind: "meeting",
    name: "Yönlendirme komitesi",
    description: "Steering committee: results, decisions needed, risks.",
    builtin: true,
    content: { agenda: ["Opening and previous decisions", "Progress against the workplan", "Results and indicators", "Decisions needed", "Risks and mitigation", "AOB"] },
  },
  {
    id: B("donor-call"),
    kind: "meeting",
    name: "Donör görüşmesi",
    description: "Donor check-in: updates, changes, reporting.",
    builtin: true,
    content: { agenda: ["Programme update", "Changes and amendments", "Reporting timeline", "Questions from the donor", "Next steps"] },
  },
  {
    id: B("field-visit-meeting"),
    kind: "meeting",
    name: "Saha ziyareti",
    description: "Saha ziyareti planı ve görüşme başlıkları.",
    builtin: true,
    content: { agenda: ["Ziyaretin amacı", "Görüşülecek kurumlar", "Gözlem noktaları", "Koruma ve güvenlik kontrolleri", "Dönüş sonrası işler"] },
  },
  {
    id: B("quarterly-report"),
    kind: "report",
    name: "Quarterly narrative report",
    description: "Standard donor quarterly report.",
    builtin: true,
    content: {
      sections: [
        { heading: "Executive summary", guidance: "Key achievements and challenges this quarter in a few sentences.", wordLimit: 300 },
        { heading: "Progress against outputs", guidance: "Activity by activity, with numbers from approved indicator values.", wordLimit: 900 },
        { heading: "Results and indicators", guidance: "Indicator table and short commentary on progress against targets.", wordLimit: 500 },
        { heading: "Partner performance", guidance: "Each partner's delivery, reporting and issues.", wordLimit: 500 },
        { heading: "Challenges and mitigation", guidance: "Problems faced and what was done.", wordLimit: 400 },
        { heading: "Safeguarding and child protection", guidance: "Aggregate information only; never individual cases.", wordLimit: 250 },
        { heading: "Lessons learned", guidance: "What the team learned.", wordLimit: 300 },
        { heading: "Plans for next quarter", guidance: "Main activities and milestones ahead.", wordLimit: 300 },
      ],
    },
  },
  {
    id: B("annual-report"),
    kind: "report",
    name: "Annual report",
    description: "Year in review for the donor.",
    builtin: true,
    content: {
      sections: [
        { heading: "Summary", wordLimit: 500 },
        { heading: "Context", wordLimit: 400 },
        { heading: "Results by outcome", wordLimit: 1500 },
        { heading: "Indicator performance", wordLimit: 600 },
        { heading: "Partnership and coordination", wordLimit: 500 },
        { heading: "Sustainability", wordLimit: 400 },
        { heading: "Financial overview", wordLimit: 300 },
        { heading: "Next year", wordLimit: 400 },
      ],
    },
  },
  {
    id: B("partner-report-cycle"),
    kind: "task_set",
    name: "Ortak raporu döngüsü",
    description: "Dönem sonu ortak raporlarını toplamak için işler.",
    builtin: true,
    content: {
      tasks: [
        { title: "Ortaklara rapor hatırlatması gönder", offsetDays: -7 },
        { title: "Ortak raporlarını topla", offsetDays: 10 },
        { title: "Gösterge değerlerini kontrol et", offsetDays: 12 },
        { title: "Eksikler için ortaklara geri dönüş", offsetDays: 14 },
        { title: "Donör raporu taslağını başlat", offsetDays: 16 },
      ],
    },
  },
  {
    id: B("field-visit-prep"),
    kind: "task_set",
    name: "Saha ziyareti hazırlığı",
    description: "Ziyaret öncesi ve sonrası işler.",
    builtin: true,
    content: {
      tasks: [
        { title: "Ziyaret planını ortakla paylaş", offsetDays: -10 },
        { title: "Ulaşım ve konaklama", offsetDays: -7 },
        { title: "Güvenlik ve koruma kontrol listesi", offsetDays: -3 },
        { title: "Ziyaret notunu yaz", offsetDays: 1 },
        { title: "Takip işlerini paylaş", offsetDays: 3 },
      ],
    },
  },
];

export async function listTemplates(kind?: TemplateKind): Promise<TemplateItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(templates)
    .where(and(isNull(templates.deletedAt), kind ? eq(templates.kind, kind) : undefined))
    .orderBy(asc(templates.name));
  const mine = rows.map((r) => ({ id: r.id, kind: r.kind as TemplateKind, name: r.name, description: r.description, builtin: false, content: r.content as TemplateContent }));
  return [...mine, ...BUILTIN_TEMPLATES.filter((t) => !kind || t.kind === kind)];
}

export async function getTemplate(id: string) {
  if (id.startsWith("builtin:")) return BUILTIN_TEMPLATES.find((t) => t.id === id)?.content ?? null;
  const db = await getDb();
  const [row] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return row ? (row.content as TemplateContent) : null;
}

export async function getTemplateItem(id: string): Promise<TemplateItem | null> {
  if (id.startsWith("builtin:")) return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
  const db = await getDb();
  const [row] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return row ? { id: row.id, kind: row.kind as TemplateKind, name: row.name, description: row.description, builtin: false, content: row.content as TemplateContent } : null;
}

export async function saveTemplate(input: { id?: string; kind: TemplateKind; name: string; description?: string | null; content: TemplateContent }) {
  const db = await getDb();
  if (input.id && !input.id.startsWith("builtin:")) {
    const [row] = await db
      .update(templates)
      .set({ name: input.name, description: input.description ?? null, content: input.content, updatedAt: new Date() })
      .where(eq(templates.id, input.id))
      .returning();
    return row!;
  }
  const [row] = await db.insert(templates).values({ kind: input.kind, name: input.name, description: input.description ?? null, content: input.content }).returning();
  await logActivity({ action: "create", entityType: "template", entityId: row!.id, title: row!.name });
  return row!;
}

/** Apply a task set: every task dated from the start day she picks. */
export async function applyTaskSet(templateId: string, startDay: string, extra: { orgIds?: string[]; links?: { type: string; id: string }[] } = {}) {
  const tpl = await getTemplate(templateId);
  if (!tpl?.tasks?.length) return [];
  const { addDaysStr } = await import("@/lib/dates");
  const { createTask } = await import("./tasks");
  const ids: string[] = [];
  for (const t of tpl.tasks) {
    const task = await createTask({
      title: t.title,
      dueDate: addDaysStr(startDay, t.offsetDays),
      ownerName: t.ownerName ?? null,
      notes: t.notes ?? null,
      orgIds: extra.orgIds,
      links: extra.links,
      templateId: templateId.startsWith("builtin:") ? null : templateId,
    });
    ids.push(task.id);
  }
  return ids;
}
