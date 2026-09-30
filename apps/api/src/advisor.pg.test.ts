import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builderPromptHash } from "@flowaid/advisor";
import { describeDb } from "@flowaid/database/testing";
import { DefaultModelCatalog, ProviderRegistry, booleanDecision } from "@flowaid/providers";
import type {
  DecisionProvider,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
} from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const HEALTHY = {
  status: "healthy" as const,
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

/** A generation model that answers with the queued definitions, recording each request. */
function fakeGeneration(answers: unknown[], requests: GenerationRequest[]): GenerationProvider {
  return {
    id: "fake",
    model: "m",
    capabilities: {
      tools: false,
      jsonSchema: true,
      vision: false,
      streaming: false,
      thinking: false,
      maxContext: 200_000,
    },
    generate(req): Promise<GenerationResult> {
      requests.push(req);
      const next = answers.shift();
      if (next === undefined) return Promise.reject(new Error("no more answers"));
      return Promise.resolve({
        text: "",
        structured: next as never,
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 500, outputTokens: 100 },
        costUsd: 0.001,
        priceSnapshot: null,
        latencyMs: 5,
        provider: "fake",
        model: "m",
      });
    },
    stream: () => {
      throw new Error("not used");
    },
    health: () => HEALTHY,
  };
}

/** A judge that always says "not safe unattended" with confidence 0.8. */
const fakeDecision = (): DecisionProvider => {
  const meta = { provider: "fake", model: "judge", latencyMs: 1, costUsd: 0 };
  return {
    id: "fake",
    model: "judge",
    capabilities: {
      batch: false,
      maxQuestions: 1,
      maxStateTokens: 10_000,
      kinds: ["boolean"],
      text: true,
      images: false,
    },
    decideBoolean: () => Promise.resolve(booleanDecision(0.2, meta)),
    decideChoice: () => Promise.reject(new Error("not used")),
    decideScore: () => Promise.reject(new Error("not used")),
    batch: () => Promise.reject(new Error("not used")),
    health: () => HEALTHY,
  };
};

const port = (node: string, p: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port: p, ...(path ? { path } : {}) },
});

/** Input → an expensive generation → output. */
const definition = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  name: "Reply",
  inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
  outputs: { type: "object", properties: { reply: { type: "string" } } },
  secrets: [{ name: "ANTHROPIC_API_KEY", credentialType: "anthropic.api_key" }],
  execution: { maxCostUsd: 0.5 },
  nodes: [
    { id: "ticket", kind: "input", name: "Ticket" },
    {
      id: "reply",
      kind: "task",
      name: "Reply",
      type: "flowaid.ai.generate",
      typeVersion: "1.0.0",
      config: { model: { provider: "anthropic", model: "claude-opus-5-5" }, temperature: 0 },
      inputs: { prompt: { kind: "template", source: "Reply to: {{ ticket.message }}" } },
      credentials: { llm: "ANTHROPIC_API_KEY" },
    },
    {
      id: "done",
      kind: "output",
      name: "Done",
      value: { kind: "object", fields: { reply: port("reply", "text") } },
    },
  ],
  edges: [
    { id: "e1", from: { node: "ticket", port: "done" }, to: { node: "reply" } },
    { id: "e2", from: { node: "reply", port: "done" }, to: { node: "done" } },
  ],
};

