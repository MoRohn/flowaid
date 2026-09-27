/**
 * The bundled LangChain plugin in the worker: it loads and validates as a plugin, contributes its
 * `langchain:*` providers, and the "Knowledge assistant (LangChain RAG)" template runs end to end
 * (golden traces) through the runtime with the real core and LangChain nodes and fake providers.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { coreNodes } from "@flowaid/nodes-core";
import type { StateAccess } from "@flowaid/node-sdk";
import {
  DefaultModelCatalog,
  ProviderRegistry,
  booleanDecision,
  scoreDecision,
} from "@flowaid/providers";
import { runLocally } from "@flowaid/workflow-runtime";
import type {
  DecisionProvider,
  DecisionQuestion,
  DecisionResult,
  EmbeddingProvider,
  GenerationProvider,
  GenerationRequest,
  JsonValue,
  ProviderHealth,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import { loadBundledPlugins, registerPluginProviders } from "./bundled.js";
import { defaultProviderRegistry } from "../worker.js";

const TEMPLATE = join(
  dirname(createRequire(import.meta.url).resolve("@flowaid/nodes-langchain/manifest.json")),
  "templates/knowledge-assistant-langchain-rag.json",
);
const definition = JSON.parse(readFileSync(TEMPLATE, "utf8")) as WorkflowDefinition;

const HEALTHY: ProviderHealth = {
  status: "healthy",
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

/** Deterministic judgments: `p` answers every boolean, scores sit on the top level. */
function fakeTypesafe(p: (id: string) => number): DecisionProvider {
  const meta = { provider: "typesafe", model: "jev-test", latencyMs: 5, costUsd: 0.00002 };
  const answer = (id: string, q: DecisionQuestion): DecisionResult =>
    q.kind === "score"
      ? scoreDecision(
          q.levels.map((_, i) =>
            i === q.levels.length - 1 ? p(id) : (1 - p(id)) / (q.levels.length - 1),
          ),
          q.levels,
          meta,
        )
      : q.kind === "boolean"
        ? booleanDecision(p(id), meta)
        : (() => {
            throw new Error("choice not used");
          })();
  return {
    id: "typesafe",
    model: "jev-test",
    capabilities: {
      batch: true,
      maxQuestions: 16,
      maxStateTokens: 100_000,
      kinds: ["boolean", "choice", "score"],
      text: true,
      images: false,
    },
    decideBoolean: (_s, q) => Promise.resolve(answer("q", q) as never),
    decideChoice: () => Promise.reject(new Error("not used")),
    decideScore: (_s, q) => Promise.resolve(answer("q", q) as never),
    batch: (_state, questions) =>
      Promise.resolve({
        answers: Object.fromEntries(
          Object.entries(questions).map(([id, q]) => [id, answer(id, q)]),
        ),
        usage: { inputTokens: 100, outputTokens: 0 },
        model: "jev-test",
        requestId: null,
        latencyMs: 5,
      }),
    health: () => HEALTHY,
  };
}

function bow(text: string): number[] {
  const v = new Array<number>(32).fill(0);
  for (const w of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2)) {
    let h = 7;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 32] = (v[h % 32] ?? 0) + 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

function registry(p: (id: string) => number, prompts: GenerationRequest[]): ProviderRegistry {
  const r = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  r.register({ id: "typesafe", kind: "decision", create: () => fakeTypesafe(p) });
  const generation: GenerationProvider = {
    id: "openai",
    model: "gpt-4.1-mini",
    capabilities: {
      tools: true,
      jsonSchema: true,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 128_000,
    },
    generate: (req) => {
      prompts.push(req);
      return Promise.resolve({
        text: "Refunds are issued within 14 days to the original card [1].",
        toolCalls: [],
        finishReason: "stop",
        usage: { inputTokens: 200, outputTokens: 20 },
        costUsd: 0.0001,
        priceSnapshot: null,
        latencyMs: 3,
        provider: "openai",
        model: "gpt-4.1-mini",
      });
    },
    stream: (req) => ({
      async *[Symbol.asyncIterator]() {
        prompts.push(req);
        await Promise.resolve();
        for (const delta of ["Refunds are issued within 14 days ", "to the original card [1]."])
          yield { type: "text" as const, delta };
        yield { type: "usage" as const, usage: { inputTokens: 200, outputTokens: 20 } };
        yield { type: "done" as const, finishReason: "stop" as const };
      },
    }),
    health: () => HEALTHY,
  };
  r.register({ id: "openai", kind: "generation", create: () => generation });
  const embedding: EmbeddingProvider = {
    id: "openai",
    model: "text-embedding-3-small",
    dimensions: 32,
    embed: (texts) =>
      Promise.resolve({
        vectors: texts.map(bow),
        usage: { inputTokens: texts.length * 10, outputTokens: 0 },
        costUsd: 0.00001,
      }),
    health: () => HEALTHY,
  };
  r.register({ id: "openai", kind: "embedding", create: () => embedding });
  return r;
}

function memoryState(): StateAccess {
  const data = new Map<string, JsonValue>();
  return {
    get: (ns, key) => Promise.resolve(data.get(`${ns}:${key}`) ?? null),
    set: (ns, key, value) => (data.set(`${ns}:${key}`, value), Promise.resolve()),
    cas: () => Promise.resolve(false),
  };
}

