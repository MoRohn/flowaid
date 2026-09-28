/**
 * Accessibility of the web app (UPGRADE_PLAN P0-20): axe (WCAG 2.x A and AA) on the sign-in page
 * and on every main route after signing in, in light and dark; and every item the side
 * navigation renders resolves without a 404.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiHeaders, signIn } from "./helpers.ts";

const ROUTES = [
  "workflows",
  "workflows/new",
  "runs",
  "human-tasks",
  "templates",
  "integrations",
  "evaluations",
  "credentials",
  "settings",
];

/** The route's violations, one line per rule with up to five offending nodes. */
async function audit(page: Page): Promise<string[]> {
  // live streams keep the network busy, so wait for the page to settle instead of "networkidle"
  await page.waitForLoadState("load");
  await page.waitForTimeout(1_000);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "?"}): ${v.help}\n${v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n")}`,
  );
  return summary;
}

test.describe.configure({ mode: "serial" });

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme, reducedMotion: "reduce" });

    test("the sign-in page has no axe violations", async ({ page }) => {
      await page.goto("/login");
      const form = page.getByRole("button", { name: "Sign in" });
      await Promise.race([form.waitFor(), page.waitForURL(/\/[a-z0-9-]+\/workflows$/)]);
      test.skip(!(await form.isVisible()), "local mode signs in by itself: there is no form");
      expect(await audit(page)).toEqual([]);
    });

    test("every main route has no axe violations", async ({ page }) => {
      const ws = await signIn(page);
      const workflow = await page.request.post("/v1/workflows", {
        headers: apiHeaders(ws),
        data: { name: `A11y ${colorScheme} ${Date.now().toString(36)}` },
      });
      expect(workflow.status(), await workflow.text()).toBe(201);
      const workflowId = ((await workflow.json()) as { id: string }).id;
      const found: Record<string, string[]> = {};
      for (const route of [...ROUTES, `workflows/${workflowId}`]) {
        await page.goto(`/${ws}/${route}`);
        await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
        const violations = await audit(page);
        if (violations.length) found[route] = violations;
      }
      expect(found).toEqual({});
    });
  });
}

test("every side navigation item resolves without a 404", async ({ page }) => {
  const ws = await signIn(page);
  const items = page.getByRole("navigation", { name: "Primary" }).locator("[data-nav-item]");
  await expect(items.first()).toBeVisible();
  const hrefs: string[] = [];
  for (const item of await items.all()) {
    const href = await item.getAttribute("href");
    if (href) hrefs.push(href);
  }
  expect(hrefs.length).toBeGreaterThanOrEqual(5);
  for (const href of hrefs) {
    // Overview is the workspace root; every other item is below it
    expect(href === `/${ws}` || href.startsWith(`/${ws}/`), href).toBe(true);
    const response = await page.goto(href);
    expect(response?.status(), href).toBeLessThan(400);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByText(/this page could not be found|^404$/i)).toHaveCount(0);
  }
});
