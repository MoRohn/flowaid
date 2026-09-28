/**
 * The acceptance journey (UPGRADE_PLAN P5-03, API.md §12.4) without provider keys: sign in,
 * import a workflow, run the draft and watch it wait for a person, answer through an external
 * review link opened with no session, see the run complete, publish v1 to dev, and run the
 * deployed version with an environment-pinned API key.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const NAME = `Acceptance ${Date.now().toString(36)}`;
const DEFINITION = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  id: "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09",
  name: NAME,
  inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
  outputs: { type: "object", properties: { reply: { type: "string" } } },
  nodes: [
    { id: "ticket", kind: "input", name: "Ticket" },
    {
      id: "review",
      kind: "human",
      name: "Review reply",
      mode: { type: "approval" },
      title: { kind: "template", source: "Reply to: {{ ticket.message }}" },
      externalReview: true,
    },
    {
      id: "done",
      kind: "output",
      name: "Reply",
      value: {
        kind: "object",
        fields: { reply: { kind: "template", source: "Approved: {{ ticket.message }}" } },
      },
    },
  ],
  edges: [
    { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "review" } },
    { id: "e2", from: { node: "review", port: "approved" }, to: { node: "done" } },
  ],
};

test.describe.configure({ mode: "serial" });

test("import → run → external review → publish → API run", async ({ page, browser }) => {
  const ws = await signIn(page);

  // Import the definition as a new workflow; the builder opens with a clean compile.
  await page.goto(`/${ws}/workflows/new`);
  await page.getByLabel("Definition").click();
  await page.keyboard.insertText(JSON.stringify(DEFINITION, null, 2));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${ws}/workflows/[0-9a-f-]{36}$`));
  const workflowId = new URL(page.url()).pathname.split("/").at(-1) as string;
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Problems/ })).toBeVisible();

  // Run the draft: it pauses on the human node.
  await page
    .getByRole("textbox", { name: /message/i })
    .first()
    .fill("Where is my order?");
  const started = page.waitForResponse(
    (r) => r.url().endsWith(`/v1/workflows/${workflowId}/run`) && r.status() === 202,
  );
  await page.getByRole("button", { name: "Run draft" }).click();
  const runId = ((await (await started).json()) as { run_id: string }).run_id;
  await expect(page.getByRole("tab", { name: /Trace/ })).toHaveAttribute("data-state", "active");
  await expect(page.getByText("waiting").first()).toBeVisible();

  // The inbox has the task; create an external review link.
  await page.goto(`/${ws}/human-tasks`);
  await page
    .getByRole("row", { name: /Reply to: Where is my order\?/ })
    .first()
    .getByRole("button", { name: /Review/ })
    .click();
  await expect(page).toHaveURL(/\/human-tasks\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Review link", { exact: true }).first().inputValue();
  expect(link).toMatch(/\/review#t=[\w-]{40,}$/);

  // A reviewer with no session answers through the link; the token never reaches the server log.
  const outsider = await browser.newContext();
  const review = await outsider.newPage();
  await review.goto(link);
  await expect(review.getByText("Reply to: Where is my order?")).toBeVisible();
  expect(review.url()).not.toContain("#t=");
  await review.getByRole("button", { name: "Approve" }).click();
  await expect(review.getByText("Thank you, your response was recorded")).toBeVisible();
  // single use: the same link now answers nothing
  await review.goto("about:blank");
  await review.goto(link);
  await expect(review.getByText("This review link no longer works")).toBeVisible();
  await outsider.close();

  // The run resumed and completed with the reply.
  await page.goto(`/${ws}/runs/${runId}`);
  await expect(page.getByText("Completed").first()).toBeVisible();
  await page.getByRole("tab", { name: "Output" }).click();
  await expect(page.getByText("Approved: Where is my order?").first()).toBeVisible();

  // Publish v1 and deploy it to dev.
  await page.goto(`/${ws}/workflows/${workflowId}`);
  await page.getByRole("button", { name: "Publish" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("dev").check();
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published v1/)).toBeVisible();

  // An API key pinned to dev runs the deployed version.
  const envs = (await (
    await page.request.get("/v1/environments", { headers: { "x-workspace": ws } })
  ).json()) as { id: string; name: string }[];
  const dev = envs.find((e) => e.name === "dev")?.id as string;
  const key = await page.request.post("/v1/api-keys", {
    headers: { "x-workspace": ws, "x-requested-with": "flowaid" },
    data: { name: `${NAME} key`, scopes: ["runs:create", "runs:read"], environmentId: dev },
  });
  expect(key.status()).toBe(201);
  const secret = ((await key.json()) as { key: string }).key;
  const run = await page.request.post(`/v1/workflows/${workflowId}/run`, {
    headers: { authorization: `Bearer ${secret}` },
    data: { input: { message: "Refund?" }, mode: "sync", waitTimeoutMs: 20_000 },
  });
  expect(run.status()).toBe(202);
  expect(await run.json()).toMatchObject({
    status: "waiting_for_human",
    human_task: { id: expect.any(String) },
  });
});
