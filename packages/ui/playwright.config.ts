import { defineConfig, devices, type PlaywrightTestConfig, type Project } from "@playwright/test";
import path from "node:path";

/**
 * Playwright gallery suite for @flowaid/ui (UI.md §9): every playground gallery in light
 * and dark, zero console errors/warnings, `@axe-core/playwright` with no violations, and a
 * full-page screenshot per page and theme stored as a test attachment.
 *
 * The project and web server are exported so the repository-level `playwright.config.ts`
 * (P0-05) registers the same `ui-gallery` project; this file runs it on its own
 * (`pnpm --filter @flowaid/ui test:e2e`).
 *
 * `PLAYWRIGHT_CHANNEL` (e.g. `chrome`) runs against an installed browser instead of the
 * bundled Chromium from `playwright install chromium`.
 */
const PORT = 5178;
export const UI_GALLERY_URL = `http://127.0.0.1:${PORT}`;
const channel = process.env["PLAYWRIGHT_CHANNEL"];

export const uiGalleryProject: Project = {
  name: "ui-gallery",
  testDir: path.resolve(import.meta.dirname, "e2e"),
  testMatch: /.*\.spec\.ts$/,
  use: {
    ...devices["Desktop Chrome"],
    ...(channel ? { channel } : {}),
    baseURL: UI_GALLERY_URL,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  },
};

export const uiGalleryWebServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  command: "pnpm --filter @flowaid/ui dev",
  url: UI_GALLERY_URL,
  reuseExistingServer: !process.env["CI"],
  timeout: 120_000,
  stdout: "ignore",
  stderr: "pipe",
};

export default defineConfig({
  testDir: path.resolve(import.meta.dirname, "e2e"),
  outputDir: path.resolve(import.meta.dirname, "test-results"),
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  timeout: 60_000,
  projects: [uiGalleryProject],
  webServer: uiGalleryWebServer,
});
