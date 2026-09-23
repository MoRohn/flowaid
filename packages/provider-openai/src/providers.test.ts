import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import type { GenerationChunk, GenerationProvider, SafeFetch } from "@flowaid/workflow-core";
import {
  clientFor,
  googleFactory,
  listModels,
  openaiCompatibleFactory,
  openaiFactories,
  openaiFactory,
} from "./factories.js";
import { PRESETS } from "./presets.js";

const DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${DIR}${name}.json`, "utf8")) as {
    sse?: string;
    json?: unknown;
    status?: number;
  };
const catalog = new DefaultModelCatalog();
const ctx = () => ({
  signal: new AbortController().signal,
  runId: "r",
  nodeRunId: "n",
  idempotencyKey: null,
});

/** A fetch that answers with a fixture (SSE split into small chunks to exercise the parser). */
function serve(name: string) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const f = fixture(name);
  const http: SafeFetch = (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    if (f.sse) {
      const bytes = new TextEncoder().encode(f.sse);
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
          c.close();
        },
      });
      return Promise.resolve(
        new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(f.json), { status: f.status ?? 200 }));
  };
  return { http, calls };
}

async function collect(provider: GenerationProvider): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const c of provider.stream({ messages: [{ role: "user", content: "hi" }] }, ctx()))
    out.push(c);
  return out;
}

describe("OpenAI through the registry", () => {
  it("streams text with cached-token usage and the right endpoint, headers and body", async () => {
    const { http, calls } = serve("openai-text");
    const registry = new ProviderRegistry({ catalog });
    for (const f of openaiFactories()) registry.register(f);
    const provider = await registry.generation(
      { provider: "openai", model: "gpt-5.4-mini" },
      {
        workspaceId: "ws",
        credential: () =>
          Promise.resolve({ id: "c", value: { apiKey: "sk-test", organization: "org-1" } }),
        http,
      },
    );
    const chunks = await collect(provider);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.delta : ""))
        .join(""),
    ).toBe("Sorry about the double charge.");
    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 1200, outputTokens: 9, cacheReadTokens: 1024 },
    });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer sk-test",
      "OpenAI-Organization": "org-1",
    });
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-5.4-mini",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("assembles streamed tool calls by index", async () => {
    const { http } = serve("openai-tools");
    const client = clientFor(PRESETS.openai, {
      model: "gpt-5.4-mini",
      credential: { apiKey: "k" },
      http,
      catalog,
    });
    const chunks = await collect(client);
    const calls = chunks.filter((c) => c.type === "tool_call");
    expect(
      calls.map((c) => (c.type === "tool_call" ? [c.index, c.name ?? "", c.argsDelta] : null)),
    ).toEqual([
      [0, "lookup_invoice", ""],
      [0, "", '{"customer":'],
      [0, "", '"cus_1"}'],
      [1, "refund", '{"amount":12}'],
    ]);
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("returns structured output with catalog pricing and max_completion_tokens", async () => {
    const { http, calls } = serve("openai-structured");
    const client = clientFor(PRESETS.openai, {
      model: "gpt-5.4-mini",
      credential: { apiKey: "k" },
      http,
      catalog,
    });
    const result = await client.generate(
      {
        messages: [{ role: "user", content: "triage" }],
        responseFormat: { type: "json_schema", schema: { type: "object" }, strict: true },
        maxOutputTokens: 100,
      },
      ctx(),
    );
    expect(result.structured).toEqual({ team: "billing", urgency: 2 });
    expect(result.model).toBe("gpt-5.4-mini-2026-08-01");
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.priceSnapshot).not.toBeNull();
    expect(calls[0]?.body).toMatchObject({
      max_completion_tokens: 100,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
  });

  it("maps context-length errors to BoundsExceeded", async () => {
    const { http } = serve("error-context-length");
    const client = clientFor(PRESETS.openai, {
      model: "gpt-5.4-mini",
      credential: { apiKey: "k" },
      http,
      catalog,
    });
    await expect(
      client.generate({ messages: [{ role: "user", content: "x" }] }, ctx()),
    ).rejects.toMatchObject({ code: "BOUNDS_EXCEEDED" });
  });
});

describe("presets", () => {
  it("streams Gemini through its OpenAI-compatible endpoint, priced from the google catalog", async () => {
    const { http, calls } = serve("gemini-text");
    const gemini = googleFactory().create({
      model: "gemini-3.5-flash",
      credential: { apiKey: "AIza-test" },
      http,
      catalog,
    });
    const chunks = await collect(gemini);
    expect(chunks.filter((c) => c.type === "text").length).toBe(2);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(gemini.id).toBe("google");
    expect(
      catalog.price("google", "gemini-3.5-flash", { inputTokens: 800, outputTokens: 12 }).costUsd,
    ).toBeGreaterThan(0);
  });

  it("resolves presets and custom base URLs for openai-compatible", () => {
    const http: SafeFetch = () => Promise.reject(new Error("unused"));
    const groq = openaiCompatibleFactory().create({
      model: "llama-4",
      credential: { apiKey: "gsk" },
      options: { preset: "groq" },
      http,
      catalog,
    });
    expect(groq.id).toBe("openai-compatible:groq");
    const custom = openaiCompatibleFactory().create({
      model: "m",
      credential: { apiKey: "k", baseUrl: "https://llm.internal.example/v1" },
      http,
      catalog,
    });
    expect(custom.id).toBe("openai-compatible");
    const vllm = openaiCompatibleFactory().create({
      model: "m",
      credential: undefined,
      options: { preset: "vllm" },
      http,
      catalog,
    });
    expect(vllm.id).toBe("openai-compatible:vllm");
    expect(() =>
      openaiCompatibleFactory().create({ model: "m", credential: { apiKey: "k" }, http, catalog }),
    ).toThrow(/preset or a baseUrl/);
    expect(() => openaiFactory().create({ model: "m", credential: {}, http, catalog })).toThrow(
      /needs an API key/,
    );
  });

  it("sends OpenRouter's attribution headers and discovers models", async () => {
    let seen: Record<string, string> = {};
    const http: SafeFetch = (_url, init) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: "z-model" }, { id: "a-model" }] })),
      );
    };
    expect(await listModels(PRESETS.openrouter, "or-key", http, catalog)).toEqual([
      "a-model",
      "z-model",
    ]);
    expect(seen).toMatchObject({
      authorization: "Bearer or-key",
      "HTTP-Referer": expect.any(String) as string,
      "X-Title": "FlowAId",
    });
  });

  it("registers generation and embedding factories for openai, google and compatible endpoints", () => {
    expect(
      openaiFactories()
        .map((f) => `${f.kind}:${f.id}`)
        .sort(),
    ).toEqual([
      "embedding:google",
      "embedding:openai",
      "embedding:openai-compatible",
      "generation:google",
      "generation:openai",
      "generation:openai-compatible",
    ]);
  });
});
