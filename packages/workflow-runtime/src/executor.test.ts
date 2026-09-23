import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNode, fail, ok, suspend, type AnyNodeDefinition } from "@flowaid/node-sdk";
import { ProviderRegistry, DefaultModelCatalog } from "@flowaid/providers";
import { Redactor } from "@flowaid/credentials";
import type { ExecutionPlan, GenerationProvider, JsonObject } from "@flowaid/workflow-core";
import { evalScope, evaluateBinding, evaluateRecord, portValue, setPointer } from "./bindings.js";
import { executeTask, NodeRegistry, type ExecutionCall } from "./executor.js";
import { registryProviderAccess } from "./providers.js";
import { createEventRedactor } from "./redaction.js";
import { initialState } from "./state.js";
import type { NodeEmitted } from "./step.js";
import { planOf, transform } from "./test/plans.js";

const meta = { name: "n", description: "n", category: "developer" as const, icon: "box", tags: [] };
const base = { version: "1.0.0", metadata: meta, idempotency: "safe" as const };
const plan: ExecutionPlan = planOf({
  nodes: [
    { id: "start", kind: "input", name: "in" },
    { ...transform("a", "start.x"), policy: { timeoutMs: 50 } },
    {
      id: "out",
      kind: "output",
      name: "out",
      value: { kind: "ref", ref: { kind: "port", node: "a", port: "result" } },
    },
  ],
});
const nodeA = plan.nodes.a;
if (!nodeA) throw new Error("no node a");

function callFor(events: NodeEmitted[] = [], signal = new AbortController().signal): ExecutionCall {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    workflowId: plan.workflowId,
    workflowVersionId: "00000000-0000-4000-8000-000000000003",
    environmentId: "00000000-0000-4000-8000-000000000004",
    environment: "test",
    origin: "api",
    startedAt: "2026-09-23T10:00:00.000Z",
    sessionId: null,
    nodeRunId: "00000000-0000-4000-8000-000000000005",
    node: nodeA as NonNullable<typeof nodeA>,
    scope: "",
    attempt: 1,
    idempotencyKey: null,
    vars: {},
    iteration: {},
    signal,
    emit: (e) => events.push(e),
    budget: { remainingCostUsd: null, remainingTokens: null, deadlineAt: null },
  };
}

const transformDef = (
  execute: AnyNodeDefinition["execute"],
  extra: Partial<AnyNodeDefinition> = {},
): AnyNodeDefinition => ({
  ...base,
  id: "flowaid.data.transform",
  configSchema: z.object({ expr: z.unknown(), output: z.unknown().optional() }),
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.number() }),
  capabilities: [],
  execute,
  ...extra,
});

const run = (
  def: ReturnType<typeof transformDef>,
  config: JsonObject = { expr: 1 },
  call = callFor(),
) => executeTask(plan, new NodeRegistry([], [def]), {}, { call, input: {}, config });

