import { describe, expect, it } from "vitest";
import { checkForChildData, isTckn } from "@/server/files/child-guard";
import { chunkPage } from "@/server/files/extract";

describe("child-data guard", () => {
  it("knows a valid T.C. kimlik number", () => {
    expect(isTckn("10000000146")).toBe(true);
    expect(isTckn("12345678901")).toBe(false);
  });

  it("flags beneficiary-style tables and name-age lists", () => {
    expect(checkForChildData({ text: "", headers: [["Adı Soyadı", "Yaşı", "Okulu"]] }).flag).toBe(true);
    expect(checkForChildData({ text: "", headers: [["İl", "Kız", "Erkek", "Toplam"]] }).flag).toBe(false);
    expect(checkForChildData({ text: "Ayşe (12), Mehmet (14) ve Elif (9) tarlada çalışıyor." }).flag).toBe(true);
    expect(checkForChildData({ text: "Ekim ayında 120 çocuk okula döndü; 45'i kız." }).flag).toBe(false);
    expect(checkForChildData({ text: "Öğrenci 10000000146 okula kayıt oldu." }).flag).toBe(true);
  });

  it("cuts long pages into overlapping passages", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Cümle ${i} burada bitiyor.`).join(" ");
    const parts = chunkPage(text, 300, 50);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 320)).toBe(true);
  });
});
