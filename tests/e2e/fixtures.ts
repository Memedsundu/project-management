import { test as base, expect } from "@playwright/test";

/**
 * Every test starts signed in through the test-only sign-in route, and fails
 * when a page it opens throws, logs an error or misses a translation.
 */
export const test = base.extend<{ problems: string[] }>({
  page: async ({ page }, use) => {
    const res = await page.request.post("/api/test/login");
    expect(res.ok(), "test sign-in; it needs E2E_LOGIN=1 outside production").toBe(true);
    await use(page);
  },
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" || m.text().includes("MISSING_MESSAGE")) problems.push(`console: ${m.text()}`);
      });
      await use(problems);
      expect(problems, "errors on the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** A short, unique tail for names, so a test can find what it made. */
export const uniq = () => Date.now().toString(36).slice(-5);

/** Every screen in the menu, with the name its browser tab shows. */
export const SCREENS: [path: string, title: string][] = [
  ["/today", "Bugün"],
  ["/inbox", "Gelen kutusu"],
  ["/tasks", "Görevler"],
  ["/meetings", "Toplantılar"],
  ["/notes", "Notlar"],
  ["/partners", "Ortaklar"],
  ["/workplan", "İş planı"],
  ["/indicators", "Göstergeler"],
  ["/files", "Belgeler"],
  ["/files/check", "Kontrol"],
  ["/collections", "Koleksiyonlar"],
  ["/reports", "Raporlar"],
  ["/briefs", "Özetler"],
  ["/search?q=rapor", "Ara"],
  ["/settings", "Ayarlar"],
  ["/trash", "Çöp kutusu"],
];
