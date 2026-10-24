"use server";

import { z } from "zod";
import { act } from "@/server/action";
import { beginRestore, finishRestore, insertRows, prepareFiles, reindexSlice } from "@/server/export/restore";
import { closeProject, reopenProject } from "@/server/services/closure";

/** Closing makes the workspace read-only; the check in act() stops every change after it. */
export async function closeProjectAction() {
  return act(async () => {
    await closeProject();
    return null;
  });
}

/** Reopening must work while the project is read-only. */
export async function reopenProjectAction() {
  return act(
    async () => {
      await reopenProject();
      return null;
    },
    { write: false, refresh: true },
  );
}

/*
 * Restore steps. They skip the read-only check (the backup's own settings,
 * written last, may close the project) and do not refresh the screen while
 * they run; the dialog refreshes once at the end.
 */
const quiet = { write: false, refresh: false } as const;

const metaSchema = z.object({ exportedAt: z.string().max(40), projectName: z.string().max(300) });

export async function restoreBeginAction(meta: z.input<typeof metaSchema>) {
  return act(() => beginRestore(metaSchema.parse(meta)), quiet);
}

const fileSchema = z.object({
  versionId: z.string().uuid(),
  key: z.string().max(400),
  size: z.number().int().min(0).max(250 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().min(1).max(300),
  type: z.string().max(200),
});

export async function restoreFilesAction(items: z.input<typeof fileSchema>[]) {
  return act(() => prepareFiles(z.array(fileSchema).max(100).parse(items)), quiet);
}

export async function restoreRowsAction(table: string, rows: Record<string, unknown>[], reset: boolean) {
  return act(
    () =>
      insertRows(
        z.string().regex(/^[a-z_]{1,60}$/).parse(table),
        z.array(z.record(z.string(), z.unknown())).max(1000).parse(rows),
        { reset: z.boolean().parse(reset) },
      ),
    quiet,
  );
}

const cursorSchema = z.object({ type: z.number().int().min(0).max(100), after: z.string().uuid().nullable() }).nullable();

export async function restoreIndexAction(cursor: z.input<typeof cursorSchema>) {
  return act(() => reindexSlice(cursorSchema.parse(cursor)), quiet);
}

export async function restoreFinishAction() {
  return act(() => finishRestore(), { write: false, refresh: true });
}
