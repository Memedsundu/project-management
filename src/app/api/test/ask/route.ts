import { answerWithMarkers, prepareAsk, saveAskThread } from "@/server/ai/ask";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Runs the real Ask retrieval and citation handling with a made-up answer
 * that cites the first two sources, so the Ask screen can be tested without
 * an API key. Same guard as the test sign-in.
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || process.env.E2E_LOGIN !== "1") return new Response("Not found", { status: 404 });
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { question } = (await req.json()) as { question: string };
  const scope = { type: "all" as const };
  const { q, sources } = await prepareAsk(question, scope);
  if (!sources.length) return Response.json({ thread: null, sources: [] });
  const cite = (i: number) =>
    sources[i]
      ? [{ type: "content_block_location", document_index: i, document_title: sources[i]!.title, start_block_index: sources[i]!.blocks.length - 1, end_block_index: sources[i]!.blocks.length, cited_text: sources[i]!.blocks.at(-1)!.text.slice(0, 200), file_id: null }]
      : null;
  const content = [
    { type: "text", text: "Kayıtlara göre özet şöyle:\n\n- İlk kaynak ", citations: null },
    { type: "text", text: "bu konuyu anlatıyor", citations: cite(0) },
    { type: "text", text: "\n- İkinci kaynak ", citations: null },
    { type: "text", text: "**ayrıntı** veriyor", citations: cite(1) },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { answer, citations } = answerWithMarkers(content as any, sources);
  const thread = await saveAskThread({ scope, question: q, answer, citations, model: "test" });
  return Response.json({ thread, sources: sources.map((s) => ({ type: s.type, title: s.title, blocks: s.blocks.length })) });
}
