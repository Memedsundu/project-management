import { expect, test, uniq } from "./fixtures";

test("a new page keeps its title and text", async ({ page }) => {
  const title = `Ortaklar toplantısı hazırlığı ${uniq()}`;
  const text = "Mevsimlik tarım raporunun taslağı cuma günü paylaşılacak.";
  await page.goto("/notes");
  await page.getByRole("main").getByRole("button", { name: "Yeni sayfa" }).first().click();
  await page.getByRole("menuitem", { name: "Boş sayfa" }).click();
  await expect(page).toHaveURL(/\/notes\/[^/]+$/);

  await page.getByRole("textbox", { name: "Adsız sayfa" }).fill(title);
  await page.getByLabel("Sayfa içeriği").click();
  await page.keyboard.type(text);
  await expect(page.getByText("Kaydedildi")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Adsız sayfa" })).toHaveValue(title);
  await expect(page.getByLabel("Sayfa içeriği")).toContainText(text);
});
