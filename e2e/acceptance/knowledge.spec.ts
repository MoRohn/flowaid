/**
 * Knowledge page smoke test (UPGRADE_PLAN P6-09), without provider keys: create a keyword-only
 * source, paste a document, watch the worker's ingest job index it, and find it from the query
 * playground.
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

const NAME = `Help center ${Date.now().toString(36)}`;

test("knowledge: create a source, add a document, search it", async ({ page }) => {
  const { email, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/workflows$/);

  // The nav shows Knowledge when the API reports the feature.
  await page.getByRole("link", { name: "Knowledge" }).first().click();
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();

  await page.getByRole("button", { name: "New source" }).first().click();
  await page.getByLabel("Name").fill(NAME);
  await page.getByRole("switch", { name: /Embed chunks/ }).click();
  await page.getByRole("button", { name: "Create source" }).click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  await page.getByRole("button", { name: "Add documents" }).click();
  await page.getByLabel("Or paste a document").fill("Refund policy");
  await page
    .getByLabel("Document text")
    .fill("# Refunds\n\nRefunds go back to the original card within five business days.");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const row = page.getByRole("row", { name: /Refund policy/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("indexed")).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Query").fill("refunds original card");
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByRole("list", { name: "Search results" });
  await expect(results.getByText("Refund policy")).toBeVisible();
  await expect(results.getByText(/five business days/)).toBeVisible();

  // Clean up.
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete source" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
});