describe("executeTask", () => {
  it("returns the node's output with its logs and metrics as events", async () => {
    const r = await run(
      transformDef((ctx) => {
        ctx.logger.info("hello", { a: 1 });
        ctx.events.emit({ type: "METRIC", name: "rows", value: 3 });
        return Promise.resolve(ok({ result: 7 }));
      }),
    );
    expect(r).toMatchObject({ kind: "ok", output: { result: 7 } });
    expect(r.events?.map((e) => e.type)).toEqual(["LOG", "METRIC"]);
  });

  it("rejects bad config, bad input and bad output", async () => {
    const def = transformDef(() => Promise.resolve(ok({ result: "nope" as never })));
    const out = await run(def);
    expect(out).toMatchObject({ kind: "error", error: { code: "OUTPUT_SCHEMA_MISMATCH" } });
    const strict = defineNode({
      ...base,
      id: "flowaid.data.transform",
      configSchema: z.object({ expr: z.string() }),
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      capabilities: [],
      execute: () => Promise.resolve(ok({})),
    });
    expect(
      await executeTask(
        plan,
        new NodeRegistry([], [strict as never]),
        {},
        { call: callFor(), input: {}, config: { expr: 1 } },
      ),
    ).toMatchObject({ kind: "error", error: { code: "SCHEMA_VALIDATION_ERROR" } });
    const needsInput = defineNode({
      ...base,
      id: "flowaid.data.transform",
      configSchema: z.object({ expr: z.unknown() }),
      inputSchema: z.object({ v: z.number() }),
      outputSchema: z.object({}),
      capabilities: [],
      execute: () => Promise.resolve(ok({})),
    });
    expect(
      await executeTask(
        plan,
        new NodeRegistry([], [needsInput as never]),
        {},
        { call: callFor(), input: {}, config: { expr: 1 } },
      ),
    ).toMatchObject({ kind: "error", error: { code: "SCHEMA_VALIDATION_ERROR" } });
  });

  it("reports a missing executor, thrown errors and failures", async () => {
    expect(
      await executeTask(plan, new NodeRegistry(), {}, { call: callFor(), input: {}, config: {} }),
    ).toMatchObject({ kind: "error", error: { code: "NOT_FOUND" } });
    expect(await run(transformDef(() => Promise.reject(new Error("kaput"))))).toMatchObject({
      kind: "error",
      error: { message: "kaput" },
    });
    expect(await run(transformDef(() => Promise.resolve(fail(new Error("soft")))))).toMatchObject({
      kind: "error",
    });
  });

  it("times out, and aborts with the run", async () => {
    const hang = transformDef(() => new Promise(() => undefined));
    expect(await run(hang)).toMatchObject({
      kind: "error",
      error: { code: "TIMEOUT_ERROR", retryable: true },
    });
    const controller = new AbortController();
    const pending = run(hang, { expr: 1 }, callFor([], controller.signal));
    controller.abort(new Error("run cancelled"));
    expect(await pending).toMatchObject({ kind: "error" });
  });

  it("refuses suspension without the suspend capability", async () => {
    const r = await run(
      transformDef(() => Promise.resolve(suspend({ kind: "event", eventName: "x" }, null))),
    );
    expect(r).toMatchObject({ kind: "error", error: { code: "SCHEMA_VALIDATION_ERROR" } });
    const allowed = await run(
      transformDef(() => Promise.resolve(suspend({ kind: "event", eventName: "x" }, { s: 1 })), {
        capabilities: ["suspend"],
      }),
    );
    expect(allowed).toMatchObject({ kind: "suspend", state: { s: 1 } });
  });

  it("lets a decision node suspend for its human failover hop without the capability", async () => {
    const request = {
      title: "Decide",
      context: {},
      mode: { type: "approval" as const },
      assignees: [],
      expiresAt: null,
      externalReview: false,
    };
    const decisionDef = (wait: Parameters<typeof suspend>[0]) =>
      transformDef(() => Promise.resolve(suspend(wait, { q: 1 })), {
        decision: { kind: "boolean" },
      });
    expect(await run(decisionDef({ kind: "human", request }))).toMatchObject({
      kind: "suspend",
      failover: true,
      state: { q: 1 },
    });
    // Only the human hop: waiting for an event still needs the capability.
    expect(await run(decisionDef({ kind: "event", eventName: "x" }))).toMatchObject({
      kind: "error",
    });
  });

  it("denies services a node did not declare", async () => {
    const r = await run(
      transformDef(async (ctx) => {
        await ctx.http("https://example.com");
        return ok({ result: 1 });
      }),
    );
    expect(r).toMatchObject({ kind: "error", error: { code: "FORBIDDEN" } });
  });

  it("rejects duplicate registrations", () => {
    const def = transformDef(() => Promise.resolve(ok({ result: 1 })));
    expect(() => new NodeRegistry([], [def as never, def as never])).toThrow(/twice/);
    const reg = new NodeRegistry([{ nodes: [def] }]);
    expect(reg.has("flowaid.data.transform", "1.0.0")).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });
});

describe("registry provider access", () => {
  it("emits generation events and forwards stream deltas", async () => {
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    const gen: GenerationProvider = {
      id: "acme",
      model: "m",
      capabilities: {
        tools: false,
        jsonSchema: false,
        vision: false,
        streaming: true,
        thinking: false,
        maxContext: 1000,
      },
      generate: () =>
        Promise.resolve({
          text: "hi",
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 1 },
          costUsd: 0.01,
          priceSnapshot: null,
          latencyMs: 4,
          provider: "acme",
          model: "m",
        }),
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          await Promise.resolve();
          yield { type: "text" as const, delta: "h" };
          yield { type: "done" as const, finishReason: "stop" as const };
        },
      }),
      health: () => ({
        status: "healthy",
        errorRate1m: 0,
        p95LatencyMs: 0,
        consecutiveFailures: 0,
        checkedAt: "",
      }),
    };
    registry.register({
      id: "acme",
      kind: "generation",
      create: () => gen,
    });
    const events: NodeEmitted[] = [];
    const deltas: string[] = [];
    const access = registryProviderAccess(
      registry,
      { ...callFor(events), onDelta: (_c, d) => deltas.push(d) },
      { credential: () => Promise.resolve(undefined), http: () => Promise.reject(new Error("no")) },
    );
    const g = access.generation({ provider: "acme", model: "m" });
    const ctx = {
      signal: new AbortController().signal,
      runId: "r",
      nodeRunId: "n",
      idempotencyKey: null,
    };
    expect((await g.generate({ messages: [] }, ctx)).text).toBe("hi");
    for await (const _ of g.stream({ messages: [] }, ctx)) void _;
    expect(events.map((e) => e.type)).toEqual(["GENERATION_COMPLETED"]);
    expect(deltas).toEqual(["h"]);
    expect(g.health().status).toBe("healthy");
    expect(access.embedding({ provider: "acme", model: "e" }).id).toBe("acme");
    const d = access.decision([{ provider: "human" }]);
    expect(d.health().status).toBe("healthy");
  });
});

