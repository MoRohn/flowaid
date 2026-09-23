import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import { embeddingsNode } from "./embeddings.js";
import { generateNode } from "./generate.js";
import { extractJson, structuredGenerateNode } from "./structured_generate.js";
import { fakeGenerator } from "../test/fakes.js";

const model = { provider: "openai", model: "gpt-test" };

describe("flowaid.ai.generate", () => {
  it("streams deltas and returns the full text", async () => {
    const gen = fakeGenerator("Hello there friend", { streaming: true });
    const r = await runNode(generateNode, {
      config: { model, system: "Be brief" },
      input: { prompt: "Hi" },
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { text: "Hello there friend", finish_reason: "stop" },
    });
    expect(r.recorder.deltas.map((d) => d.delta).join("")).toBe("Hello there friend");
    expect(gen.requests[0]?.messages).toEqual([
      { role: "system", content: "Be brief" },
      { role: "user", content: "Hi" },
    ]);
  });

  it("uses generate() when streaming is off and reports cost", async () => {
    const r = await runNode(generateNode, {
      config: { model, stream: false },
      input: { prompt: "Hi" },
      providers: { generation: fakeGenerator("Yo", { streaming: true }) },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { text: "Yo" }, costUsd: 0.0002 });
    expect(r.recorder.deltas).toHaveLength(0);
  });
});

describe("flowaid.ai.structured_generate", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" }, age: { type: "integer" } },
    required: ["name"],
  };

  it("uses native JSON schema output when the provider supports it", async () => {
    const gen = fakeGenerator("", { jsonSchema: true, structured: { name: "Ada", age: 36 } });
    const r = await runNode(structuredGenerateNode, {
      config: { model, schema },
      input: { prompt: "Who?" },
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { structured: { name: "Ada", age: 36 } },
    });
    expect(gen.requests[0]?.responseFormat).toMatchObject({ type: "json_schema", strict: true });
  });

  it("falls back to prompting and parses fenced JSON", async () => {
    const gen = fakeGenerator('Sure:\n```json\n{"name":"Lin"}\n```');
    const r = await runNode(structuredGenerateNode, {
      config: { model, schema },
      input: { prompt: "Who?" },
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { structured: { name: "Lin" } } });
    expect(gen.requests[0]?.messages[0]?.content).toContain("JSON Schema");
  });

  it("fails with SCHEMA_VALIDATION_ERROR when the answer does not match", async () => {
    const r = await runNode(structuredGenerateNode, {
      config: { model, schema },
      input: { prompt: "?" },
      providers: { generation: fakeGenerator('{"age":"old"}') },
    });
    expect(r.result.kind === "error" && r.result.error.code).toBe("SCHEMA_VALIDATION_ERROR");
  });

  it("extractJson handles bare, fenced and embedded JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("```\n[1,2]\n```")).toEqual([1, 2]);
    expect(extractJson('The answer is {"ok":true}.')).toEqual({ ok: true });
    expect(extractJson("no json")).toBeUndefined();
  });
});

describe("flowaid.ai.embeddings", () => {
  it("embeds in batches and sums usage", async () => {
    let calls = 0;
    const embedding = {
      id: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      embed: (texts: string[]) => {
        calls += 1;
        return Promise.resolve({
          vectors: texts.map((t) => [t.length, 0, 1]),
          usage: { inputTokens: texts.length, outputTokens: 0 },
          costUsd: 0.00001,
        });
      },
      health: () => ({
        status: "healthy" as const,
        errorRate1m: 0,
        p95LatencyMs: 0,
        consecutiveFailures: 0,
        checkedAt: "",
      }),
    };
    const r = await runNode(embeddingsNode, {
      config: { model, batchSize: 2 },
      input: { texts: ["a", "bb", "ccc"] },
      providers: { embedding },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        vectors: [
          [1, 0, 1],
          [2, 0, 1],
          [3, 0, 1],
        ],
        dimensions: 3,
        usage: { inputTokens: 3 },
      },
    });
    expect(calls).toBe(2);
  });
});
