/**
 * Secret canaries (UPGRADE_PLAN P5-03): unique values go into a credential (created, then rotated),
 * a run that sends the credential and fails, and a wrong password at sign-in. None of them may
 * come back from the API or appear in the stack's logs. `E2E_STACK_LOG` names the log to search
 * (the e2e workflow writes stack.log); the canaries are also written to
 * test-results/secret-canaries.txt so the workflow can search the logs again once every spec ran.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiHeaders, credentials, signIn } from "./helpers.ts";

const canary = (label: string) => `fa-canary-${label}-${randomBytes(12).toString("hex")}`;
const CANARIES = {
  created: canary("created"),
  rotated: canary("rotated"),
  password: canary("password"),
};

const ref = (node: string, port: string) => ({ kind: "ref", ref: { kind: "port", node, port } });

test.beforeAll(() => {
  mkdirSync("test-results", { recursive: true });
  appendFileSync("test-results/secret-canaries.txt", `${Object.values(CANARIES).join("\n")}\n`);
});

test("secret values never come back from the API or reach the logs", async ({ page }) => {
  const ws = await signIn(page);
  const headers = apiHeaders(ws);
  const seen: string[] = [];
  const keep = async (response: { text(): Promise<string> }) => {
    const text = await response.text();
    seen.push(text);
    return text;
  };

  // A bearer credential, read back and rotated.
  const created = await page.request.post("/v1/credentials", {
    headers,
    data: {
      name: `Canary ${Date.now()}`,
      type: "http.bearer",
      values: { token: CANARIES.created },
    },
  });
  expect(created.status(), await keep(created)).toBe(201);
  const credentialId = ((await created.json()) as { id: string }).id;
  await keep(await page.request.get(`/v1/credentials/${credentialId}`, { headers }));
  await keep(await page.request.get("/v1/credentials", { headers }));

  // A run sends it to an address the safe fetch refuses; the failure must not echo the token.
  const name = `Canary run ${Date.now().toString(36)}`;
  const workflow = await page.request.post("/v1/workflows", {
    headers,
    data: {
      name,
      definition: {
        $schema: "https://flowaid.dev/schemas/workflow/v1",
        id: "0c6f2d4e-8a1b-4c3d-9e5f-7a2b4c6d8e10",
        name,
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: { status: {} } },
        secrets: [{ name: "API_TOKEN", credentialType: "http.bearer", required: true }],
        nodes: [
          { id: "start", kind: "input", name: "Start" },
          {
            id: "call",
            kind: "task",
            type: "flowaid.tools.http",
            typeVersion: "1.0.0",
            name: "Call",
            config: { method: "GET", url: "http://169.254.169.254/latest/meta-data/" },
            credentials: { auth: "API_TOKEN" },
          },
          {
            id: "done",
            kind: "output",
            name: "Done",
            value: { kind: "object", fields: { status: ref("call", "status") } },
          },
        ],
        edges: [
          { id: "e1", from: { node: "start", port: "done" }, to: { node: "call" } },
          { id: "e2", from: { node: "call", port: "done" }, to: { node: "done" } },
        ],
      },
    },
  });
  expect(workflow.status(), await keep(workflow)).toBe(201);
  const workflowId = ((await workflow.json()) as { id: string }).id;
  const envs = (await (await page.request.get("/v1/environments", { headers })).json()) as {
    id: string;
    name: string;
  }[];
  const dev = envs.find((e) => e.name === "dev")?.id as string;
  const bound = await page.request.put(`/v1/workflows/${workflowId}/secrets/${dev}`, {
    headers,
    data: { API_TOKEN: credentialId },
  });
  expect(bound.status(), await keep(bound)).toBe(200);

  const rotated = await page.request.post(`/v1/credentials/${credentialId}/rotate`, {
    headers,
    data: { values: { token: CANARIES.rotated } },
  });
  expect(rotated.status(), await keep(rotated)).toBe(200);

  const run = await page.request.post(`/v1/workflows/${workflowId}/run`, {
    headers,
    data: { input: {}, draft: true },
  });
  const started = await keep(run);
  expect(run.status(), started).toBe(202);
  const runId = (JSON.parse(started) as { run_id: string }).run_id;
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/v1/runs/${runId}`, { headers })).json()) as {
            status: string;
          }
        ).status,
      { timeout: 30_000 },
    )
    .toBe("failed");
  await keep(await page.request.get(`/v1/runs/${runId}`, { headers }));
  await keep(await page.request.get(`/v1/runs/${runId}/events?limit=1000`, { headers }));
  await keep(await page.request.get(`/v1/runs/${runId}/node-runs`, { headers }));

  // A wrong password is refused and not logged either.
  const log = process.env["E2E_STACK_LOG"];
  const logOffset = log && existsSync(log) ? statSync(log).size : 0;
  const login = await page.request.post("/v1/auth/login", {
    headers: { "x-requested-with": "flowaid" },
    data: { email: credentials().email, password: CANARIES.password },
  });
  expect(login.status()).toBe(401);
  await keep(login);

  for (const value of Object.values(CANARIES))
    for (const text of seen) expect(text).not.toContain(value);

  if (log) {
    expect(existsSync(log), `${log} exists`).toBe(true);
    // The processes have flushed what they logged about these requests once the API's log line
    // for the refused sign-in (the last request, logged at LOG_LEVEL=info as the e2e workflow
    // runs the stack) is in the log.
    await expect
      .poll(() => readFileSync(log, "utf8").slice(logOffset).includes('"statusCode":401'), {
        timeout: 15_000,
        message: `the refused sign-in reaches ${log}`,
      })
      .toBe(true);
    const contents = readFileSync(log, "utf8");
    for (const [label, value] of Object.entries(CANARIES))
      expect(contents.includes(value), `the ${label} canary is in ${log}`).toBe(false);
  }
});
