import { z } from "zod";
import { runAssistant, type AssistantEvent } from "@/server/ai/assistant";
import { getCurrentUser } from "@/server/auth/session";
import { getSetting } from "@/server/services/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(8000),
  locale: z.enum(["tr", "en"]).default("tr"),
  screen: z
    .object({
      kind: z.string().max(40),
      id: z.string().uuid().nullish(),
      title: z.string().max(300),
      detail: z.string().max(500).nullish(),
      selection: z.string().max(8000).nullish(),
    })
    .nullish(),
});

/**
 * The assistant panel's one endpoint. Answers stream back as lines of JSON:
 * text as it is written, a line for each lookup, and each proposal card.
 */
export async function POST(req: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const readOnly = (await getSetting("archive")).readOnly;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // She closed the panel; the turn is still saved.
        }
      };
      try {
        await runAssistant({ ...parsed.data, readOnly, signal: req.signal, emit });
      } catch (err) {
        console.error("[assistant]", err);
        emit({ type: "error", message: parsed.data.locale === "en" ? "Something went wrong. Could you try again?" : "Bir şey ters gitti. Tekrar dener misin?" });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
