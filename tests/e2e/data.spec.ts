import { openAsBlob } from "node:fs";
import { DATA_FILE_PATHS, isBackup } from "../../src/lib/backup-format";
import { entryText, readZipEntries } from "../../src/lib/zip-read";
import { expect, test, uniq } from "./fixtures";

// Closing the project changes every screen, so these run in order.
test.describe.configure({ mode: "serial" });

test("the export is one ZIP with a data file the app can restore", async ({ page }, testInfo) => {
  const title = `Dışa aktarım denemesi ${uniq()}`;
  await page.goto("/tasks");
  await page.getByTestId("inline-add").fill(title);
  await page.getByTestId("inline-add").press("Enter");
  await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

  await page.goto("/settings#data");
  await page.getByTestId("s-export").click();
  await expect(page.getByTestId("s-export-dialog")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("s-export-download").click()]);
  const file = testInfo.outputPath("export.zip");
  await download.saveAs(file);

  const zip = await openAsBlob(file);
  const entries = await readZipEntries(zip);
  const dataEntry = entries.find((e) => (DATA_FILE_PATHS as readonly string[]).includes(e.name));
  expect(dataEntry, "the data file inside the ZIP").toBeTruthy();
  const data: unknown = JSON.parse(await entryText(zip, dataEntry!));
  expect(isBackup(data)).toBe(true);
  expect(JSON.stringify((data as { tables: Record<string, unknown> }).tables.tasks)).toContain(title);

  // The file name is checked on the response itself: the name a browser shows depends on the computer's locale.
  const res = await page.request.get("/api/export?files=0");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.zip"/);
});

test("closing the project makes everything read-only until it is reopened", async ({ page }) => {
  try {
    await page.goto("/settings#data");
    await page.getByTestId("s-close").click();
    await expect(page.getByTestId("s-close-dialog")).toBeVisible();
    await page.getByTestId("s-close-confirm").click();
    await expect(page.getByTestId("read-only-banner")).toBeVisible();

    await page.goto("/tasks");
    await expect(page.getByTestId("read-only-banner")).toBeVisible();
    await expect(page.getByTestId("inline-add")).toHaveCount(0);

    // The banner's link opens the archive download.
    await page.getByTestId("read-only-banner").getByRole("link").click();
    await expect(page.getByTestId("s-export-dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("s-reopen").click();
    await expect(page.getByTestId("read-only-banner")).toHaveCount(0);
  } finally {
    // Leave the workspace open for the tests that follow, whatever happened above.
    await page.goto("/settings#data");
    const reopen = page.getByTestId("s-reopen");
    if (await reopen.isVisible()) {
      await reopen.click();
      await expect(page.getByTestId("read-only-banner")).toHaveCount(0);
    }
  }
});
