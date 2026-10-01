/**
 * `pnpm loadtest`: a dependency-free load test against a running FlowAId API (local mode).
 *
 *   pnpm loadtest -- --api http://flowaid.localhost:3001 --duration 20 --concurrency 1,10,50
 *
 * It signs in through the loopback-only local sign-in, creates a temporary workflow that calls no
 * model or paid service (input → transform → output), then for each concurrency level runs
 *   reads:  GET /v1/workflows and GET /v1/runs, alternating
 *   runs:   POST /v1/workflows/:id/run (draft, sync): API, queue, worker and run store end to end
 * for `--duration` seconds each, and prints requests per second, latency percentiles and errors
 * (rate-limited answers are counted apart). The workflow and its runs' workflow are deleted after.
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    api: { type: "string", default: "http://flowaid.localhost:3001" },
    duration: { type: "string", default: "20" },
    concurrency: { type: "string", default: "1,10,50" },
    scenarios: { type: "string", default: "reads,runs" },
    json: { type: "string" },
  },
});
const API = values.api.replace(/\/+$/, "");
const DURATION_MS = Number(values.duration) * 1000;
const LEVELS = values.concurrency
  .split(",")
  .map(Number)
  .filter((n) => n > 0);
const SCENARIOS = values.scenarios.split(",");

let cookie = "";
let workspace = "";
const headers = (json = false): Record<string, string> => ({
  "x-requested-with": "flowaid",
  ...(cookie ? { cookie } : {}),
  ...(workspace ? { "x-workspace": workspace } : {}),
  ...(json ? { "content-type": "application/json" } : {}),
});

async function signIn(): Promise<void> {
  const res = await fetch(`${API}/v1/auth/local`, { method: "POST", headers: headers() });
  if (!res.ok) throw new Error(`local sign-in failed (${res.status}): ${await res.text()}`);
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const me = (await (await fetch(`${API}/v1/me`, { headers: headers() })).json()) as {
    workspaces: { slug: string }[];
  };
  workspace = me.workspaces[0]?.slug ?? "";
  if (!workspace) throw new Error("no workspace");
}

const ref = (node: string, port: string) => ({ kind: "ref", ref: { kind: "port", node, port } });
const DEFINITION = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  name: "Load test (temporary)",
  inputs: {
    type: "object",
    required: ["amount"],
    properties: { amount: { type: "number" } },
  },
  outputs: { type: "object" },
  nodes: [
    { id: "start", kind: "input", name: "Input" },
    {
      id: "calc",
      kind: "task",
      name: "Compute",
      type: "flowaid.data.transform",
      typeVersion: "1.0.0",
      config: {
        expr: "{ total: start.amount * 1.2, big: start.amount > 100 }",
        output: {
          type: "object",
          properties: { total: { type: "number" }, big: { type: "boolean" } },
        },
      },
      inputs: {},
      credentials: {},
    },
    { id: "done", kind: "output", name: "Done", value: ref("calc", "result") },
  ],
  edges: [
    { id: "e1", from: { node: "start", port: "done" }, to: { node: "calc" } },
    { id: "e2", from: { node: "calc", port: "done" }, to: { node: "done" } },
  ],
};

interface Sample {
  ms: number;
  status: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)] as number;
}

async function drive(concurrency: number, once: (i: number) => Promise<number>): Promise<Sample[]> {
  const samples: Sample[] = [];
  const stopAt = performance.now() + DURATION_MS;
  let n = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < stopAt) {
        const started = performance.now();
        let status = 0;
        try {
          status = await once(n++);
        } catch {
          status = 0;
        }
        samples.push({ ms: performance.now() - started, status });
      }
    }),
  );
  return samples;
}

function summarize(name: string, concurrency: number, samples: Sample[]) {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300);
  const limited = samples.filter((s) => s.status === 429).length;
  const errors = samples.length - ok.length - limited;
  const ms = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    scenario: name,
    concurrency,
    requests: samples.length,
    rps: Math.round((samples.length / (DURATION_MS / 1000)) * 10) / 10,
    p50: Math.round(percentile(ms, 50)),
    p95: Math.round(percentile(ms, 95)),
    p99: Math.round(percentile(ms, 99)),
    max: Math.round(ms.at(-1) ?? NaN),
    rateLimited: limited,
    errors,
  };
}

async function main(): Promise<void> {
  await signIn();
  const created = await fetch(`${API}/v1/workflows`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ name: `Load test ${Date.now()}`, definition: DEFINITION }),
  });
  if (created.status !== 201)
    throw new Error(`could not create the workflow: ${await created.text()}`);
  const workflowId = ((await created.json()) as { id: string }).id;
  const results: ReturnType<typeof summarize>[] = [];
  try {
    for (const c of LEVELS) {
      if (SCENARIOS.includes("reads")) {
        const s = await drive(c, async (i) => {
          const r = await fetch(`${API}${i % 2 ? "/v1/runs?limit=50" : "/v1/workflows?limit=50"}`, {
            headers: headers(),
          });
          await r.arrayBuffer();
          return r.status;
        });
        results.push(summarize("reads", c, s));
      }
      if (SCENARIOS.includes("runs")) {
        const s = await drive(c, async (i) => {
          const r = await fetch(`${API}/v1/workflows/${workflowId}/run`, {
            method: "POST",
            headers: headers(true),
            body: JSON.stringify({ draft: true, mode: "sync", input: { amount: i % 250 } }),
          });
          const body = (await r.json()) as { status?: string };
          // a sync run that did not complete counts as an error
          return r.status === 200 && body.status !== "completed" ? 500 : r.status;
        });
        results.push(summarize("runs", c, s));
      }
      console.error(`done: concurrency ${c}`);
    }
  } finally {
    const removed = await fetch(`${API}/v1/workflows/${workflowId}?purge=true`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!removed.ok)
      console.error(
        `could not delete the test workflow ${workflowId} (${removed.status}); delete it by hand`,
      );
  }
  console.table(results);
  if (values.json) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      values.json,
      `${JSON.stringify({ api: API, durationS: DURATION_MS / 1000, results }, null, 2)}\n`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
