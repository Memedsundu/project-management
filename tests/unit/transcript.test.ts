import { describe, expect, it } from "vitest";
import { cleanTranscript } from "@/lib/transcript";

describe("cleanTranscript", () => {
  it("turns a Teams WebVTT export into speaker lines", () => {
    const vtt = `WEBVTT

0b6a1f2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/12-0
00:00:01.000 --> 00:00:04.000
<v Ayşe Demir>Merhaba, başlayalım.</v>

0b6a1f2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b/13-0
00:00:04.500 --> 00:00:07.000
<v Ayşe Demir>Önce bütçe.</v>

00:00:07.500 --> 00:00:09.000
<v John Smith>Fine by me.</v>`;
    expect(cleanTranscript(vtt)).toBe("Ayşe Demir: Merhaba, başlayalım. Önce bütçe.\nJohn Smith: Fine by me.");
  });

  it("handles SRT with names in the text", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Mehmet: Rapor cuma gelir.

2
00:00:03,500 --> 00:00:05,000
Mehmet: Ekleri de var.`;
    expect(cleanTranscript(srt)).toBe("Mehmet: Rapor cuma gelir. Ekleri de var.");
  });

  it("leaves plain text alone", () => {
    expect(cleanTranscript("  Just notes.\nSecond line.  ")).toBe("Just notes.\nSecond line.");
  });
});
