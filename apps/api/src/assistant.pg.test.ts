import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { runs } from "@flowaid/database";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import type {
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
  ToolCall,
} from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const HEALTHY = {
  status: "healthy" as const,
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

type Turn = (req: GenerationRequest) => Partial<GenerationResult>;

/** A tool-calling model that plays scripted turns and records every request. */
function scriptedModel(turns: Turn[], requests: GenerationRequest[]): GenerationProvider {
  return {
    id: "fake",
    model: "m",
    capabilities: {
      tools: true,
      jsonSchema: true,
      vision: false,
      streaming: false,
      thinking: false,
      maxContext: 200_000,
    },
    generate(req): Promise<GenerationResult> {
      requests.push(structuredClone(req));
      const turn = turns.shift();
      if (!turn) return Promise.reject(new Error("no more turns"));
      return Promise.resolve({
        text: "",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 300, outputTokens: 50 },
        costUsd: 0.002,
        priceSnapshot: null,
        latencyMs: 5,
        provider: "fake",
        model: "m",
        ...turn(req),
      });
    },
    stream: () => {
      throw new Error("not used");
    },
    health: () => HEALTHY,
  };
}

const tool = (name: string, args: Record<string, unknown> = {}): Partial<GenerationResult> => ({
  toolCalls: [{ id: `c-${name}-${Math.random()}`, name, args } as ToolCall],
  finishReason: "tool_calls",
});

/** the JSON inside the last tool message the model was shown */
function lastToolData(req: GenerationRequest | undefined): { data: unknown; sources: string[] } {
  const content = req?.messages.filter((m) => m.role === "tool").at(-1)?.content;
  // between the <<<UNTRUSTED …>>> and <<<END UNTRUSTED>>> lines
  const body = (typeof content === "string" ? content : "").split("\n").slice(1, -1).join("\n");
  return JSON.parse(body) as { data: unknown; sources: string[] };
}