describeDb("advisor: AI builder, critic and cost optimizer (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let workspaceId: string;
  let workflowId: string;
  const answers: unknown[] = [];
  const requests: GenerationRequest[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    registry.register({
      id: "fake",
      kind: "generation",
      create: () => fakeGeneration(answers, requests),
    });
    registry.register({ id: "fake", kind: "decision", create: fakeDecision });
    t.ctx.providers = registry;
    jar = await login(t.app);
    workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().workspaces[0].id as string;
    const created = await call(t.app, jar, "POST", "/v1/workflows", { name: "Reply", definition });
    expect(created.statusCode).toBe(201);
    workflowId = created.json().id as string;
  });
  afterAll(async () => {
    await t.close();
  });

  describe("without a generation model", () => {
    it("reports ai_builder off (advisor on) and refuses to generate", async () => {
      const features = (await call(t.app, jar, "GET", "/v1/me")).json().features;
      expect(features).toMatchObject({ advisor: true, ai_builder: false });
      const res = await call(t.app, jar, "POST", "/v1/workflows/ai/generate", {
        prompt: "Reply to support tickets",
      });
      expect(res.statusCode).toBe(409);
      const fill = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/sample-inputs`, {
        scenario: "typical",
      });
      expect(fill.statusCode).toBe(409);
      expect(fill.json().error.message).toMatch(/No text model/);
    });
  });

  describe("with the workspace's advisor model", () => {
    beforeAll(async () => {
      const res = await call(t.app, jar, "PATCH", `/v1/workspaces/${workspaceId}`, {
        settings: {
          advisorModel: { provider: "fake", model: "m" },
          defaultDecisionChain: [{ provider: "custom", id: "fake" }, { provider: "human" }],
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("turns ai_builder on", async () => {
      const features = (await call(t.app, jar, "GET", "/v1/me")).json().features;
      expect(features.ai_builder).toBe(true);
    });

    it("generates through the registry and repairs compiler errors", async () => {
      const { $schema: _s, ...body } = definition;
      answers.push(
        { rationale: "first", definition: { ...body, nodes: body.nodes.slice(0, 2), edges: [] } },
        { rationale: "One generation, then the reply.", definition: body },
      );
      const res = await call(t.app, jar, "POST", "/v1/workflows/ai/generate", {
        prompt: "Reply to support tickets",
      });
      expect(res.statusCode).toBe(200);
      const out = res.json();
      expect(out.iterations).toBe(2);
      expect(out.model).toEqual({ provider: "fake", model: "m" });
      expect(out.rationale).toBe("One generation, then the reply.");
      expect(out.diagnostics.filter((d: { severity: string }) => d.severity === "error")).toEqual(
        [],
      );
      expect(out.definition.nodes.map((n: { id: string }) => n.id)).toEqual([
        "ticket",
        "reply",
        "done",
      ]);
      // the system prompt carried the workspace's catalog; the repair round the compiler's errors
      expect(requests[0]?.messages[0]?.content).toMatch(/flowaid\.ai\.generate/);
      expect(requests[1]?.messages.at(-1)?.content).toMatch(/E_/);
      const audit = await t.db.admin<{ details: { iterations: number; promptHash: string } }[]>`
        select details from audit_events where action = 'workflow.ai_generate'`;
      expect(audit[0]?.details.iterations).toBe(2);
      expect(audit[0]?.details.promptHash).toBe(builderPromptHash());
    });

    it("writes run inputs that pass the run's own input check, keeping entered values", async () => {
      requests.length = 0;
      answers.push({
        samples: [
          {
            title: "Double charge",
            why: "A billing question.",
            input: { message: "Charged twice" },
          },
          // fails the input schema (message must be a string) and is sent back once
          { title: "Broken", why: "Wrong type.", input: { message: 42 } },
        ],
      });
      answers.push({
        samples: [
          {
            title: "Double charge",
            why: "A billing question.",
            input: { message: "Charged twice" },
          },
          { title: "Still broken", why: "Wrong type.", input: { message: 7 } },
        ],
      });
      const res = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/sample-inputs`, {
        scenario: "edge",
        instructions: "a customer charged twice",
        count: 2,
      });
      expect(res.statusCode).toBe(200);
      const out = res.json();
      expect(out.samples).toEqual([
        { title: "Double charge", why: "A billing question.", input: { message: "Charged twice" } },
      ]);
      expect(out).toMatchObject({ rejected: 1, model: { provider: "fake", model: "m" } });
      expect(out.costUsd).toBeCloseTo(0.002);
      expect(requests[0]?.messages[1]?.content).toContain("a customer charged twice");
      const repair = requests[1]?.messages.filter((m) => m.role === "user").at(-1);
      expect(repair?.content).toContain("/message must be string");
      // nothing about the workflow's secrets reaches the model
      expect(JSON.stringify(requests)).not.toContain("ANTHROPIC_API_KEY");
      const audit = await t.db.admin<{ details: { samples: number; rejected: number } }[]>`
        select details from audit_events where action = 'workflow.ai_sample_inputs'`;
      expect(audit[0]?.details).toMatchObject({ samples: 1, rejected: 1, scenario: "edge" });

      // values the person entered stay; an unsaved definition from the builder is used as sent
      answers.push({ samples: [{ title: "T", why: "w", input: { message: "changed" } }] });
      const kept = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/sample-inputs`, {
        current: { message: "Where is my order?" },
        keep: ["message"],
        count: 1,
        definition: { ...definition, name: "Reply (edited)" },
      });
      expect(kept.json().samples[0].input).toEqual({ message: "Where is my order?" });
      expect(requests.at(-1)?.messages[1]?.content).toContain("Reply (edited)");
    });

    it("critiques with the rubric and the decision chain's judge", async () => {
      const res = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/critique`, {
        judge: true,
      });
      expect(res.statusCode).toBe(200);
      const { advice, checks } = res.json() as {
        advice: { rule: string; source: string; fix?: { patch: unknown[] } }[];
        checks: string[];
      };
      expect(checks.length).toBeGreaterThan(3);
      expect(advice.map((a) => a.rule)).toContain("no_evaluation_set");
      expect(advice.find((a) => a.source === "judge")).toBeDefined();
      // the workspace chain has a failover, so the rule is quiet
      expect(advice.map((a) => a.rule)).not.toContain("no_failover");
      const plain = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/critique`, {});
      expect(plain.json().advice.some((a: { source: string }) => a.source === "judge")).toBe(false);
    });

    it("rate-limits judged critiques like generation, not the rubric alone", async () => {
      const judged: number[] = [];
      for (let i = 0; i < 21; i += 1)
        judged.push(
          (
            await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/critique`, {
              judge: true,
            })
          ).statusCode,
        );
      // one judged call was made by the previous test in this minute
      expect(judged.filter((c) => c === 429).length).toBeGreaterThan(0);
      const plain = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/ai/critique`, {});
      expect(plain.statusCode).toBe(200);
    });

    it("suggests a cheaper model from 30 days of node runs", async () => {
      const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
        id: string;
        name: string;
      }[];
      const version = (
        await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})
      ).json();
      const env = envs[0]?.id as string;
      const empty = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/optimize`, {});
      expect(empty.json().suggestions).toEqual([]);
      await t.db.admin`
        with seeded as (
          insert into runs (id, workspace_id, workflow_id, workflow_version_id, environment_id,
                            status, origin, mode, input)
          select gen_random_uuid(), ${workspaceId}, ${workflowId}, ${version.id as string}, ${env},
                 'completed', 'api', 'async', ${t.db.admin.json({ message: "hi" })}
            from generate_series(1, 25)
          returning id)
        insert into node_runs (id, run_id, workspace_id, node_id, kind, node_type, node_name,
                               status, usage, cost_usd, latency_ms, scheduled_seq, started_at,
                               input_hash)
        select gen_random_uuid(), seeded.id, ${workspaceId}, 'reply', 'task', 'flowaid.ai.generate',
               'Reply', 'completed',
               ${t.db.admin.json({ inputTokens: 2000, outputTokens: 600 })}, 0.04, 900, 2,
               now() - interval '1 day', md5(seeded.id::text)
          from seeded`;
      const res = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/optimize`, {});
      expect(res.statusCode).toBe(200);
      const out = res.json();
      expect(out.window.runs).toBe(25);
      const cheaper = out.suggestions.find((s: { kind: string }) => s.kind === "cheaper_model");
      expect(cheaper).toMatchObject({ nodeIds: ["reply"] });
      expect(cheaper.estimatedSavingsUsdPerRun).toBeGreaterThan(0);
      expect(cheaper.fix.length).toBeGreaterThan(0);
      expect(out.diagnostics[0]).toMatchObject({ code: "I_COST_SUGGESTION", severity: "info" });
      // nothing repeats, so no caching suggestion
      expect(out.suggestions.some((s: { kind: string }) => s.kind === "cache_safe_node")).toBe(
        false,
      );
    });
  });
});
