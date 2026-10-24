import { AxeBuilder } from "@axe-core/playwright";
import { expect, SCREENS, test } from "./fixtures";

/** WCAG 2.2 AA, checked by axe on every screen, in the light and the dark theme. */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
        } catch {}
      }, theme);
    });

    for (const [path] of SCREENS) {
      test(`${path} passes WCAG 2.2 AA`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
        await expect(page.locator("h1")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        const found = violations.map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
        expect(found).toEqual([]);
      });
    }
  });
}
