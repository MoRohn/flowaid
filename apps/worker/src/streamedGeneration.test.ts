/**
 * A streamed `flowaid.ai.generate` run is priced: the runtime's stream wrapper prices the final
 * usage from the model catalog and emits GENERATION_COMPLETED, so the run's cost, its
 * `maxCostUsd` and the metrics see streamed generations as they see non-streamed ones.
 */
import { describe, expect, it } from "vitest";
import { coreNodes } from "@flowaid/nodes-core";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import { runLocally } from "@flowaid/workflow-runtime";
import type { GenerationProvider, WorkflowDefinition } from "@flowaid/workflow-core";

const HEALTHY = {
  status: "healthy" as const,
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

/** gpt-4.1-mini is priced in the built-in catalog; the fake stream reports usage but no cost. */
function registry(): ProviderRegistry {
  const r = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  const generation: GenerationProvider = {
    id: "openai",
    model: "gpt-4.1-mini",
    capabilities: {
      tools: false,
      jsonSchema: false,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 128_000,
    },
    generate: () =>
      Promise.resolve({
        text: "Hello there.",
        toolCalls: [],
        finishReason: "stop" as const,
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        costUsd: 0.5,
        priceSnapshot: null,
        provider: "openai",
        model: "gpt-4.1-mini",
        latencyMs: 1,
      }),
    stream: () => ({
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield { type: "text" as const, delta: "Hello " };
        yield { type: "text" as const, delta: "there." };
        yield {
          type: "usage" as const,
          usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
        };
        yield { type: "done" as const, finishReason: "stop" as const };
      },
    }),
    health: () => HEALTHY,
  };
  r.register({ id: "openai", kind: "generation", create: () => generation });
  return r;
}

function definition(maxCostUsd?: number, stream = true): WorkflowDefinition {
  return {
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: "00000000-0000-4000-8000-0000000000e1",
    name: "streamed generation",
    inputs: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    outputs: {},
    secrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key" }],
    ...(maxCostUsd !== undefined ? { execution: { maxCostUsd } } : {}),
    nodes: [
      { id: "start", kind: "input", name: "in" },
      {
        id: "gen",
        kind: "task",
        type: "flowaid.ai.generate",
        typeVersion: "1.0.0",
        name: "Generate",
        config: { model: { provider: "openai", model: "gpt-4.1-mini" }, stream },
        inputs: { prompt: { kind: "ref", ref: { kind: "port", node: "start", port: "q" } } },
        credentials: { llm: "OPENAI_API_KEY" },
      },
      {
        id: "out",
        kind: "output",
        name: "out",
        value: { kind: "ref", ref: { kind: "port", node: "gen", port: "text" } },
      },
    ],
    edges: [],
  } as unknown as WorkflowDefinition;
}

describe("streamed generation cost", () => {
  it("prices a streamed Generate node from the catalog and records GENERATION_COMPLETED", async () => {
    const result = await runLocally(definition(), {
      input: { q: "hi" },
      nodes: [coreNodes],
      providers: registry(),
      secrets: { OPENAI_API_KEY: "sk-test" },
    });
    expect(result.error).toBeNull();
    expect(result.output).toBe("Hello there.");
    const completed = result.events.filter((e) => e.type === "GENERATION_COMPLETED");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4.1-mini",
      usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
      finishReason: "stop",
      outputChars: "Hello there.".length,
      priceSnapshot: { inputPerMTok: expect.any(Number), outputPerMTok: expect.any(Number) },
    });
    const cost = (completed[0] as { costUsd: number }).costUsd;
    expect(cost).toBeGreaterThan(0);
    expect(result.costUsd).toBeCloseTo(cost, 10);
    // the node row carries the charged cost and usage too, not only what the node reported
    const gen = result.nodeRuns.find((n) => n.nodeId === "gen");
    expect(gen?.costUsd).toBeCloseTo(cost, 10);
    expect(gen?.usage).toMatchObject({ inputTokens: 1_000_000, outputTokens: 500_000 });
  });

  it("counts a non-streamed generation once, on the node and the run", async () => {
    const result = await runLocally(definition(undefined, false), {
      input: { q: "hi" },
      nodes: [coreNodes],
      providers: registry(),
      secrets: { OPENAI_API_KEY: "sk-test" },
    });
    expect(result.error).toBeNull();
    expect(result.events.filter((e) => e.type === "GENERATION_COMPLETED")).toHaveLength(1);
    expect(result.costUsd).toBeCloseTo(0.5, 10);
    const gen = result.nodeRuns.find((n) => n.nodeId === "gen");
    expect(gen?.costUsd).toBeCloseTo(0.5, 10);
    expect(gen?.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000 });
  });

  it("holds a streamed generation to the run's maxCostUsd", async () => {
    const result = await runLocally(definition(0.01), {
      input: { q: "hi" },
      nodes: [coreNodes],
      providers: registry(),
      secrets: { OPENAI_API_KEY: "sk-test" },
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BOUNDS_EXCEEDED");
  });
});
