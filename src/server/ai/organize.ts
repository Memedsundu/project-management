import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { documents } from "@/server/db/schema";
import { PermanentJobError } from "@/server/jobs/queue";
import { getSetting } from "@/server/services/settings";
import { createSuggestion } from "@/server/services/suggestions";
import { aiJson, asMaterial } from "./client";
import { documentAiOff, folderAiOff } from "./context";

/**
 * "Bu klasörü düzenle" (Dropbox's AI organisation, Paperless matching):
 * Claude proposes sub-folders, moves and clearer names for the files in one
 * folder. Nothing moves until she ticks the changes she wants.
 */

export type OrganizeItem = {
  documentId: string;
  currentTitle: string;
  title: string | null; // new name, or null to keep
  target: { folderId: string | null } | { newFolderKey: string } | null; // null: stays
  reason: string;
};

export type OrganizePayload = {
  folderId: string | null;
  newFolders: { key: string; name: string }[];
  items: OrganizeItem[];
  duplicates: { documentIds: string[]; reason: string }[];
};

const MAX_FILES = 120;

export async function organizeFolderJob(payload: Record<string, unknown>) {
  const folderId = payload.folderId ? String(payload.folderId) : null;
  if (await folderAiOff(folderId)) throw new PermanentJobError("folder is kept away from AI");
  const db = await getDb();
  const rows = await db
    .select()
    .from(documents)
    .where(and(isNull(documents.deletedAt), folderId ? eq(documents.folderId, folderId) : isNull(documents.folderId)))
    .orderBy(asc(documents.title))
    .limit(MAX_FILES);
  const files = [];
  for (const d of rows) if (!(await documentAiOff(d))) files.push(d);
  if (files.length < 2) throw new PermanentJobError("nothing to organize");

  const { listAllFolders } = await import("@/server/services/documents");
  const { listOrganisationsLite } = await import("@/server/services/partners-lite");
  const [allFolders, partners, fileSettings] = await Promise.all([listAllFolders(), listOrganisationsLite(), getSetting("files")]);
  const subfolders = allFolders.filter((f) => f.parentId === folderId && !f.aiOff);
  const orgs = (await db.execute(sql`
    select l.from_id as doc, l.to_id as org from links l
    where l.from_type = 'document' and l.to_type = 'organisation'
      and l.from_id in (${sql.join(files.map((f) => sql`${f.id}::uuid`), sql`, `)})`)) as unknown as { rows: { doc: string; org: string }[] };
  const partnerName = new Map(partners.map((p) => [p.id, p.shortName || p.name]));
  const orgsOf = new Map<string, string[]>();
  for (const r of orgs.rows ?? []) orgsOf.set(r.doc, [...(orgsOf.get(r.doc) ?? []), partnerName.get(r.org) ?? ""]);

  const listing = files
    .map((f) =>
      [
        `id=${f.id}`,
        `title="${f.title}"`,
        `file="${f.filename}"`,
        f.docType ? `type=${f.docType}` : "",
        f.periodLabel ? `period=${f.periodLabel}` : "",
        orgsOf.get(f.id)?.length ? `partners=${orgsOf.get(f.id)!.join("/")}` : "",
        `added=${f.createdAt.toISOString().slice(0, 10)}`,
        f.sha256 ? `sha=${f.sha256.slice(0, 12)}` : "",
        f.summary ? `summary="${f.summary.slice(0, 160)}"` : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");

  const ids = files.map((f) => f.id) as [string, ...string[]];
  const folderTargets = ["stay", ...subfolders.map((f) => f.id)];
  const schema = z.object({
    newFolders: z.array(z.object({ key: z.string().describe("Short key such as 'f1'"), name: z.string().describe("Folder name in the files' language") })).describe("New sub-folders to create inside this folder. At most 6; none if the folder is already tidy."),
    moves: z.array(
      z.object({
        documentId: z.enum(ids),
        folder: z.string().describe("'stay', an existing sub-folder id, or 'new:<key>' for a new folder"),
        rename: z.string().nullable().describe("A clearer title, or null to keep it"),
        reason: z.string().describe("Short Turkish reason"),
      }),
    ),
    duplicates: z.array(z.object({ documentIds: z.array(z.enum(ids)), reason: z.string() })).describe("Files that look like copies of each other (same content or same name)."),
  });
  const out = await aiJson({
    helper: "organize",
    effort: "low",
    thinking: "light",
    maxTokens: 6000,
    schema,
    entity: folderId ? { type: "folder", id: folderId } : null,
    system: [
      "Propose a tidy structure for the files in one folder of her project workspace. Group by what a project manager looks for: period, partner, document type.",
      "Keep changes few and useful: do not move a file that already sits well, and do not rename files that already have clear names.",
      `Existing sub-folders (id: name):\n${subfolders.map((f) => `- ${f.id}: ${f.name}`).join("\n") || "(none)"}`,
      fileSettings.namingRule ? `Her naming rule for titles: ${fileSettings.namingRule}` : "",
      `Allowed folder values: ${folderTargets.join(", ")} or new:<key>.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    messages: [{ role: "user", content: asMaterial("source", { kind: "folder_listing", count: files.length }, listing) }],
  });

  const newKeys = new Set(out.newFolders.map((f) => f.key));
  const subIds = new Set(subfolders.map((f) => f.id));
  const byId = new Map(files.map((f) => [f.id, f]));
  const items: OrganizeItem[] = [];
  for (const m of out.moves) {
    const doc = byId.get(m.documentId);
    if (!doc) continue;
    let target: OrganizeItem["target"] = null;
    if (m.folder.startsWith("new:") && newKeys.has(m.folder.slice(4))) target = { newFolderKey: m.folder.slice(4) };
    else if (subIds.has(m.folder)) target = { folderId: m.folder };
    const title = m.rename && m.rename.trim() && m.rename.trim() !== doc.title ? m.rename.trim().slice(0, 200) : null;
    if (!target && !title) continue;
    items.push({ documentId: doc.id, currentTitle: doc.title, title, target, reason: m.reason.slice(0, 300) });
  }
  const usedKeys = new Set(items.flatMap((i) => (i.target && "newFolderKey" in i.target ? [i.target.newFolderKey] : [])));
  const result: OrganizePayload = {
    folderId,
    newFolders: out.newFolders.filter((f) => usedKeys.has(f.key)).map((f) => ({ key: f.key, name: f.name.trim().slice(0, 120) })),
    items,
    duplicates: out.duplicates.filter((d) => d.documentIds.length > 1).slice(0, 20),
  };
  if (!result.items.length && !result.duplicates.length) return null;
  return createSuggestion({
    kind: "organize",
    title: "Klasör düzenleme önerisi",
    summary: `${result.items.length} değişiklik${result.newFolders.length ? `, ${result.newFolders.length} yeni klasör` : ""}${result.duplicates.length ? `, ${result.duplicates.length} olası kopya` : ""}.`,
    payload: result,
    source: folderId ? { type: "folder", id: folderId } : null,
  });
}

type Decision = { indexes?: number[]; items?: OrganizeItem[]; folderNames?: Record<string, string> };

export async function applyOrganize(payload: unknown, decision: unknown) {
  const p = payload as OrganizePayload;
  const d = (decision ?? {}) as Decision;
  const chosen = d.items ?? (d.indexes ? d.indexes.map((i) => p.items[i]).filter(Boolean) : p.items);
  const { createFolder, updateDocument } = await import("@/server/services/documents");
  const made = new Map<string, string>();
  let changed = 0;
  for (const item of chosen as OrganizeItem[]) {
    let folderId: string | null | undefined;
    if (item.target && "newFolderKey" in item.target) {
      const key = item.target.newFolderKey;
      if (!made.has(key)) {
        const spec = p.newFolders.find((f) => f.key === key);
        const name = d.folderNames?.[key] ?? spec?.name ?? key;
        const folder = await createFolder(name, p.folderId);
        made.set(key, folder.id);
      }
      folderId = made.get(key);
    } else if (item.target && "folderId" in item.target) {
      folderId = item.target.folderId;
    }
    const patch: { folderId?: string | null; title?: string } = {};
    if (folderId !== undefined) patch.folderId = folderId;
    if (item.title) patch.title = item.title;
    if (Object.keys(patch).length) {
      await updateDocument(item.documentId, patch, "ai");
      changed++;
    }
  }
  return { status: changed === p.items.length ? ("accepted" as const) : ("partial" as const), result: { changed, folders: [...made.values()] } };
}
