import { describe, expect, it } from "vitest";
import { answerWithMarkers, type Material } from "@/server/ai/ask";

const sources: Material[] = [
  {
    type: "document",
    id: "d1",
    title: "KÇD Q3 raporu",
    href: "/files/d/d1",
    context: "file",
    blocks: [
      { text: "Giriş.", page: 1 },
      { text: "Toplam 54 hane ziyaret edildi.", page: 4 },
    ],
  },
  { type: "meeting", id: "m1", title: "KÇD toplantısı", href: "/meetings/m1", context: "meeting", blocks: [{ text: "Rapor 10 Kasım'da gelecek.", page: null }] },
];

const cite = (document_index: number, start_block_index: number, cited_text: string) => ({
  type: "content_block_location" as const,
  document_index,
  document_title: "",
  start_block_index,
  end_block_index: start_block_index + 1,
  cited_text,
  file_id: null,
});

describe("answerWithMarkers", () => {
  it("numbers each cited passage once and keeps the page", () => {
    const content = [
      { type: "text" as const, text: "KÇD ", citations: null },
      { type: "text" as const, text: "54 haneye ulaştı", citations: [cite(0, 1, "Toplam 54 hane ziyaret edildi.")] },
      { type: "text" as const, text: "; rapor ", citations: null },
      { type: "text" as const, text: "10 Kasım'da gelecek", citations: [cite(1, 0, "Rapor 10 Kasım'da gelecek.")] },
      { type: "text" as const, text: ". Yine ", citations: null },
      { type: "text" as const, text: "54 hane", citations: [cite(0, 1, "Toplam 54 hane ziyaret edildi.")] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { answer, citations } = answerWithMarkers(content as any, sources);
    expect(answer).toBe("KÇD 54 haneye ulaştı[1]; rapor 10 Kasım'da gelecek[2]. Yine 54 hane[1]");
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({ n: 1, sourceType: "document", sourceId: "d1", page: 4, href: "/files/d/d1?page=4" });
    expect(citations[1]).toMatchObject({ n: 2, sourceType: "meeting", page: null, href: "/meetings/m1" });
  });

  it("ignores citations to unknown documents", () => {
    const content = [{ type: "text" as const, text: "Bir şey", citations: [cite(5, 0, "x")] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { answer, citations } = answerWithMarkers(content as any, sources);
    expect(answer).toBe("Bir şey");
    expect(citations).toHaveLength(0);
  });
});
