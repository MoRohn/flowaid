import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import {
  evaluationCases,
  evaluationResults,
  evaluationRuns,
  evaluationSets,
  workspaces,
} from "@flowaid/database";
import { NO_JUDGE_MODEL } from "@flowaid/evaluation";
import { DefaultModelCatalog } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import type {
  DecisionCallContext,
  GenerationProvider,
  GenerationRequest,
  GenerationResult,
} from "@flowaid/workflow-core";
import { eq } from "drizzle-orm";
import { createHarness, fakeTypesafeRegistry, type Harness } from "./test/setup.js";

const USAGE = { inputTokens: 1200, outputTokens: 20 };

/**
 * A generation model registered as `anthropic` (the first default): answers the judge's boolean
 * question with the queued `p_yes`, unpriced so the registry prices it from the catalog. With
 * `hold`, a call waits until its signal aborts (to test cancellation).
 */
function fakeAnthropic(state: {
  pYes: number;
  hold: boolean;
  requests: GenerationRequest[];
  aborted: number;
}): GenerationProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    capabilities: {
      tools: false,
      jsonSchema: true,
      vision: false,
      streaming: false,
      thinking: false,
      maxContext: 200_000,
    },
    async generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult> {
      state.requests.push(req);
      if (state.hold)
        await new Promise<void>((_, reject) => {
          const stop = () => {
            state.aborted++;
            reject(new Error("aborted"));
          };
          if (ctx.signal.aborted) stop();
          else ctx.signal.addEventListener("abort", stop, { once: true });
        });
      return {
        text: "",
        structured: { q: { p_yes: state.pYes } },
        toolCalls: [],
        finishReason: "stop",
        usage: USAGE,
        costUsd: 0,
        priceSnapshot: null,
        latencyMs: 3,
        provider: "anthropic",
        model: "claude-sonnet-5",
      };
    },
    stream: () => {
      throw new Error("not used");
    },
    health: () => ({
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: new Date().toISOString(),
    }),
  };
}

describeDb("evaluation judge checks (Postgres)", () => {
  let h: Harness;
  let workflowId: string;
  let versionId: string;
  const state = { pYes: 0.9, hold: false, requests: [] as GenerationRequest[], aborted: 0 };

  beforeAll(async () => {
    const registry = fakeTypesafeRegistry();
    registry.register({
      id: "anthropic",
      kind: "generation",
      credentialType: "anthropic.api_key",
      create: () => fakeAnthropic(state),
    } as never);
    h = await createHarness({
      registry,
      extra: () => ({ serverKeys: { anthropic: "sk-test" }, evaluation: { pollMs: 50 } }),
    });
    ({ workflowId, versionId } = await h.deploy("Reply", {
      inputs: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      outputs: { type: "object", properties: { reply: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "echo",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Echo",
          config: { template: "Thanks: {{ start.message }}" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: { reply: { kind: "ref", ref: { kind: "port", node: "echo", port: "text" } } },
          },
        },
      ],
    }));
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    Object.assign(state, { pYes: 0.9, hold: false, requests: [], aborted: 0 });
    await setSettings({});
  });

  const setSettings = (settings: Record<string, unknown>) =>
    h.db.app.system((tx) =>
      tx
        .update(workspaces)
        .set({ settings: settings as never })
        .where(eq(workspaces.id, h.workspaceId)),
    );

  const judged = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      input: { message: `m${i}` },
      expected: {
        output: [{ path: "/reply", matcher: { type: "judge", instructions: "Is it polite?" } }],
      },
    }));

  const enqueue = async (cases: { input: unknown; expected: unknown }[]) => {
    const setId = uuidv7();
    const runId = uuidv7();
    await h.db.app.system(async (tx) => {
      await tx
        .insert(evaluationSets)
        .values({ id: setId, workspaceId: h.workspaceId, workflowId, name: `s-${setId}` });
      await tx.insert(evaluationCases).values(
        cases.map((c, i) => ({
          id: uuidv7(),
          workspaceId: h.workspaceId,
          setId,
          ordinal: i,
          input: c.input as never,
          expected: c.expected as never,
        })),
      );
      await tx.insert(evaluationRuns).values({
        id: runId,
        workspaceId: h.workspaceId,
        setId,
        workflowId,
        workflowVersionId: versionId,
        environmentId: h.environmentId,
        concurrency: 1,
      });
    });
    await h.queue.enqueue("evaluation", { type: "evaluation.run", evaluationRunId: runId });
    return runId;
  };

  const settle = async (runId: string) => {
    for (let i = 0; i < 300; i++) {
      const [r] = await h.db.app.system((tx) =>
        tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)),
      );
      if (r?.endedAt) return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error("evaluation did not finish");
  };

  const resultsOf = (runId: string) =>
    h.db.app.system((tx) =>
      tx.select().from(evaluationResults).where(eq(evaluationResults.evaluationRunId, runId)),
    );

  it("judges with the workspace's default model and prices the calls into the summary", async () => {
    const run = await settle(await enqueue(judged(2)));
    expect(run.status).toBe("completed");
    expect(state.requests).toHaveLength(2);
    expect(JSON.stringify(state.requests[0]?.messages)).toContain("Thanks: m");
    const { costUsd: perCall } = new DefaultModelCatalog().price(
      "anthropic",
      "claude-sonnet-5",
      USAGE,
    );
    expect(perCall).toBeGreaterThan(0);
    const summary = run.summary as { passed: number; costUsd: Record<string, number> };
    expect(summary.passed).toBe(2);
    expect(summary.costUsd.judge).toBeCloseTo(perCall * 2, 10);
    expect(summary.costUsd.total).toBeCloseTo(perCall * 2, 10);
    const results = await resultsOf(run.id);
    expect(results[0]?.metrics).toMatchObject({ judgeCostUsd: expect.closeTo(perCall, 10) });

    state.pYes = 0.1;
    const failing = await settle(await enqueue(judged(1)));
    const [r] = await resultsOf(failing.id);
    expect(r?.passed).toBe(false);
    expect(r?.failures[0]).toMatch(/judge answered no/);
  });

  it("fails judge checks with a clear message when no model is available", async () => {
    // a configured model whose provider is not registered leaves no judge
    await setSettings({ advisorModel: { provider: "nope", model: "x" } });
    const run = await settle(await enqueue(judged(1)));
    expect(run.status).toBe("completed");
    const [r] = await resultsOf(run.id);
    expect(r?.failures).toEqual([`output:/reply:judge: ${NO_JUDGE_MODEL}`]);
    expect(state.requests).toHaveLength(0);
  });

  it("aborts an in-flight judge call when the evaluation is cancelled", async () => {
    state.hold = true;
    const runId = await enqueue(judged(3));
    for (let i = 0; i < 200 && state.requests.length === 0; i++)
      await new Promise((res) => setTimeout(res, 50));
    expect(state.requests).toHaveLength(1);
    await h.db.app.system((tx) =>
      tx.update(evaluationRuns).set({ status: "cancelled" }).where(eq(evaluationRuns.id, runId)),
    );
    const run = await settle(runId);
    expect(run.status).toBe("cancelled");
    expect(state.aborted).toBe(1);
    // no further case was launched or judged
    expect(state.requests).toHaveLength(1);
    expect(await resultsOf(runId)).toHaveLength(1);
  });
});
