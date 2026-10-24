import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { addDaysStr, daysBetween } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { tasks, templates } from "@/server/db/schema";
import { logActivity } from "./activity";

/**
 * Templates for pages, meetings, reports and task sets. Built-in ones live
 * in code (so they improve with updates); hers live in the database.
 */

export type TemplateKind = "note" | "meeting" | "report" | "task_set";

/** The day a task set is dated from: tasks sit so many days before or after it. */
export const TASK_SET_ANCHORS = ["deadline", "start", "visit", "meeting", "period_end"] as const;
export type TaskSetAnchor = (typeof TASK_SET_ANCHORS)[number];

export type TaskSetItem = { title: string; offsetDays: number | null; priority?: number; ownerName?: string | null; notes?: string | null };

export type TemplateContent = {
  /** note: Markdown body. */
  markdown?: string;
  /** meeting: agenda items, and optional notes skeleton. */
  agenda?: string[];
  /** report: sections with guidance and word limits. */
  sections?: { heading: string; guidance?: string; wordLimit?: number | null }[];
  /** task_set: tasks with day offsets from one date (Asana and Todoist templates); null leaves a task undated. */
  tasks?: TaskSetItem[];
  anchor?: TaskSetAnchor;
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
    id: B("quarterly-report-tasks"),
    kind: "task_set",
    name: "Çeyrek raporu",
    description: "Donör raporunun teslim tarihinden geriye doğru dizilen işler.",
    builtin: true,
    content: {
      anchor: "deadline",
      tasks: [
        { title: "Ortaklardan çeyrek verilerini ve raporlarını iste", offsetDays: -21, priority: 2 },
        { title: "Ortak verilerini kontrol et, IPTT'ye gir", offsetDays: -14, priority: 2 },
        { title: "Rapor taslağını yaz", offsetDays: -10, priority: 2 },
        { title: "Grafikleri ve tek sayfalık özeti hazırla", offsetDays: -7, priority: 3 },
        { title: "Taslağı iç gözden geçirmeye gönder", offsetDays: -5, priority: 2 },
        { title: "Yorumları işle, sayıları son kez IPTT ile karşılaştır", offsetDays: -2, priority: 1 },
        { title: "Raporu donöre gönder", offsetDays: 0, priority: 1 },
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
      anchor: "period_end",
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
      anchor: "visit",
      tasks: [
        { title: "Ziyaret planını ortakla paylaş", offsetDays: -10 },
        { title: "Ulaşım ve konaklama", offsetDays: -7 },
        { title: "Güvenlik ve koruma kontrol listesi", offsetDays: -3 },
        { title: "Ziyaret notunu yaz", offsetDays: 1 },
        { title: "Takip işlerini paylaş", offsetDays: 3 },
      ],
    },
  },
  {
    id: B("steering-prep"),
    kind: "task_set",
    name: "Yönlendirme komitesi",
    description: "Toplantıdan önce ve sonra yapılacaklar.",
    builtin: true,
    content: {
      anchor: "meeting",
      tasks: [
        { title: "Tarihi ve katılımcıları netleştir, daveti gönder", offsetDays: -21, priority: 2 },
        { title: "Gündem taslağını ortaklarla paylaş", offsetDays: -10 },
        { title: "İlerleme ve gösterge özetini hazırla", offsetDays: -5, priority: 2 },
        { title: "Sunumu son haline getir", offsetDays: -2, priority: 2 },
        { title: "Toplantı notlarını ve kararları paylaş", offsetDays: 2, priority: 2 },
        { title: "Kararlar için takip görevlerini aç", offsetDays: 5 },
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

/* --------------------------------- Task sets --------------------------------- */

export type TaskSetPreviewItem = { index: number; title: string; offsetDays: number | null; date: string | null; moved: boolean; priority: number; notes: string | null };

/**
 * The tasks of a set dated from the day she picks. A date that falls on a
 * weekend or holiday moves to a working day: earlier for work before the
 * day, later for follow-ups after it, so nothing lands after a deadline.
 */
export async function previewTaskSet(templateId: string, anchorDay: string) {
  const tpl = await getTemplateItem(templateId);
  if (!tpl || tpl.kind !== "task_set" || !tpl.content.tasks?.length) return null;
  const { ensureHolidays, nextWorkingDay, previousWorkingDay } = await import("./workplan");
  await ensureHolidays();
  const items: TaskSetPreviewItem[] = [];
  for (const [index, t] of tpl.content.tasks.entries()) {
    let date: string | null = null;
    let moved = false;
    if (t.offsetDays !== null && t.offsetDays !== undefined) {
      const raw = addDaysStr(anchorDay, t.offsetDays);
      date = t.offsetDays > 0 ? await nextWorkingDay(raw) : await previousWorkingDay(raw);
      moved = date !== raw;
    }
    items.push({ index, title: t.title, offsetDays: t.offsetDays ?? null, date, moved, priority: t.priority ?? 4, notes: t.notes ?? null });
  }
  return { id: tpl.id, name: tpl.name, anchor: tpl.content.anchor ?? "deadline", items };
}

/** Apply a task set: the tasks she kept, dated from her day and linked to a partner if she chose one. */
export async function applyTaskSet(templateId: string, anchorDay: string, opts: { orgId?: string | null; skip?: number[] } = {}) {
  const preview = await previewTaskSet(templateId, anchorDay);
  if (!preview) return [];
  const { createTask } = await import("./tasks");
  const skip = new Set(opts.skip ?? []);
  const ids: string[] = [];
  for (const item of preview.items) {
    if (skip.has(item.index)) continue;
    const task = await createTask({
      title: item.title,
      dueDate: item.date,
      priority: item.priority,
      notes: item.notes,
      orgIds: opts.orgId ? [opts.orgId] : undefined,
      templateId: templateId.startsWith("builtin:") ? null : templateId,
    });
    ids.push(task.id);
  }
  return ids;
}

/**
 * Selected tasks as a set of her own: dates become days before (or after)
 * the latest date among them, so the set can be dated again next time.
 */
export async function taskSetFromTasks(taskIds: string[], input: { name: string; description?: string | null; anchor: TaskSetAnchor }) {
  const db = await getDb();
  const rows = await db.select().from(tasks).where(and(inArray(tasks.id, taskIds), isNull(tasks.deletedAt)));
  if (!rows.length) return null;
  const order = new Map(taskIds.map((id, i) => [id, i]));
  const dated = rows.filter((r) => r.dueDate);
  const anchorDay = dated.map((r) => r.dueDate!).sort().at(-1) ?? null;
  const items: TaskSetItem[] = rows
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (order.get(a.id)! - order.get(b.id)!))
    .map((r) => ({
      title: r.title,
      offsetDays: anchorDay && r.dueDate ? daysBetween(anchorDay, r.dueDate) : null,
      priority: r.priority,
      notes: r.notes,
    }));
  return saveTemplate({ kind: "task_set", name: input.name, description: input.description ?? null, content: { anchor: input.anchor, tasks: items } });
}
