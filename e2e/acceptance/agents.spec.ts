/**
 * Agents smoke (P6-10): the nav shows Agents, a preset created through the API is listed with its
 * model, bounds and tools, and it can be deleted from the page.
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

test("agents page lists, shows and deletes a preset", async ({ page }) => {
  const { email, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/[a-z0-9-]+\/workflows$/);
  const ws = new URL(page.url()).pathname.split("/")[1] as string;

  const name = `Smoke agent ${Date.now().toString(36)}`;
  const created = await page.request.post("/v1/agents", {
    headers: { "x-workspace": ws, "x-requested-with": "flowaid" },
    data: {
      name,
      description: "Answers order questions",
      config: {
        model: { provider: "openai", model: "gpt-test" },
        tools: [{ name: "lookup_order", approval: "never" }],
        maxSteps: 5,
      },
    },
  });
  expect(created.status()).toBe(201);

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page).toHaveURL(new RegExp(`/${ws}/agents$`));
  const card = page.getByRole("listitem").filter({ hasText: name });
  await expect(card).toContainText("gpt-test");
  await expect(card).toContainText("5 steps");
  await expect(card).toContainText("lookup_order");

  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete agent" }).click();
  await expect(page.getByText(name)).toHaveCount(0);
});
