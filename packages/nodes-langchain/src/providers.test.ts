import { describe, expect, it } from "vitest";
import type {
  DecisionCallContext,
  GenerationChunk,
  GenerationProvider,
  ModelCatalog,
  SafeFetch,
} from "@flowaid/workflow-core";
import {
  langchainAnthropic,
  langchainOllama,
  langchainOpenAI,
  langchainOpenAIEmbeddings,
} from "./index.js";
import {
  ANTHROPIC_STREAM,
  OPENAI_COMPLETION,
  OPENAI_TEXT_STREAM,
  OPENAI_TOOL_STREAM,
} from "./test/fixtures.js";
import { fakeHttp, json } from "./test/fakes.js";

const call: DecisionCallContext = {
  signal: new AbortController().signal,
  runId: "run_1",
  nodeRunId: "nr_1",
  idempotencyKey: null,
};
const catalog: ModelCatalog = {
  get: () => undefined,
  list: () => [],
  resolveAlias: (_p, m) => m,
  price: (provider, _m, u) => ({
    costUsd: provider === "openai" ? (u.inputTokens * 0.4 + u.outputTokens * 1.6) / 1e6 : 0,
    snapshot: provider === "openai" ? { inputPerMTok: 0.4, outputPerMTok: 1.6 } : null,
  }),
};
const stream = (body: string) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });

async function collect(p: GenerationProvider, tools = false): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const c of p.stream(
    {
      messages: [{ role: "user", content: "Say hello" }],
      ...(tools
        ? {
            tools: [
              {
                name: "weather",
                description: "Weather for a city",
                inputSchema: {
                  type: "object",
                  properties: { city: { type: "string" } },
                  required: ["city"],
                },
                idempotency: "safe" as const,
                approvalRequired: false,
                source: { kind: "http" as const },
              },
            ],
          }
        : {}),
    },
    call,
  ))
    out.push(c);
  return out;
}
const textOf = (chunks: GenerationChunk[]) =>
  chunks.flatMap((c) => (c.type === "text" ? [c.delta] : [])).join("");

function create(
  factory: ReturnType<typeof langchainOpenAI>,
  http: SafeFetch,
  credential: Record<string, string>,
  model: string,
) {
  return factory.create({ model, credential, options: undefined, http, catalog });
}

