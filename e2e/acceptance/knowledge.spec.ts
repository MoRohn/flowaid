/**
 * Knowledge page smoke test (UPGRADE_PLAN P6-09), without provider keys: create a keyword-only
 * source, paste a document, watch the worker's ingest job index it, and find it from the query
 * playground.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const NAME = `Help center ${Date.now().toString(36)}`;

test("knowledge: create a source, add a document, search it", async ({ page }) => {
  await signIn(page);

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
