import { defineConfig, devices } from "@playwright/test";

/**
 * The release gate (UPGRADE_PLAN P5-03): the acceptance journey against a running stack
 * (`pnpm start`, compose, or the e2e workflow). `E2E_BASE_URL` is the web app; `E2E_EMAIL` and
 * `E2E_PASSWORD` sign in (they default to the owner `pnpm start` generated in .flowaid/dev.env).
 * `PLAYWRIGHT_EXECUTABLE` runs against an already installed Chromium.
 */
const executablePath = process.env["PLAYWRIGHT_EXECUTABLE"];

export default defineConfig({
  testDir: "e2e/acceptance",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: "web-e2e" }],
});
