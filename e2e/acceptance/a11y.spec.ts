/**
 * Accessibility of the web app (UPGRADE_PLAN P0-20, roadmap F-12): axe (WCAG 2.x A and AA) on the
 * sign-in page, on every page in the navigation and with the command menu, the Guide, the
 * collapsed navigation and a dialog open, in light and dark; keyboard checks axe cannot make
 * (focus comes back after a dialog, the Guide does not hold focus, the "g" shortcuts); and every
 * item the side navigation renders resolves without a 404.
 *
 * `E2E_WORKSPACE` picks the workspace the checks use (and create their one workflow in); by
 * default the one the app opens.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { apiHeaders, signIn } from "./helpers.ts";

const ROUTES = [
  "",
  "workflows",
  "workflows/new",
  "agents",
  "runs",
  "human-tasks",
  "templates",
  "triggers",
  "integrations",
  "knowledge",
  "evaluations",
  "credentials",
  "settings",
];

/** Signs in and returns the workspace to check: `E2E_WORKSPACE`, or the one the app opens. */
async function workspace(page: Page): Promise<string> {
  const landed = await signIn(page);
  return process.env["E2E_WORKSPACE"] ?? landed;
}

const at = (ws: string, route: string) => (route ? `/${ws}/${route}` : `/${ws}`);

/**
 * Waits until the page has settled: nothing is marked busy and the rendered markup is the same in
 * two samples in a row. Live streams keep the network busy, so "networkidle" never comes.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  let previous = "";
  await expect
    .poll(
      async () => {
        const busy = await page.locator('[aria-busy="true"]').count();
        const current = `${busy}:${(await page.locator("body").innerHTML()).length}`;
        const same = current === previous && current.startsWith("0:");
        previous = current;
        return same;
      },
      { intervals: [250], timeout: 15_000, message: "the page settles" },
    )
    .toBe(true);
}

/** The route's violations, one line per rule with up to five offending nodes. */
async function audit(page: Page): Promise<string[]> {
  await settled(page);
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
      await Promise.race([
        form.waitFor(),
        page.waitForURL(/\/(?!login$)[a-z0-9-]+(\/workflows)?$/),
      ]);
      test.skip(!(await form.isVisible()), "local mode signs in by itself: there is no form");
      expect(await audit(page)).toEqual([]);
    });

    test("every main route has no axe violations", async ({ page }) => {
      const ws = await workspace(page);
      const workflow = await page.request.post("/v1/workflows", {
        headers: apiHeaders(ws),
        data: { name: `A11y ${colorScheme} ${Date.now().toString(36)}` },
      });
      expect(workflow.status(), await workflow.text()).toBe(201);
      const workflowId = ((await workflow.json()) as { id: string }).id;
      const found: Record<string, string[]> = {};
      for (const route of [...ROUTES, `workflows/${workflowId}`]) {
        await page.goto(at(ws, route));
        await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
        const violations = await audit(page);
        if (violations.length) found[route] = violations;
      }
      expect(found).toEqual({});
    });

    test("open overlays have no axe violations", async ({ page }) => {
      const ws = await workspace(page);
      const found: Record<string, string[]> = {};
      const check = async (state: string) => {
        const violations = await audit(page);
        if (violations.length) found[state] = violations;
      };

      await page.goto(at(ws, "workflows"));
      await page.getByRole("button", { name: /^Search/ }).click();
      await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
      await check("command menu");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Guide", exact: true }).click();
      await expect(page.getByRole("complementary", { name: "Guide" })).toBeVisible();
      await check("Guide");
      await page.getByRole("button", { name: "Close the Guide" }).click();

      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await check("collapsed navigation");
      await page.getByRole("button", { name: "Expand navigation" }).click();

      await page.goto(at(ws, "credentials?new=1"));
      await expect(page.getByRole("dialog")).toBeVisible();
      await check("New credential dialog");

      expect(found).toEqual({});
    });
  });
}

test.describe("keyboard", () => {
  test.use({ reducedMotion: "reduce" });

  test("focus comes back to what opened a dialog, a drawer or a menu's dialog", async ({
    page,
  }) => {
    const ws = await workspace(page);
    await page.goto(at(ws, "workflows"));
    await settled(page);

    // a dialog opened from a menu item: focus returns to the menu's button
    const help = page.getByRole("button", { name: "Help" });
    await help.click();
    await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByRole("dialog", { name: /Keyboard shortcuts/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(help).toBeFocused();

    // the navigation drawer on a phone, opened by a button that is not its trigger
    await page.setViewportSize({ width: 390, height: 844 });
    const open = page.getByRole("button", { name: "Open navigation" });
    await open.click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
  });

  test("the Guide does not hold focus, and Escape returns to its button", async ({ page }) => {
    const ws = await workspace(page);
    await page.goto(at(ws, "agents"));
    await settled(page);
    const button = page.getByRole("button", { name: "Guide", exact: true });
    await button.click();
    const guide = page.getByRole("complementary", { name: "Guide" });
    await expect(guide).toBeVisible();
    const controls = guide.locator("button, a[href]");
    await controls.last().focus();
    await page.keyboard.press("Tab");
    await expect(guide.locator(":focus")).toHaveCount(0);
    await controls.first().focus();
    await page.keyboard.press("Shift+Tab");
    await expect(guide.locator(":focus")).toHaveCount(0);
    await controls.first().focus();
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("the g shortcuts shown in the navigation go to their pages", async ({ page }) => {
    const ws = await workspace(page);
    await page.goto(at(ws, "agents"));
    await settled(page);
    await page.locator("body").focus();
    await page.keyboard.press("g");
    await page.keyboard.press("w");
    await expect(page).toHaveURL(new RegExp(`/${ws}/workflows$`));
    await page.keyboard.press("g");
    await page.keyboard.press("r");
    await expect(page).toHaveURL(new RegExp(`/${ws}/runs$`));
  });
});

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

test("moving between pages in the app never breaks one", async ({ page }) => {
  // one session, clicking through the nav both ways: pages share a query cache, so a page that
  // reads another page's cached data in the wrong shape fails only after a visit, not on reload
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  const labels: string[] = [];
  for (const item of await nav.locator("[data-nav-item]").all())
    labels.push(((await item.textContent()) ?? "").trim());
  for (const label of [...labels, ...[...labels].reverse()]) {
    await nav.locator("[data-nav-item]", { hasText: label }).first().click();
    await expect(page.locator("#main-content, main").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Could not load this"), label).toHaveCount(0);
  }
});
