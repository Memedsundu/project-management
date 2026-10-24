import { describe, expect, it } from "vitest";
import { blocksToMarkdown, blocksToPlainText, extractMentions, markdownToBlocks, openChecklistItems } from "@/lib/blocks";

describe("blocks", () => {
  it("turns Markdown into BlockNote blocks and back", () => {
    const md = [
      "# Toplantı özeti",
      "",
      "Ortak A ile **bütçe** konuşuldu.",
      "",
      "- Birinci madde",
      "  - İç madde",
      "- [ ] Raporu gönder",
      "- [x] Listeyi paylaş",
      "",
      "| Gösterge | Değer |",
      "| --- | --- |",
      "| Okula dönen | 120 |",
    ].join("\n");
    const blocks = markdownToBlocks(md);
    expect(blocks[0]).toMatchObject({ type: "heading", props: { level: 1 } });
    expect(blocks[1]!.content).toEqual([
      { type: "text", text: "Ortak A ile ", styles: {} },
      { type: "text", text: "bütçe", styles: { bold: true } },
      { type: "text", text: " konuşuldu.", styles: {} },
    ]);
    expect(blocks[2]).toMatchObject({ type: "bulletListItem", children: [{ type: "bulletListItem" }] });
    expect(blocks[3]).toMatchObject({ type: "checkListItem", props: { checked: false } });
    expect(blocks[5]!.type).toBe("table");
    const back = blocksToMarkdown(blocks);
    expect(back).toContain("# Toplantı özeti");
    expect(back).toContain("**bütçe**");
    expect(back).toContain("- [ ] Raporu gönder");
    expect(back).toContain("| Okula dönen | 120 |");
    expect(openChecklistItems(blocks)).toEqual(["Raporu gönder"]);
    expect(blocksToPlainText(blocks)).toContain("Okula dönen | 120");
  });

  it("keeps @mentions as app links", () => {
    const id = "6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
    const blocks = markdownToBlocks(`Bkz. [Ortak A](app://organisation/${id})`);
    expect(extractMentions(blocks)).toEqual([{ kind: "organisation", id, title: "Ortak A" }]);
    expect(blocksToMarkdown(blocks)).toContain(`(app://organisation/${id})`);
  });
});
