import { getLocale } from "next-intl/server";
import { dayOf, todayStr } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { buildXlsx, xlsxResponse } from "@/server/export/xlsx";
import { listLogbook } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

/** Tamamlananlar as an Excel file, one month at a time. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month")! : todayStr().slice(0, 7);
  const en = (await getLocale()) === "en";
  const items = await listLogbook({ month, limit: 2000 });
  const buf = await buildXlsx(
    [
      {
        name: month,
        columns: [
          { header: en ? "Completed" : "Tamamlandı", key: "done", width: 14 },
          { header: en ? "Task" : "Görev", key: "title", width: 60 },
          { header: en ? "Owner" : "Sorumlu", key: "owner", width: 22 },
          { header: en ? "Due" : "Son tarih", key: "due", width: 14 },
          { header: en ? "Tags" : "Etiketler", key: "tags", width: 24 },
          { header: en ? "Notes" : "Notlar", key: "notes", width: 50 },
        ],
        rows: items.map((t) => ({
          done: t.completedAt ? dayOf(t.completedAt) : "",
          title: t.title,
          owner: t.ownerKind === "me" ? (en ? "Me" : "Ben") : (t.ownerLabel ?? ""),
          due: t.dueDate ?? "",
          tags: t.tags.map((x) => `#${x.name}`).join(" "),
          notes: t.notes ?? "",
        })),
      },
    ],
    { title: en ? `Completed tasks ${month}` : `Tamamlanan görevler ${month}` },
  );
  return xlsxResponse(buf, `${en ? "completed-tasks" : "tamamlanan-gorevler"}-${month}.xlsx`);
}
