import {
  CredentialError,
  NetworkError,
  ProviderError,
  ProviderRateLimitedError,
  type GenerationChunk,
  type GenerationPolicy,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationResult,
} from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "./catalog/index.js";
import {
  GenerationFailoverChain,
  eligibleCandidates,
  estimateCostUsd,
  orderCandidates,
  type GenerationCandidate,
} from "./generation-failover.js";
import { HealthTracker } from "./health.js";
import { ProviderRegistry, type ResolveContext } from "./registry.js";
import { FakeClock, HEALTHY, ctx } from "./test/fakes.js";

type Step = string | Error;

/** A generation provider that plays a script (texts or errors), for generate and stream. */
function fake(provider: string, model: string, script: Step[], streamFailsAfter?: number) {
  let i = 0;
  const calls: string[] = [];
  const next = () => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    return step;
  };
  const p: GenerationProvider & { calls: string[] } = {
    id: provider,
    model,
    calls,
    capabilities: {
      tools: true,
      jsonSchema: true,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 100_000,
    },
    generate(): Promise<GenerationResult> {
      calls.push("generate");
      const step = next();
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve({
        text: step ?? "",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.001,
        priceSnapshot: null,
        latencyMs: 5,
        provider,
        model,
      });
    },
    async *stream(): AsyncIterable<GenerationChunk> {
      await Promise.resolve();
      calls.push("stream");
      const step = next();
      if (step instanceof Error && streamFailsAfter === undefined) throw step;
      yield { type: "text", delta: typeof step === "string" ? step : "partial" };
      if (streamFailsAfter !== undefined) throw new NetworkError("dropped mid-stream");
      yield { type: "done", finishReason: "stop" };
    },
    health: () => HEALTHY,
  };
  return p;
}

const REQ: GenerationRequest = {
  messages: [{ role: "user", content: "Write a haiku about queues." }],
};
const cand = (p: GenerationProvider): GenerationCandidate => ({
  ref: { provider: p.id, model: p.model },
  provider: p,
  healthKey: `${p.id}/${p.model}/cred`,
});
const policy = (
  strategy: GenerationPolicy["strategy"] = "ordered",
  extra: Partial<GenerationPolicy> = {},
): GenerationPolicy => ({
  candidates: [{ provider: "x", model: "y" }],
  strategy,
  ...extra,
});

