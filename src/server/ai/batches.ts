import "server-only";
import { enqueue } from "@/server/jobs/queue";
import { anthropic, modelFor } from "./client";

/** Job: check a Message Batch; when it has ended, hand each answer to its handler. */
export async function pollBatchesJob(payload: Record<string, unknown>) {
  const batchId = String(payload.batchId ?? "");
  const kind = String(payload.kind ?? "");
  if (!batchId) return;
  const client = anthropic();
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") {
    const waited = Number(payload.polls ?? 0) + 1;
    // Batches finish within 24 hours; check every 5 minutes, then every 30.
    const delay = waited < 12 ? 5 * 60_000 : 30 * 60_000;
    if (waited < 80) await enqueue("poll_batches", { ...payload, polls: waited }, { runAt: new Date(Date.now() + delay) });
    return;
  }
  if (kind === "classify") {
    const { handleClassifyBatchResult } = await import("./classify");
    const model = await modelFor("classify");
    for await (const r of await client.messages.batches.results(batchId)) {
      if (r.result.type === "succeeded") await handleClassifyBatchResult(r.custom_id, r.result.message, r.result.message.model ?? model);
      else await enqueue("classify_document", { documentId: r.custom_id }, { dedupeKey: `classify:${r.custom_id}` });
    }
  }
}
