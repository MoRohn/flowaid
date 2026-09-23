/**
 * Visual and accessibility regression over the UI playground (UI.md §9): every gallery page
 * × {light, dark}, switched through the sidebar theme buttons. Each run asserts that the
 * page logged no console error or warning (and threw nothing), that axe-core reports no
 * violations (colour contrast included: this is the real-layout half of `src/a11y.test.tsx`),
 * and stores a full-page screenshot as a test attachment.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { GALLERY } from "../playground/gallery";

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

test("the manifest lists the 12 component galleries (every page below is audited)", () => {
  expect(GALLERY.map((g) => g.slug)).toEqual(
    expect.arrayContaining([
      "primitives",
      "decision",
      "node",
      "canvas",
      "trace",
      "inspector",
      "forms",
      "shell",
      "data",
      "observability",
      "human",
      "builder",
    ]),
  );
});

/** Records console errors/warnings and uncaught page errors from the moment the page opens. */
function recordProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    const type = message.type();
    if (type === "error" || type === "warning") problems.push(`console.${type}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function openGallery(page: Page, slug: string, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/#/${slug}`);
  await page.getByRole("navigation").getByRole("button", { name: theme, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(
    page.getByRole("navigation").getByRole("button", { name: theme, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // The lazy page has replaced the Suspense fallback and rendered its heading.
  await expect(page.locator("main").getByText("loading…", { exact: true })).toHaveCount(0);
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Let charts, measured widths and xyflow's first fit settle before auditing.
  await page.waitForTimeout(400);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    for (const gallery of GALLERY) {
      test(`${gallery.slug}`, async ({ page }, testInfo) => {
        const problems = recordProblems(page);
        await openGallery(page, gallery.slug, theme);

        const axe = await new AxeBuilder({ page }).analyze();
        const violations = axe.violations.flatMap((v) =>
          v.nodes.map(
            (n) =>
              `${v.id} (${v.impact ?? "n/a"}): ${n.target.join(" ")} — ${n.failureSummary ?? v.help}`,
          ),
        );
        expect(violations, `axe violations on #/${gallery.slug} (${theme})`).toEqual([]);

        // The playground scrolls inside <main>; let the document grow so the screenshot holds the whole page.
        await page.addStyleTag({
          content: ".h-dvh { height: auto !important; } main { overflow: visible !important; }",
        });
        await testInfo.attach(`${gallery.slug}-${theme}.png`, {
          body: await page.screenshot({ fullPage: true, animations: "disabled" }),
          contentType: "image/png",
        });

        expect(problems, `console output on #/${gallery.slug} (${theme})`).toEqual([]);
      });
    }
  });
}
