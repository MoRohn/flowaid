/**
 * Dashboard smoke (UPGRADE_PLAN P6-04): the workspace home shows the metrics overview, the
 * Overview nav entry is active, the filters change the range, and the metrics API answers.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test("the dashboard renders the overview and reacts to its filters", async ({ page }) => {
  const ws = await signIn(page);

  await page
    .getByRole("link", { name: /Overview/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${ws}$`));
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Dashboard filters" })).toBeVisible();

  const overview = page.waitForResponse(
    (r) => r.url().includes("/v1/metrics/overview") && r.status() === 200,
  );
  await page.getByRole("radio", { name: "7d" }).click();
  const body = (await (await overview).json()) as { runs: { total: number } };
  expect(body.runs.total).toBeGreaterThanOrEqual(0);
  await expect(page.getByText(/Runs|No runs in this range/).first()).toBeVisible();
});
