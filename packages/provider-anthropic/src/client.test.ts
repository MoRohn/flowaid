import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "@flowaid/providers";
import type { GenerationChunk, SafeFetch } from "@flowaid/workflow-core";
import {
  AnthropicClient,
  CACHE_MIN_CHARS,
  mapStopReason,
  messagesBody,
  usageOf,
} from "./client.js";
import { anthropicFactory } from "./factory.js";

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
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (let i = 0; i < bytes.length; i += 29) c.enqueue(bytes.slice(i, i + 29));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(f.json), { status: f.status ?? 200 }));
  };
  return { http, calls };
}
const client = (http: SafeFetch) =>
  new AnthropicClient({ model: "claude-sonnet-5", apiKey: "sk-ant-test", http, catalog });

describe("AnthropicClient streaming", () => {
  it("streams thinking, text and tool input deltas with cache-aware usage", async () => {
    const { http, calls } = serve("stream-tools-thinking");
    const chunks: GenerationChunk[] = [];
    for await (const c of client(http).stream(
      {
        messages: [{ role: "user", content: "refund?" }],
        tools: [
          {
            name: "lookup_invoice",
            description: "d",
            inputSchema: { type: "object" },
            idempotency: "safe",
            approvalRequired: false,
            source: { kind: "builtin", id: "lookup_invoice" },
          },
        ],
      },
      ctx(),
    ))
      chunks.push(c);
    expect(chunks.filter((c) => c.type === "thinking")).toHaveLength(1);
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.delta : ""))
        .join(""),
    ).toBe("I'll look up the invoice.");
    expect(chunks.filter((c) => c.type === "tool_call")).toEqual([
      { type: "tool_call", index: 0, argsDelta: "", id: "toolu_1", name: "lookup_invoice" },
      { type: "tool_call", index: 0, argsDelta: '{"customer": ' },
      { type: "tool_call", index: 0, argsDelta: '"cus_1"}' },
    ]);
    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { inputTokens: 2168, outputTokens: 58, cacheReadTokens: 2048 },
    });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
    });
    expect(calls[0]?.body).toMatchObject({
      stream: true,
      max_tokens: 4096,
      tools: [{ name: "lookup_invoice", input_schema: { type: "object" } }],
    });
  });

  it("surfaces in-stream errors", async () => {
    const { http } = serve("stream-error");
    const run = async () => {
      for await (const _ of client(http).stream(
        { messages: [{ role: "user", content: "x" }] },
        ctx(),
      ))
        void _;
    };
    await expect(run()).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });
});

describe("AnthropicClient requests", () => {
  it("returns structured output through the forced respond tool, priced with cache writes", async () => {
    const { http, calls } = serve("structured");
    const result = await client(http).generate(
      {
        messages: [{ role: "user", content: "triage" }],
        responseFormat: { type: "json_schema", schema: { type: "object" }, strict: true },
      },
      ctx(),
    );
    expect(result).toMatchObject({
      structured: { team: "billing", urgency: 2 },
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 1900, cacheWriteTokens: 1500 },
    });
    expect(result.costUsd).toBeGreaterThan(0);
    expect(calls[0]?.body).toMatchObject({
      tool_choice: { type: "tool", name: "respond" },
      tools: [{ name: "respond" }],
    });
  });

  it("maps 529 to overloaded", async () => {
    const { http } = serve("error-529");
    await expect(
      client(http).generate({ messages: [{ role: "user", content: "x" }] }, ctx()),
    ).rejects.toMatchObject({ code: "PROVIDER_OVERLOADED", retryable: true });
  });

  it("builds system blocks with prompt caching, tool results and tool choice", () => {
    const long = "rules ".repeat(Math.ceil(CACHE_MIN_CHARS / 6));
    const body = messagesBody(
      "claude-sonnet-5",
      {
        messages: [
          { role: "system", content: long },
          {
            role: "user",
            content: [
              { type: "text", text: "see" },
              { type: "image", mimeType: "image/png", data: "AAAA" },
            ],
          },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "t1", name: "lookup", args: { a: 1 } }],
          },
          { role: "tool", content: "found", toolCallId: "t1" },
        ],
        toolChoice: "required",
        temperature: 0.2,
        stop: ["END"],
        maxOutputTokens: 256,
      },
      false,
    );
    expect(body.system).toEqual([
      { type: "text", text: long, cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "lookup", input: { a: 1 } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "found" }] },
    ]);
    expect(body).toMatchObject({
      tool_choice: { type: "any" },
      temperature: 0.2,
      stop_sequences: ["END"],
      max_tokens: 256,
    });
    expect(
      messagesBody(
        "m",
        { messages: [{ role: "system", content: "short" }], toolChoice: { name: "x" } },
        false,
      ),
    ).toMatchObject({
      system: [{ type: "text", text: "short" }],
      tool_choice: { type: "tool", name: "x" },
    });
  });

  it("maps stop reasons and usage", () => {
    expect([
      mapStopReason("end_turn"),
      mapStopReason("max_tokens"),
      mapStopReason("tool_use"),
      mapStopReason("refusal"),
      mapStopReason(undefined),
      mapStopReason("weird"),
    ]).toEqual(["stop", "length", "tool_calls", "content_filter", "stop", "error"]);
    expect(usageOf({ input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 5 })).toEqual(
      { inputTokens: 15, outputTokens: 2, cacheWriteTokens: 5 },
    );
  });

  it("lists models and requires a key", async () => {
    const http: SafeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: "claude-sonnet-5" }, { id: "claude-haiku-4-5-20251001" }],
          }),
        ),
      );
    expect(await client(http).listModels()).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
    ]);
    expect(() => anthropicFactory().create({ model: "m", credential: {}, http, catalog })).toThrow(
      /needs an API key/,
    );
    expect(
      anthropicFactory().create({
        model: "claude-sonnet-5",
        credential: { apiKey: "k" },
        http,
        catalog,
      }).id,
    ).toBe("anthropic");
  });
});
