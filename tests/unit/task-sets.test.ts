import { beforeAll, describe, expect, it, vi } from "vitest";

// Search and activity are side effects here; the rules under test are about the dates.
vi.mock("@/server/search/index-service", () => ({ unindexRecord: vi.fn(async () => {}), indexRecord: vi.fn(async () => {}) }));
vi.mock("@/server/services/reindex", () => ({ reindexEntity: vi.fn(async () => {}) }));
vi.mock("@/server/services/activity", () => ({ logActivity: vi.fn(async () => {}) }));

process.env.DATABASE_URL = "memory://";

const { getDb } = await import("@/server/db/client");
const { applyTaskSet, getTemplateItem, previewTaskSet, taskSetFromTasks } = await import("@/server/services/templates");
const { createTask, getTask } = await import("@/server/services/tasks");
const { createOrganisation } = await import("@/server/services/partners");
const { linkedIds } = await import("@/server/services/links");

const QUARTERLY = "builtin:quarterly-report-tasks";
const STEERING = "builtin:steering-prep";

beforeAll(async () => {
  await getDb();
});

describe("previewTaskSet", () => {
  it("dates each task back from the deadline and moves a weekend to the Friday before", async () => {
    // 30 November 2026 is a Monday; two days before it is a Saturday.
    const p = (await previewTaskSet(QUARTERLY, "2026-11-30"))!;
    expect(p.anchor).toBe("deadline");
    expect(p.items.map((i) => [i.offsetDays, i.date, i.moved])).toEqual([
      [-21, "2026-11-09", false],
      [-14, "2026-11-16", false],
      [-10, "2026-11-20", false],
      [-7, "2026-11-23", false],
      [-5, "2026-11-25", false],
      [-2, "2026-11-27", true],
      [0, "2026-11-30", false],
    ]);
  });

  it("moves follow-ups after the day forward, and work before it back past a holiday", async () => {
    // Steering committee on Saturday 31 October 2026: 29 October is Republic Day.
    const p = (await previewTaskSet(STEERING, "2026-10-31"))!;
    expect(p.items.map((i) => [i.offsetDays, i.date, i.moved])).toEqual([
      [-21, "2026-10-09", true],
      [-10, "2026-10-21", false],
      [-5, "2026-10-26", false],
      [-2, "2026-10-28", true],
      [2, "2026-11-02", false],
      [5, "2026-11-05", false],
    ]);
  });

  it("returns nothing for a template that is not a task set", async () => {
    expect(await previewTaskSet("builtin:field-visit", "2026-11-30")).toBeNull();
    expect(await previewTaskSet("builtin:missing", "2026-11-30")).toBeNull();
  });
});

describe("applyTaskSet", () => {
  it("creates the tasks she kept, dated and linked to the partner she chose", async () => {
    const org = await createOrganisation({ name: "Kırsal Çocuk Derneği", shortName: "KÇD" });
    const ids = await applyTaskSet(QUARTERLY, "2026-11-30", { orgId: org.id, skip: [3, 4] });
    expect(ids).toHaveLength(5);
    const made = await Promise.all(ids.map((id) => getTask(id)));
    expect(made.map((t) => t?.dueDate)).toEqual(["2026-11-09", "2026-11-16", "2026-11-20", "2026-11-27", "2026-11-30"]);
    expect(made[0]?.title).toBe("Ortaklardan çeyrek verilerini ve raporlarını iste");
    expect(made.at(-1)?.priority).toBe(1);
    // A built-in set is not a database row, so the tasks keep no template id.
    expect(made.every((t) => t?.templateId === null)).toBe(true);
    for (const id of ids) expect(await linkedIds({ type: "task", id }, "organisation", "partner")).toEqual([org.id]);
  });
});

describe("taskSetFromTasks", () => {
  it("keeps each date as days before the latest one, undated tasks last", async () => {
    const a = await createTask({ title: "Veriyi iste", dueDate: "2026-11-10", priority: 2 });
    const b = await createTask({ title: "Raporu gönder", dueDate: "2026-11-20" });
    const c = await createTask({ title: "Arşive koy" });
    const row = (await taskSetFromTasks([c.id, b.id, a.id], { name: "Benim setim", anchor: "deadline" }))!;
    const tpl = (await getTemplateItem(row.id))!;
    expect(tpl.kind).toBe("task_set");
    expect(tpl.content.anchor).toBe("deadline");
    expect(tpl.content.tasks?.map((t) => [t.title, t.offsetDays, t.priority])).toEqual([
      ["Veriyi iste", -10, 2],
      ["Raporu gönder", 0, 4],
      ["Arşive koy", null, 4],
    ]);

    // Applied again to another deadline, the same spacing comes back.
    const p = (await previewTaskSet(row.id, "2027-02-26"))!;
    expect(p.items.map((i) => i.date)).toEqual(["2027-02-16", "2027-02-26", null]);
    const ids = await applyTaskSet(row.id, "2027-02-26");
    expect((await getTask(ids[0]!))?.templateId).toBe(row.id);
  });

  it("saves nothing when none of the tasks exist", async () => {
    expect(await taskSetFromTasks(["00000000-0000-4000-8000-000000000000"], { name: "Boş", anchor: "deadline" })).toBeNull();
  });
});