const KNOWLEDGE = [
  "# Refunds",
  "Refunds are issued within 14 days of purchase to the original card.",
  "",
  "# Shipping",
  "Orders ship within two business days. Tracking links arrive by email.",
].join("\n");

describe("bundled LangChain plugin", () => {
  it("loads @flowaid/nodes-langchain, refuses unknown packages and registers langchain:* providers", async () => {
    const loaded = await loadBundledPlugins(["@flowaid/nodes-langchain", "@acme/unknown"]);
    expect(loaded.packages.map((p) => p.name)).toEqual(["@flowaid/nodes-langchain"]);
    expect(loaded.skipped).toEqual([
      { name: "@acme/unknown", reason: "not bundled in this worker image" },
    ]);
    const r = defaultProviderRegistry();
    registerPluginProviders(r, loaded.packages);
    registerPluginProviders(r, loaded.packages); // idempotent
    expect(r.list("generation").map((f) => f.id)).toEqual(
      expect.arrayContaining([
        "openai",
        "langchain:openai",
        "langchain:anthropic",
        "langchain:ollama",
      ]),
    );
    expect(r.list("embedding").map((f) => f.id)).toEqual(
      expect.arrayContaining(["langchain:openai", "langchain:ollama"]),
    );
  });

  describe("Knowledge assistant (LangChain RAG) golden traces", async () => {
    const { packages } = await loadBundledPlugins(["@flowaid/nodes-langchain"]);
    const nodes = [coreNodes, ...packages];
    const secrets = { TYPESAFE_API_KEY: "ts-test", OPENAI_API_KEY: "sk-test" };

    it("ingests knowledge, retrieves it, answers with citations and passes the gate", async () => {
      const prompts: GenerationRequest[] = [];
      const state = memoryState();
      const result = await runLocally(definition, {
        input: {
          question: "How long do refunds take?",
          knowledge: KNOWLEDGE,
          source: "policies.md",
        },
        nodes,
        providers: registry(() => 0.95, prompts),
        secrets,
        services: { state: () => state },
      });
      expect(result.error).toBeNull();
      expect(result.status).toBe("completed");
      expect(result.outcome).toBe("answered");
      const output = result.output as {
        answer: string;
        sources: { pageContent: string; metadata: { source: string } }[];
        disposition: string;
      };
      expect(output.answer).toBe("Refunds are issued within 14 days to the original card [1].");
      expect(output.sources[0]).toMatchObject({
        pageContent: expect.stringContaining("Refunds are issued"),
        metadata: { source: "policies.md" },
      });
      expect(result.trace.map((s) => s.nodeId)).toEqual([
        "start",
        "load",
        "chunk",
        "embed",
        "upsert",
        "retrieve",
        "relevance",
        "grounded",
        "answer",
        "safety",
        "gate",
        "out_answer",
      ]);
      // The chat prompt carried the question and the numbered, cited context.
      const prompt = JSON.stringify(prompts[0]?.messages);
      expect(prompt).toContain("How long do refunds take?");
      expect(prompt).toContain("[1] (policies.md)");

      // A second question reuses the durable workspace store without new knowledge.
      const again = await runLocally(definition, {
        input: { question: "When do orders ship?" },
        nodes,
        providers: registry(() => 0.95, []),
        secrets,
        services: { state: () => state },
      });
      // Without new knowledge the ingestion steps are no-ops (nothing embedded, nothing upserted).
      expect(again.outcome).toBe("answered");
      expect(again.nodeRuns.find((n) => n.nodeId === "upsert")?.output).toMatchObject({ count: 0 });
      expect(
        (again.output as { sources: { pageContent: string }[] }).sources.some((d) =>
          d.pageContent.includes("ship within two business days"),
        ),
      ).toBe(true);
    });

    it("answers 'insufficient context' when TypeSafe judges the passages irrelevant", async () => {
      const result = await runLocally(definition, {
        input: { question: "What is the CEO's favourite colour?", knowledge: KNOWLEDGE },
        nodes,
        providers: registry((id) => (id === "answerable" ? 0.1 : 0.9), []),
        secrets,
        services: { state: () => memoryState() },
      });
      expect(result.outcome).toBe("insufficient_context");
      expect(result.trace.map((s) => s.nodeId)).not.toContain("answer");
    });

    it("routes a weakly grounded answer to a reviewer, whose edit becomes the answer", async () => {
      const result = await runLocally(definition, {
        input: { question: "How long do refunds take?", knowledge: KNOWLEDGE },
        nodes,
        providers: registry((id) => (id === "grounded" ? 0.7 : 0.95), []),
        secrets,
        services: { state: () => memoryState() },
        human: (request) => {
          expect(request.mode.type).toBe("review");
          return Promise.resolve({ action: "approve", value: "Refunds take up to 14 days [1]." });
        },
      });
      expect(result.outcome).toBe("reviewed");
      expect((result.output as { answer: string }).answer).toBe("Refunds take up to 14 days [1].");
    });
  });
});
