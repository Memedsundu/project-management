import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (`npm run test:e2e`). They start their own `next dev` with
 * the test sign-in (E2E_LOGIN=1) on an empty workspace in a temporary
 * folder, so they never touch real data. Stop `npm run dev` first: Next.js
 * runs one dev server per project folder.
 */
const PORT = 3210;
const BASE = `http://localhost:${PORT}`;

// Made once by the runner; the test workers inherit it.
const dataDir = (process.env.E2E_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "proje-e2e-")));

export default defineConfig({
  testDir: "tests/e2e",
  // One server and one database, so the tests run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles each screen the first time it is opened.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "laptop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /(screens|accessibility)\.spec\.ts$/ },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE}/sign-in`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      E2E_LOGIN: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      APP_ORIGIN: BASE,
      LOCAL_DATA_DIR: dataDir,
      LOCAL_UPLOAD_DIR: path.join(dataDir, "uploads"),
      DATABASE_URL: `pglite:${path.join(dataDir, "db")}`,
      // Set but empty, so a value in .env.local can never send test data to a real service.
      BLOB_READ_WRITE_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      VOYAGE_API_KEY: "",
    },
  },
});
