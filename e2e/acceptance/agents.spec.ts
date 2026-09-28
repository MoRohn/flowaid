/**
 * Agents smoke (P6-10): the nav shows Agents, a preset created through the API is listed with its
 * model, bounds and tools, and it can be deleted from the page.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test("agents page lists, shows and deletes a preset", async ({ page }) => {
  const ws = await signIn(page);

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
