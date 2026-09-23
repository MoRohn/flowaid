import {
  CredentialError,
  NetworkError,
  type DecisionProvider,
  type ProviderFactory,
  type ProviderHop,
} from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "./catalog/index.js";
import { ProviderRegistry, type ResolveContext } from "./registry.js";
import { HumanFallbackSignal } from "./signals.js";
import { FakeClock, ctx, scriptedDecider, scriptedGenerator } from "./test/fakes.js";

function setup(opts: { typesafeKey?: boolean } = {}) {
  const clock = new FakeClock();
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog({ clock }), clock });
  let created = 0;
  const typesafe: ProviderFactory<DecisionProvider> = {
    id: "typesafe",
    kind: "decision",
    credentialType: "typesafe.api_key",
    create: () => ((created += 1), scriptedDecider("typesafe", [new NetworkError("down")])),
  };
  registry.register(typesafe);
  registry.register({
    id: "openai",
    kind: "generation",
    credentialType: "openai.api_key",
    create: () => scriptedGenerator([JSON.stringify({ q: { p_yes: 0.7 } })]),
  });
  const resolve: ResolveContext = {
    workspaceId: "ws",
    http: () => Promise.reject(new Error("no network in tests")),
    credential: (provider) =>
      Promise.resolve(
        provider === "typesafe" && opts.typesafeKey === false
          ? undefined
          : { id: `${provider}-cred`, value: { apiKey: "k" } },
      ),
  };
  return { registry, resolve, created: () => created, clock };
}

const TS: ProviderHop = { provider: "typesafe", model: "jev-latest" };
const LLM: ProviderHop = { provider: "llm", model: { provider: "openai", model: "gpt-4.1-mini" } };
const Q = { kind: "boolean" as const, instructions: "Urgent?" };

describe("ProviderRegistry", () => {
  it("refuses a second factory with the same kind and id", () => {
    const { registry } = setup();
    expect(() =>
      registry.register({
        id: "typesafe",
        kind: "decision",
        create: () => scriptedDecider("x", [0.5]),
      }),
    ).toThrow(/already registered/);
    expect(registry.list("generation").map((f) => f.id)).toEqual(["openai"]);
  });

  it("creates a provider once per workspace, hop and credential", async () => {
    const { registry, resolve, created } = setup();
    await registry.decision(TS, resolve);
    await registry.decision(TS, resolve);
    expect(created()).toBe(1);
    await registry.decision(TS, { ...resolve, workspaceId: "other" });
    expect(created()).toBe(2);
  });

  it("builds a chain that fails over from TypeSafe to an LLM, then to a person", async () => {
    const { registry, resolve } = setup();
    const failovers: string[] = [];
    const chain = await registry.chain([TS, LLM], resolve, {
      onFailover: (e) => failovers.push(`${e.from}→${e.to}`),
    });
    const result = await chain.decideBoolean("state", Q, ctx());
    expect(result).toMatchObject({ provider: "llm", value: true });
    expect(result.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      "typesafe:error",
      "llm:ok",
    ]);
    expect(failovers).toEqual(["typesafe/jev-latest→llm/openai/gpt-4.1-mini"]);
    const toHuman = await registry.chain([TS, { provider: "human" }], resolve);
    await expect(toHuman.decideBoolean("s", Q, ctx())).rejects.toBeInstanceOf(HumanFallbackSignal);
  });

  it("fails on a missing primary credential but skips a failover hop without one", async () => {
    const { registry, resolve } = setup({ typesafeKey: false });
    await expect(registry.chain([TS, LLM], resolve)).rejects.toBeInstanceOf(CredentialError);
    const chain = await registry.chain([LLM, TS, { provider: "rule" }], resolve);
    expect((await chain.decideBoolean("s", Q, ctx())).provider).toBe("llm");
    expect(await registry.decision({ provider: "human" }, resolve)).toBeUndefined();
    expect(await registry.decision({ provider: "rule" }, resolve)).toBeUndefined();
    const withRules = await registry.decision({ provider: "rule" }, resolve, {
      rules: { kind: "boolean", rules: [], default: { value: true, confidence: 1 } },
    });
    expect(withRules?.id).toBe("rule");
  });

  it("opens a generation circuit after repeated failures and rate-limits by the catalog", async () => {
    const { registry, resolve } = setup();
    registry.register({
      id: "flaky",
      kind: "generation",
      create: () => scriptedGenerator([new NetworkError("down")]),
    });
    const flaky = await registry.generation({ provider: "flaky", model: "m" }, resolve);
    for (let i = 0; i < 5; i += 1)
      await expect(flaky.generate({ messages: [] }, ctx())).rejects.toMatchObject({
        code: "NETWORK_ERROR",
      });
    await expect(flaky.generate({ messages: [] }, ctx())).rejects.toMatchObject({
      message: expect.stringContaining("circuit is open") as unknown,
    });
    expect(flaky.health().status).toBe("down");
    await expect(registry.generation({ provider: "nope", model: "m" }, resolve)).rejects.toThrow(
      /No generation provider 'nope'/,
    );
  });

  it("prices unpriced generations and embeddings from the catalog", async () => {
    const { registry, resolve } = setup();
    registry.register({
      id: "anthropic",
      kind: "generation",
      create: () => ({
        ...scriptedGenerator(["ok"], { model: "claude-sonnet-5" }),
        id: "anthropic",
        generate: () =>
          Promise.resolve({
            text: "ok",
            toolCalls: [],
            finishReason: "stop" as const,
            usage: { inputTokens: 1000, outputTokens: 100 },
            costUsd: 0,
            priceSnapshot: null,
            latencyMs: 1,
            provider: "anthropic",
            model: "claude-sonnet-5",
          }),
      }),
    });
    const gen = await registry.generation(
      { provider: "anthropic", model: "claude-sonnet-5" },
      resolve,
    );
    const result = await gen.generate({ messages: [] }, ctx());
    expect(result.priceSnapshot).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6, 12);
    registry.register({
      id: "openai",
      kind: "embedding",
      create: () => ({
        id: "openai",
        model: "text-embedding-3-small",
        dimensions: 2,
        embed: () =>
          Promise.resolve({
            vectors: [[0]],
            usage: { inputTokens: 1_000_000, outputTokens: 0 },
            costUsd: 0,
          }),
        health: () => scriptedGenerator([]).health(),
      }),
    });
    const embed = await registry.embedding(
      { provider: "openai", model: "text-embedding-3-small" },
      resolve,
    );
    expect((await embed.embed(["x"], ctx())).costUsd).toBeCloseTo(0.02);
  });
});