describe("bindings", () => {
  const state = initialState(plan, "r", { x: 3, nested: { list: [1, 2] } });
  const withStart = {
    ...state,
    scopes: {
      "": {
        ...state.scopes[""],
        path: "",
        planScope: "",
        parent: null,
        iteration: {},
        closed: false,
        nodes: {
          start: {
            ...(state.scopes[""]?.nodes.start ?? {}),
            status: "completed",
            output: { x: 3, nested: { list: [1, 2] } },
          } as never,
        },
      },
    },
  };
  const es = evalScope({
    plan,
    state: withStart,
    scope: "",
    vars: { tone: "calm" },
    run: {
      id: "r",
      workflowId: "w",
      workflowVersionId: null,
      environment: "prod",
      startedAt: null,
      sessionId: null,
    },
    now: "2026-09-23T10:00:00.000Z",
  });

  it("resolves ports with paths, variables, run fields and defaults", () => {
    expect(
      portValue(
        { plan, state: withStart, scope: "", vars: {}, run: {} as never, now: "" },
        "start",
        "nested",
        "/list/1",
      ),
    ).toBe(2);
    expect(
      evaluateBinding(
        { kind: "ref", ref: { kind: "var", name: "tone" }, optional: false, schema: {} },
        es,
      ),
    ).toBe("calm");
    expect(
      evaluateBinding(
        { kind: "ref", ref: { kind: "run", field: "environment" }, optional: false, schema: {} },
        es,
      ),
    ).toBe("prod");
    expect(
      evaluateBinding(
        {
          kind: "ref",
          ref: { kind: "port", node: "a", port: "result" },
          optional: false,
          default: 9,
          schema: {},
        },
        es,
      ),
    ).toBe(9);
    expect(
      evaluateBinding(
        {
          kind: "ref",
          ref: { kind: "port", node: "a", port: "result" },
          optional: true,
          schema: {},
        },
        es,
      ),
    ).toBeUndefined();
    expect(() =>
      evaluateBinding(
        { kind: "ref", ref: { kind: "scope", field: "item" }, optional: false, schema: {} },
        es,
      ),
    ).toThrow(/has no value/);
    expect(
      evaluateBinding(
        {
          kind: "array",
          items: [
            { kind: "literal", value: 1, schema: {} },
            { kind: "ref", ref: { kind: "var", name: "missing" }, optional: true, schema: {} },
          ],
          schema: {},
        },
        es,
      ),
    ).toEqual([1, null]);
    expect(
      evaluateRecord(
        {
          a: { kind: "literal", value: 1, schema: {} },
          b: { kind: "ref", ref: { kind: "var", name: "nope" }, optional: true, schema: {} },
        },
        es,
      ),
    ).toEqual({ a: 1 });
    expect(es.now()).toBe("2026-09-23T10:00:00.000Z");
  });

  it("sets values at JSON pointers without mutating the input", () => {
    const original = { a: { b: [1, { c: 2 }] } };
    const next = setPointer(original, "/a/b/1/c", 5);
    expect(next).toEqual({ a: { b: [1, { c: 5 }] } });
    expect(original.a.b[1]).toEqual({ c: 2 });
    expect(setPointer({}, "/x~1y/z", 1)).toEqual({ "x/y": { z: 1 } });
    expect(setPointer({ a: 1 }, "", 2)).toEqual({ a: 1 });
  });
});

describe("event redaction", () => {
  it("applies the node's pointer rules to inputs and outputs", () => {
    const p = {
      ...plan,
      nodes: {
        ...plan.nodes,
        a: {
          ...(plan.nodes.a as NonNullable<typeof plan.nodes.a>),
          redact: [
            { pointer: "/in/email", dataClass: "pii", mode: "mask" },
            { pointer: "/out/result", dataClass: "sensitive", mode: "hash" },
          ],
        },
      },
    } as ExecutionPlan;
    const redact = createEventRedactor(new Redactor());
    const started = redact(
      {
        type: "NODE_STARTED",
        runId: "r",
        seq: 3,
        at: "2026-09-23T10:00:00.000Z",
        nodeRunId: "n",
        nodeId: "a",
        scope: "",
        attempt: 1,
        input: { email: "a@b.c", ok: 1 },
        pool: "general",
        workerId: "w",
      } as never,
      p,
    );
    expect((started as { input: unknown }).input).toEqual({ email: "[REDACTED]", ok: 1 });
    const done = redact(
      {
        type: "NODE_COMPLETED",
        runId: "r",
        seq: 4,
        at: "2026-09-23T10:00:00.000Z",
        nodeRunId: "n",
        nodeId: "a",
        scope: "",
        attempt: 1,
        output: { result: "secret-ish" },
        firedPorts: ["done"],
        usage: null,
        costUsd: 0,
        latencyMs: 1,
        reused: false,
      } as never,
      p,
    );
    expect(String((done as unknown as { output: { result: string } }).output.result)).toMatch(
      /^sha256:/,
    );
  });
});
