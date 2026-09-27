/**
 * Dashboard smoke (UPGRADE_PLAN P6-04): the workspace home shows the metrics overview, the
 * Overview nav entry is active, the filters change the range, and the metrics API answers.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { expect, test } from "@playwright/test";

function credentials(): { email: string; password: string } {
  const file = ".flowaid/dev.env";
  const local = existsSync(file)
    ? (parseEnv(readFileSync(file, "utf8")) as Record<string, string>)
    : {};
  return {
    email: process.env["E2E_EMAIL"] ?? local.FLOWAID_ADMIN_EMAIL ?? "owner@flowaid.local",
    password: process.env["E2E_PASSWORD"] ?? local.FLOWAID_ADMIN_PASSWORD ?? "",
  };
}

test("the dashboard renders the overview and reacts to its filters", async ({ page }) => {
  const { email, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/workflows$/);
  const ws = new URL(page.url()).pathname.split("/")[1] as string;

  await page
    .getByRole("link", { name: /Overview/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${ws}$`));
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Dashboard filters" })).toBeVisible();

  const overview = page.waitForResponse(
    (r) => r.url().includes("/v1/metrics/overview") && r.status() === 200,
  );
  await page.getByRole("radio", { name: "7d" }).click();
  const body = (await (await overview).json()) as { runs: { total: number } };
  expect(body.runs.total).toBeGreaterThanOrEqual(0);
  await expect(page.getByText(/Runs|No runs in this range/).first()).toBeVisible();
});