describe("langchain:openai (recorded Chat Completions streams through SafeFetch)", () => {
  it("streams text and usage, and every request goes through SafeFetch with the credential", async () => {
    const http = fakeHttp({
      "https://api.openai.com/v1/chat/completions": () => stream(OPENAI_TEXT_STREAM),
    });
    const provider = create(langchainOpenAI(), http, { apiKey: "sk-test-123" }, "gpt-4.1-mini");
    expect(provider).toMatchObject({ id: "langchain:openai", model: "gpt-4.1-mini" });
    const chunks = await collect(provider);
    expect(textOf(chunks)).toBe("Hello from OpenAI.");
    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 19, outputTokens: 4 },
    });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.headers.authorization).toBe("Bearer sk-test-123");
    expect(http.requests[0]?.body).toMatchObject({
      model: "gpt-4.1-mini",
      stream: true,
      messages: [{ role: "user", content: "Say hello" }],
    });
  });

  it("streams tool-call argument deltas", async () => {
    const http = fakeHttp({
      "https://api.openai.com/v1/chat/completions": () => stream(OPENAI_TOOL_STREAM),
    });
    const chunks = await collect(
      create(langchainOpenAI(), http, { apiKey: "sk" }, "gpt-4.1-mini"),
      true,
    );
    const args = chunks.flatMap((c) => (c.type === "tool_call" ? [c.argsDelta] : [])).join("");
    expect(JSON.parse(args)).toEqual({ city: "Oslo" });
    expect(chunks.find((c) => c.type === "tool_call")).toMatchObject({
      id: "call_rec1",
      name: "weather",
    });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
    expect(
      (http.requests[0]?.body as { tools: { function: { name: string } }[] }).tools[0]?.function
        .name,
    ).toBe("weather");
  });

  it("generates with per-call settings, cache reads and catalog pricing", async () => {
    const http = fakeHttp({
      "https://api.openai.com/v1/chat/completions": () => json(OPENAI_COMPLETION),
    });
    const provider = create(langchainOpenAI(), http, { apiKey: "sk" }, "gpt-4.1-mini");
    const r = await provider.generate(
      { messages: [{ role: "user", content: "x" }], temperature: 0, maxOutputTokens: 3 },
      call,
    );
    expect(r).toMatchObject({
      text: "Plain answer.",
      finishReason: "length",
      usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 },
      provider: "langchain:openai",
      priceSnapshot: { inputPerMTok: 0.4 },
    });
    expect(r.costUsd).toBeCloseTo((7 * 0.4 + 3 * 1.6) / 1e6);
    expect(http.requests[0]?.body).toMatchObject({ temperature: 0, max_tokens: 3 });
  });

  it("maps HTTP failures onto the flowaid taxonomy and requires a key", async () => {
    const http = fakeHttp({
      "https://api.openai.com/v1/chat/completions": () =>
        json(
          { error: { message: "Incorrect API key provided", type: "invalid_request_error" } },
          401,
        ),
    });
    await expect(
      create(langchainOpenAI(), http, { apiKey: "bad" }, "gpt-4.1-mini").generate(
        { messages: [{ role: "user", content: "x" }] },
        call,
      ),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ERROR" });
    const limited = fakeHttp({
      "https://api.openai.com/v1/chat/completions": () =>
        new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
          status: 429,
          headers: { "retry-after": "3" },
        }),
    });
    await expect(
      create(langchainOpenAI(), limited, { apiKey: "k" }, "gpt-4.1-mini").generate(
        { messages: [{ role: "user", content: "x" }] },
        call,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    expect(() =>
      create(langchainOpenAI(), limited, {}, "gpt-4.1-mini").generate({ messages: [] }, call),
    ).toThrow(/API key/);
  });

  it("embeds through OpenAIEmbeddings", async () => {
    const http = fakeHttp({
      "https://api.openai.com/v1/embeddings": (req) =>
        json({
          object: "list",
          data: (req.body as { input: string[] }).input.map((_, index) => ({
            object: "embedding",
            index,
            embedding: [0.1, 0.2, 0.3],
          })),
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
    });
    const provider = langchainOpenAIEmbeddings().create({
      model: "text-embedding-3-small",
      credential: { apiKey: "sk" },
      options: undefined,
      http,
      catalog,
    });
    const r = await provider.embed(["alpha", "beta"], call);
    expect(r.vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ]);
    expect(provider.dimensions).toBe(3);
  });
});

describe("langchain:anthropic (recorded Messages stream through SafeFetch)", () => {
  it("streams text with split usage (input + cache read on start, output on delta)", async () => {
    const http = fakeHttp({
      "https://api.anthropic.com/v1/messages": () => stream(ANTHROPIC_STREAM),
    });
    const provider = create(
      langchainAnthropic(),
      http,
      { apiKey: "sk-ant-test" },
      "claude-sonnet-4-5",
    );
    const chunks = await collect(provider);
    expect(textOf(chunks)).toBe("Hi from Claude.");
    const usage = chunks.find((c) => c.type === "usage");
    // LangChain reports input including cache reads (25 + 8) and sums per-chunk output tokens, as
    // its own `concat` of the chunks does.
    expect(usage).toEqual({
      type: "usage",
      usage: { inputTokens: 33, outputTokens: 7, cacheReadTokens: 8 },
    });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(http.requests[0]?.headers["x-api-key"]).toBe("sk-ant-test");
    expect(http.requests[0]?.body).toMatchObject({
      model: "claude-sonnet-4-5",
      stream: true,
      max_tokens: 4096,
    });
  });
});

describe("langchain:ollama", () => {
  it("targets the credential's host through SafeFetch", async () => {
    const http = fakeHttp({
      "http://ollama.internal:11434/api/chat": () =>
        new Response(
          `${JSON.stringify({ model: "llama3.2", created_at: "2026-01-01T00:00:00Z", message: { role: "assistant", content: "Local hi" }, done: false })}\n${JSON.stringify({ model: "llama3.2", created_at: "2026-01-01T00:00:01Z", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 5, eval_count: 2 })}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        ),
    });
    const provider = create(
      langchainOllama(),
      http,
      { host: "http://ollama.internal:11434", token: "tok" },
      "llama3.2",
    );
    const chunks = await collect(provider);
    expect(textOf(chunks)).toBe("Local hi");
    expect(http.requests[0]?.headers.authorization).toBe("Bearer tok");
  });
});
