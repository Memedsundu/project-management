import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { replaceSubscription } from "@/server/notifications/push";

export const dynamic = "force-dynamic";

const schema = z.object({
  oldEndpoint: z.string().max(2000).nullable(),
  subscription: z.object({
    endpoint: z.string().url().max(2000).startsWith("https://"),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
  }),
});

/**
 * The service worker calls this when the browser renews a push subscription
 * (pushsubscriptionchange), since it cannot call server actions.
 */
export async function POST(req: Request) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const ok = await replaceSubscription(parsed.data.oldEndpoint, parsed.data.subscription, req.headers.get("user-agent"));
  return Response.json({ ok });
}
