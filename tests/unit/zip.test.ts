import { describe, expect, it } from "vitest";
import { crc32, zipChunks, type ZipSource } from "@/server/export/zip";
import { entryBlob, entryText, readZipEntries } from "@/lib/zip-read";

async function build(entries: ZipSource[], zip64At?: number) {
  const parts: Uint8Array[] = [];
  for await (const c of zipChunks(entries, { zip64At })) parts.push(c);
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

const pdfLike = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => (i * 31) % 251);

describe("zip", () => {
  it("writes entries that read back the same, stored or compressed", async () => {
    const zip = await build([
      { name: "veri/proje-verisi.json", data: JSON.stringify({ a: "Çocuk işçiliği yok", n: [1, 2, 3] }), compress: true },
      { name: "Belgeler/Ortaklar/KÇD Q3 raporu.pdf", load: async () => pdfLike },
      { name: "Dizin.html", data: "<h1>Dizin</h1>".repeat(200), compress: true },
      { name: "boş.txt", data: "" },
    ]);
    const entries = await readZipEntries(zip);
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ["veri/proje-verisi.json", 8],
      ["Belgeler/Ortaklar/KÇD Q3 raporu.pdf", 0],
      ["Dizin.html", 8],
      ["boş.txt", 0],
    ]);
    expect(JSON.parse(await entryText(zip, entries[0]!))).toEqual({ a: "Çocuk işçiliği yok", n: [1, 2, 3] });
    const pdf = new Uint8Array(await (await entryBlob(zip, entries[1]!)).arrayBuffer());
    expect(pdf.length).toBe(pdfLike.length);
    expect(crc32(pdf)).toBe(entries[1]!.crc);
    expect(await entryText(zip, entries[2]!)).toBe("<h1>Dizin</h1>".repeat(200));
    expect(entries[2]!.compressedSize).toBeLessThan(entries[2]!.size);
    expect(await entryText(zip, entries[3]!)).toBe("");
  });

  it("skips duplicate paths and files that could not be read", async () => {
    const skipped: string[] = [];
    const parts: Uint8Array[] = [];
    for await (const c of zipChunks(
      [
        { name: "a.txt", data: "1" },
        { name: "a.txt", data: "2" },
        { name: "missing.pdf", load: async () => null },
      ],
      { onSkip: (n) => skipped.push(n) },
    ))
      parts.push(c);
    const entries = await readZipEntries(new Blob(parts as BlobPart[]));
    expect(entries.map((e) => e.name)).toEqual(["a.txt"]);
    expect(skipped).toEqual(["a.txt", "missing.pdf"]);
  });

  it("adds ZIP64 records past the limit and still reads every entry", async () => {
    // The limit is lowered so the test does not need 4 GB.
    const zip = await build(
      [
        { name: "1.bin", load: async () => pdfLike },
        { name: "2.bin", load: async () => pdfLike },
        { name: "3.txt", data: "son" },
      ],
      1024 * 1024,
    );
    const entries = await readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["1.bin", "2.bin", "3.txt"]);
    expect(entries[2]!.offset).toBeGreaterThan(1024 * 1024);
    expect(await entryText(zip, entries[2]!)).toBe("son");
    const second = new Uint8Array(await (await entryBlob(zip, entries[1]!)).arrayBuffer());
    expect(crc32(second)).toBe(crc32(pdfLike));
  });
});
