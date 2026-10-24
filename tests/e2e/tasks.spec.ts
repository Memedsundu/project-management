import { expect, test, uniq } from "./fixtures";

test("a task typed in the add row is understood, listed, completed and kept in the logbook", async ({ page }) => {
  const title = `Ortak raporunu kontrol et ${uniq()}`;
  await page.goto("/tasks");
  const add = page.getByTestId("inline-add");
  await add.fill(`${title} yarın`);
  await add.press("Enter");

  // "yarın" became the due date, not part of the title.
  const row = page.locator("[data-task-id]").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Yarın");

  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();

  await page.getByRole("link", { name: "Tamamlananlar" }).click();
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
});
