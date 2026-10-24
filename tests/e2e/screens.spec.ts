import { test as plain } from "@playwright/test";
import { expect, SCREENS, test } from "./fixtures";

for (const [path, title] of SCREENS) {
  test(`${path} opens`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(`(^| · )${title} · `));
    await expect(page.locator("h1")).toBeVisible();
  });
}

plain("a visitor who is not signed in is sent to sign in", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/(sign-in|setup)/);
});