describeDb("Ask FlowAId (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let workspaceId: string;
  let supportId: string;
  let billingId: string;
  let failedRunId: string;
  const turns: Turn[] = [];
  const requests: GenerationRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    registry.register({
      id: "fake",
      kind: "generation",
      create: () => scriptedModel(turns, requests),
    });
    t.ctx.providers = registry;
    jar = await login(t.app);
    workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().workspaces[0].id as string;
    const env = (
      (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
    ).find((e) => e.name === "dev")?.id as string;
    const workflow = async (name: string) => {
      const id = (await call(t.app, jar, "POST", "/v1/workflows", { name })).json().id as string;
      const version = (await call(t.app, jar, "POST", `/v1/workflows/${id}/publish`, {})).json()
        .id as string;
      return { id, version };
    };
    const support = await workflow("Support triage");
    const billing = await workflow("Billing sync");
    supportId = support.id;
    billingId = billing.id;
    failedRunId = uuidv7();
    const now = t.clock.now();
    const run = (id: string, wf: { id: string; version: string }, failed: boolean) => ({
      id,
      workspaceId,
      workflowId: wf.id,
      workflowVersionId: wf.version,
      environmentId: env,
      status: (failed ? "failed" : "completed") as never,
      origin: "api" as never,
      mode: "async" as never,
      input: { secret: "customer data that must not reach the model" },
      output: failed ? null : { reply: "private reply" },
      costUsd: "0.02",
      usage: { inputTokens: 10, outputTokens: 5 },
      error: (failed
        ? { code: "E_UPSTREAM", message: "upstream refused the request", retryable: true }
        : null) as never,
      createdAt: new Date(now - 60_000),
      startedAt: new Date(now - 60_000),
      endedAt: new Date(now - 59_000),
    });
    await t.db.app.system((tx) =>
      tx.insert(runs).values([run(failedRunId, support, true), run(uuidv7(), billing, false)]),
    );
  });
  afterAll(() => t.close());

  describe("without a generation model", () => {
    it("reports the assistant off and refuses to answer", async () => {
      expect((await call(t.app, jar, "GET", "/v1/me")).json().features.assistant).toBe(false);
      const res = await call(t.app, jar, "POST", "/v1/assistant/ask", { question: "What failed?" });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("with the workspace's advisor model", () => {
    beforeAll(async () => {
      const res = await call(t.app, jar, "PATCH", `/v1/workspaces/${workspaceId}`, {
        settings: { advisorModel: { provider: "fake", model: "m" } },
      });
      expect(res.statusCode).toBe(200);
    });

    it("answers from the tools, cites what they returned and never sees node I/O", async () => {
      expect((await call(t.app, jar, "GET", "/v1/me")).json().features.assistant).toBe(true);
      turns.push(
        () => tool("list_runs", { status: "failed" }),
        () => tool("get_run", { runId: failedRunId }),
        () =>
          tool("final_answer", {
            statements: [
              {
                text: "Support triage failed once with E_UPSTREAM.",
                kind: "fact",
                sources: [failedRunId],
              },
              { text: "Billing sync failed twice.", kind: "fact", sources: ["made-up-id"] },
              { text: "Check the upstream credential.", kind: "recommendation", sources: [] },
            ],
          }),
      );
      requests.length = 0;
      const res = await call(t.app, jar, "POST", "/v1/assistant/ask", {
        question: "What failed today?",
      });
      expect(res.statusCode).toBe(200);
      const a = res.json();
      expect(a.statements).toEqual([
        {
          text: "Support triage failed once with E_UPSTREAM.",
          kind: "fact",
          sources: [failedRunId],
        },
        { text: "Billing sync failed twice.", kind: "uncertain", sources: [], unverified: true },
        { text: "Check the upstream credential.", kind: "recommendation", sources: [] },
      ]);
      expect(a.sources).toEqual([
        {
          id: failedRunId,
          kind: "run",
          label: `Support triage run ${failedRunId.slice(0, 8)}`,
          workflowId: supportId,
        },
      ]);
      expect(a.toolCalls).toEqual([
        { name: "list_runs", ok: true },
        { name: "get_run", ok: true },
      ]);
      expect(a.model).toEqual({ provider: "fake", model: "m" });
      expect(a.costUsd).toBe(0.006);

      const listed = lastToolData(requests[1]);
      expect(listed.sources).toEqual([failedRunId]);
      const detail = JSON.stringify(lastToolData(requests[2]));
      expect(detail).toContain("E_UPSTREAM");
      // no run inputs or outputs anywhere in what the model saw
      const seen = JSON.stringify(requests.map((r) => r.messages));
      expect(seen).not.toContain("customer data");
      expect(seen).not.toContain("private reply");

      const audit = await t.db.admin<{ details: Record<string, unknown> }[]>`
        select details from audit_events where action = 'assistant.ask'`;
      expect(audit[0]?.details).toMatchObject({
        model: "fake/m",
        tools: ["list_runs", "get_run"],
        unverified: 1,
      });
      expect(JSON.stringify(audit[0]?.details)).not.toContain("What failed");
    });

    it("shows an API key pinned to a workflow only that workflow", async () => {
      const key = (
        await call(t.app, jar, "POST", "/v1/api-keys", {
          name: "billing only",
          scopes: ["runs:read"],
          workflowIds: [billingId],
        })
      ).json().key as string;
      turns.push(
        () => tool("list_runs"),
        () => tool("get_run", { runId: failedRunId }),
        () =>
          tool("final_answer", { statements: [{ text: "Nothing failed.", kind: "uncertain" }] }),
      );
      requests.length = 0;
      const res = await t.app.inject({
        method: "POST",
        url: "/v1/assistant/ask",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        payload: { question: "What failed?" },
      });
      expect(res.statusCode).toBe(200);
      const listed = lastToolData(requests[1]).data as { workflowId: string }[];
      expect(listed.map((r) => r.workflowId)).toEqual([billingId]);
      // the other workflow's run is invisible, not merely unlisted
      expect(requests[2]?.messages.at(-1)?.content).toBe(`error: run ${failedRunId} not found`);
      expect(res.json().toolCalls).toEqual([
        { name: "list_runs", ok: true },
        { name: "get_run", ok: false },
      ]);
    });

    it("validates questions", async () => {
      const res = await call(t.app, jar, "POST", "/v1/assistant/ask", { question: "?" });
      expect(res.statusCode).toBe(400);
    });
  });
});
