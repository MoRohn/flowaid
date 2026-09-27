/**
 * A TypeSafe decision workflow (UPGRADE_PLAN P5-03). In CI the stack runs with
 * FLOWAID_PROVIDER_FIXTURES=replay, so the decision is answered from fixtures/providers/typesafe.json
 * and no key or network is needed; record new fixtures with FLOWAID_PROVIDER_FIXTURES=record and
 * TYPESAFE_API_KEY in .env.local. The definition and message must stay byte-for-byte what was
 * recorded: the fixture key is a hash of the request.
 */
import { expect, test } from "@playwright/test";
import { apiHeaders, signIn } from "./helpers.ts";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

const NAME = `Decision ${Date.now().toString(36)}`;
const DEFINITION = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  id: "5b0d8e2a-6c1f-4a3e-9d7b-2e8f1c4a6b30",
  name: NAME,
  inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
  outputs: { type: "object", properties: { urgent: {}, confidence: {} } },
  secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: false }],
  nodes: [
    { id: "ticket", kind: "input", name: "Ticket" },
    {
      id: "judge",
      kind: "task",
      type: "flowaid.decision.boolean",
      typeVersion: "1.0.0",
      name: "Urgent?",
      config: { instructions: "Is this support message urgent?" },
      inputs: { state: ref("ticket", "message") },
      credentials: { typesafe: "TYPESAFE_API_KEY" },
    },
    {
      id: "done",
      kind: "output",
      name: "Decision",
      value: {
        kind: "object",
        fields: {
          urgent: ref("judge", "decision", "/value"),
          confidence: ref("judge", "decision", "/confidence"),
        },
      },
    },
  ],
  edges: [
    { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "judge" } },
    { id: "e2", from: { node: "judge", port: "done" }, to: { node: "done" } },
  ],
};
const MESSAGE = "Production is down: every customer gets a 500 at checkout.";

test("a TypeSafe decision runs end to end and is shown in the trace", async ({ page }) => {
  const ws = await signIn(page);
  const headers = apiHeaders(ws);

  const created = await page.request.post("/v1/workflows", {
    headers,
    data: { name: NAME, definition: DEFINITION },
  });
  expect(created.status(), await created.text()).toBe(201);
  const workflowId = ((await created.json()) as { id: string }).id;

  const run = await page.request.post(`/v1/workflows/${workflowId}/run`, {
    headers,
    data: { input: { message: MESSAGE }, draft: true, mode: "sync", waitTimeoutMs: 60_000 },
  });
  const body = (await run.json()) as {
    run_id: string;
    status: string;
    output?: { urgent: unknown; confidence: unknown };
  };
  expect(body.status, JSON.stringify(body)).toBe("completed");
  expect(body.output?.urgent).toBe(true);
  expect(body.output?.confidence).toEqual(expect.any(Number));

  const events = (await (
    await page.request.get(`/v1/runs/${body.run_id}/events?types=DECISION_COMPLETED`, { headers })
  ).json()) as { items: { decision?: { provider: string; model: string } }[] };
  expect(events.items[0]?.decision).toMatchObject({ provider: "typesafe" });

  await page.goto(`/${ws}/runs/${body.run_id}`);
  await expect(page.getByText("Completed").first()).toBeVisible();
  await expect(page.getByText("Urgent?").first()).toBeVisible();
});