function chain(
  providers: GenerationProvider[],
  p: GenerationPolicy = policy(),
  opts: { health?: HealthTracker; clock?: FakeClock } = {},
) {
  const failovers: string[] = [];
  const warnings: string[] = [];
  const c = new GenerationFailoverChain(providers.map(cand), p, {
    catalog: new DefaultModelCatalog(),
    ...(opts.health ? { health: opts.health } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
    onFailover: (f) => failovers.push(`${f.from} -> ${f.to} (${f.error.code})`),
    warn: (m) => warnings.push(m),
  });
  return { c, failovers, warnings };
}

async function collect(stream: AsyncIterable<GenerationChunk>): Promise<string> {
  let text = "";
  for await (const chunk of stream) if (chunk.type === "text") text += chunk.delta;
  return text;
}

describe("generation failover matrix", () => {
  it("answers from the first candidate when it succeeds", async () => {
    const a = fake("openai", "gpt-6-sol", ["from a"]);
    const b = fake("anthropic", "claude-sonnet-5", ["from b"]);
    const { c, failovers } = chain([a, b]);
    const r = await c.generate(REQ, ctx());
    expect(r.text).toBe("from a");
    expect(r.attempts).toEqual([
      { provider: "openai", model: "gpt-6-sol", outcome: "ok", latencyMs: expect.any(Number) },
    ]);
    expect(b.calls).toEqual([]);
    expect(failovers).toEqual([]);
  });

  it.each([
    ["a network failure", new NetworkError("reset")],
    ["rate limiting", new ProviderRateLimitedError("openai", 1000)],
    ["a retryable provider error", new ProviderError("503", true, "openai")],
  ])("advances past %s and records both attempts", async (_, error) => {
    const a = fake("openai", "gpt-6-sol", [error]);
    const b = fake("anthropic", "claude-sonnet-5", ["from b"]);
    const { c, failovers } = chain([a, b]);
    const r = await c.generate(REQ, ctx());
    expect(r.text).toBe("from b");
    expect(r.attempts?.map((x) => [x.provider, x.outcome])).toEqual([
      ["openai", "error"],
      ["anthropic", "ok"],
    ]);
    expect(r.attempts?.[0]?.errorCode).toBe(error.code);
    expect(failovers).toEqual([`openai/gpt-6-sol -> anthropic/claude-sonnet-5 (${error.code})`]);
  });

  it("surfaces a configuration error instead of degrading", async () => {
    const a = fake("openai", "gpt-6-sol", [new CredentialError("401: bad key")]);
    const b = fake("anthropic", "claude-sonnet-5", ["from b"]);
    const { c } = chain([a, b]);
    await expect(c.generate(REQ, ctx())).rejects.toBeInstanceOf(CredentialError);
    expect(b.calls).toEqual([]);
  });

  it("throws the last error when every candidate fails", async () => {
    const a = fake("openai", "gpt-6-sol", [new NetworkError("a down")]);
    const b = fake("anthropic", "claude-sonnet-5", [new NetworkError("b down")]);
    const { c } = chain([a, b]);
    await expect(c.generate(REQ, ctx())).rejects.toThrow("b down");
  });

  it("skips a candidate whose circuit is open, as skipped_unhealthy", async () => {
    const clock = new FakeClock();
    const health = new HealthTracker(clock);
    for (let i = 0; i < 5; i++)
      health.record("openai/gpt-6-sol/cred", {
        ok: false,
        latencyMs: 10,
        code: "NETWORK_ERROR",
        retryable: true,
      });
    const a = fake("openai", "gpt-6-sol", ["never"]);
    const b = fake("anthropic", "claude-sonnet-5", ["from b"]);
    const { c } = chain([a, b], policy(), { health, clock });
    const r = await c.generate(REQ, ctx());
    expect(r.text).toBe("from b");
    expect(r.attempts?.[0]).toMatchObject({ provider: "openai", outcome: "skipped_unhealthy" });
    expect(a.calls).toEqual([]);
  });

  it("fails a stream over before its first chunk, and never after it", async () => {
    const a = fake("openai", "gpt-6-sol", [new NetworkError("refused")]);
    const b = fake("anthropic", "claude-sonnet-5", ["streamed by b"]);
    const { c, failovers } = chain([a, b]);
    expect(await collect(c.stream(REQ, ctx()))).toBe("streamed by b");
    expect(failovers).toHaveLength(1);

    const mid = fake("openai", "gpt-6-sol", ["half"], 1);
    const other = fake("anthropic", "claude-sonnet-5", ["unused"]);
    const second = chain([mid, other]);
    await expect(collect(second.c.stream(REQ, ctx()))).rejects.toThrow("dropped mid-stream");
    expect(other.calls).toEqual([]);
  });
});

describe("generation routing strategies", () => {
  const catalog = new DefaultModelCatalog();
  const astra = cand(fake("openai", "gpt-6-astra", ["x"])); // $10 + $50
  const sol = cand(fake("openai", "gpt-6-sol", ["x"])); // $2 + $10
  const luna = cand(fake("openai", "gpt-6-luna", ["x"])); // $0.1 + $0.5
  const custom = cand(fake("openai-compatible", "my-model", ["x"])); // unknown price
  const labels = (list: GenerationCandidate[]) => list.map((c) => c.ref.model);

  it("keeps the configured order for `ordered`", () => {
    expect(labels(orderCandidates([astra, sol, luna], "ordered", { catalog }))).toEqual([
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
    ]);
  });

  it("orders `cheapest` by catalog price, unknown prices last", () => {
    expect(labels(orderCandidates([custom, astra, sol, luna], "cheapest", { catalog }))).toEqual([
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6-astra",
      "my-model",
    ]);
  });

  it("orders `fastest` by the tracker's p95, unmeasured last", () => {
    const clock = new FakeClock();
    const health = new HealthTracker(clock);
    health.record(sol.healthKey, { ok: true, latencyMs: 900 });
    health.record(luna.healthKey, { ok: true, latencyMs: 120 });
    expect(labels(orderCandidates([astra, sol, luna], "fastest", { catalog, health }))).toEqual([
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6-astra",
    ]);
  });

  it("orders `healthiest` by status, then error rate", () => {
    const clock = new FakeClock();
    const health = new HealthTracker(clock);
    const fail = {
      ok: false as const,
      latencyMs: 10,
      code: "NETWORK_ERROR" as const,
      retryable: true,
    };
    for (let i = 0; i < 5; i++) health.record(astra.healthKey, fail); // down
    health.record(sol.healthKey, fail); // degraded (1 of 2)
    health.record(sol.healthKey, { ok: true, latencyMs: 10 });
    health.record(luna.healthKey, { ok: true, latencyMs: 10 }); // healthy
    expect(labels(orderCandidates([astra, sol, luna], "healthiest", { catalog, health }))).toEqual([
      "gpt-6-luna",
      "gpt-6-sol",
      "gpt-6-astra",
    ]);
  });

  it("filters by requirements and by the estimated cost per call", () => {
    const withLimits = new DefaultModelCatalog({
      overrides: [
        {
          provider: "openai-compatible",
          model: "tiny",
          kind: "chat",
          capabilities: { tools: false, jsonSchema: false },
          contextTokens: 8000,
        },
      ],
    });
    const tiny = cand(fake("openai-compatible", "tiny", ["x"]));
    const req: GenerationRequest = { ...REQ, maxOutputTokens: 100_000 };
    const needsTools = eligibleCandidates(
      [tiny, luna],
      { requirements: { tools: true } },
      withLimits,
    );
    expect(labels(needsTools.eligible)).toEqual(["gpt-6-luna"]);
    expect(needsTools.excluded[0]?.reason).toMatch(/lacks tools/);
    const bigContext = eligibleCandidates(
      [tiny, luna],
      { requirements: { minContext: 32_000 } },
      withLimits,
    );
    expect(labels(bigContext.eligible)).toEqual(["gpt-6-luna"]);
    // 100k output tokens on astra ≈ $5; on luna ≈ $0.05
    expect(estimateCostUsd(withLimits, astra.ref, req)).toBeGreaterThan(4);
    const capped = eligibleCandidates([astra, luna], { maxCostUsdPerCall: 0.5 }, withLimits, req);
    expect(labels(capped.eligible)).toEqual(["gpt-6-luna"]);
    expect(capped.excluded[0]?.reason).toMatch(/exceeds \$0.5 per call/);
  });

  it("refuses a request no candidate can serve, saying why", async () => {
    const { c } = chain(
      [fake("openai", "gpt-6-astra", ["x"])],
      policy("ordered", { maxCostUsdPerCall: 0.000001 }),
    );
    await expect(c.generate(REQ, ctx())).rejects.toThrow(/No generation candidate can serve/);
  });
});

describe("ProviderRegistry.generation with a policy", () => {
  function setup(opts: { anthropicKey?: boolean } = {}) {
    const clock = new FakeClock();
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog({ clock }), clock });
    registry.register({
      id: "openai",
      kind: "generation",
      credentialType: "openai.api_key",
      create: ({ model }) => fake("openai", model, [new NetworkError("openai is down")]),
    });
    registry.register({
      id: "anthropic",
      kind: "generation",
      credentialType: "anthropic.api_key",
      create: ({ model }) => fake("anthropic", model, ["from anthropic"]),
    });
    const resolve: ResolveContext = {
      workspaceId: "ws",
      http: () => Promise.reject(new Error("no network in tests")),
      credential: (provider) =>
        Promise.resolve(
          provider === "anthropic" && opts.anthropicKey === false
            ? undefined
            : { id: `${provider}-cred`, value: { apiKey: "k" } },
        ),
    };
    return { registry, resolve };
  }
  const POLICY: GenerationPolicy = {
    candidates: [
      { provider: "openai", model: "gpt-6-sol" },
      { provider: "anthropic", model: "claude-sonnet-5" },
    ],
    strategy: "ordered",
  };

  it("fails over across vendors and reports the hand-over", async () => {
    const { registry, resolve } = setup();
    const failovers: string[] = [];
    const provider = await registry.generation(POLICY, resolve, {
      onFailover: (f) => failovers.push(`${f.from} -> ${f.to}`),
    });
    const r = await provider.generate(REQ, ctx());
    expect(r.text).toBe("from anthropic");
    expect(r.attempts?.map((a) => a.outcome)).toEqual(["error", "ok"]);
    expect(failovers).toEqual(["openai/gpt-6-sol -> anthropic/claude-sonnet-5"]);
  });

  it("skips an unresolvable candidate and fails when none resolves", async () => {
    const { registry, resolve } = setup({ anthropicKey: false });
    const warnings: string[] = [];
    const provider = await registry.generation(POLICY, resolve, { warn: (m) => warnings.push(m) });
    await expect(provider.generate(REQ, ctx())).rejects.toThrow("openai is down");
    expect(warnings.join("\n")).toMatch(
      /anthropic\/claude-sonnet-5: No anthropic.api_key credential/,
    );
    await expect(
      registry.generation(
        { candidates: [{ provider: "anthropic", model: "claude-sonnet-5" }], strategy: "ordered" },
        resolve,
      ),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("still resolves a single model ref to one guarded provider", async () => {
    const { registry, resolve } = setup();
    const provider = await registry.generation(
      { provider: "anthropic", model: "claude-sonnet-5" },
      resolve,
    );
    expect(provider).not.toBeInstanceOf(GenerationFailoverChain);
    expect((await provider.generate(REQ, ctx())).text).toBe("from anthropic");
  });
});
