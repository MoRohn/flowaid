import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "@flowaid/providers";
import type { GenerationChunk, SafeFetch } from "@flowaid/workflow-core";
import { OllamaClient, chatBody, mapDoneReason } from "./client.js";
import { ollamaEmbeddingFactory, ollamaFactory } from "./factory.js";

const DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(`${DIR}${name}.json`, "utf8")) as { ndjson?: string; json?: unknown };
const catalog = new DefaultModelCatalog();
const ctx = () => ({
  signal: new AbortController().signal,
  runId: "r",
  nodeRunId: "n",
  idempotencyKey: null,
});

function serve(body: string | object, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const http: SafeFetch = (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body:
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    if (typeof body === "string") {
      const bytes = new TextEncoder().encode(body);
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              for (let i = 0; i < bytes.length; i += 23) c.enqueue(bytes.slice(i, i + 23));
              c.close();
            },
          }),
          { status },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { http, calls };
}

async function collect(client: OllamaClient): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const c of client.stream({ messages: [{ role: "user", content: "hi" }] }, ctx()))
    out.push(c);
  return out;
}

describe("OllamaClient", () => {
  it("streams NDJSON text with usage, at zero cost", async () => {
    const { http, calls } = serve(fixture("chat-stream").ndjson ?? "");
    const chunks = await collect(new OllamaClient({ model: "llama3.1:8b", http, catalog }));
    expect(
      chunks
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.delta : ""))
        .join(""),
    ).toBe("The duplicate will be refunded.");
    expect(chunks.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 42, outputTokens: 7 } });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(calls[0]?.url).toBe("http://localhost:11434/api/chat");
  });

  it("streams tool calls with object arguments", async () => {
    const { http } = serve(fixture("chat-tools").ndjson ?? "");
    const chunks = await collect(
      new OllamaClient({
        model: "qwen3:8b",
        http,
        catalog,
        host: "http://gpu-box:11434/",
        token: "proxy-token",
      }),
    );
    expect(chunks.filter((c) => c.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        index: 0,
        id: "call_0",
        name: "lookup_invoice",
        argsDelta: '{"customer":"cus_1"}',
      },
    ]);
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("returns structured output through `format` and maps options", async () => {
    const { http, calls } = serve(fixture("chat-structured").json as object);
    const r = await new OllamaClient({ model: "llama3.1:8b", http, catalog }).generate(
      {
        messages: [{ role: "user", content: "x" }],
        responseFormat: { type: "json_schema", schema: { type: "object" }, strict: true },
        temperature: 0,
        maxOutputTokens: 50,
        stop: ["END"],
        seed: 7,
      },
      ctx(),
    );
    expect(r).toMatchObject({
      structured: { team: "billing" },
      costUsd: 0,
      priceSnapshot: null,
      usage: { inputTokens: 50, outputTokens: 6 },
    });
    expect(calls[0]?.body).toMatchObject({
      stream: false,
      format: { type: "object" },
      options: { temperature: 0, num_predict: 50, stop: ["END"], seed: 7 },
    });
  });

  it("embeds and discovers models", async () => {
    const e = serve({ embeddings: [[0.1, 0.2]], prompt_eval_count: 3 });
    expect(
      await new OllamaClient({ model: "nomic-embed-text:v1.5", http: e.http, catalog }).embed(
        ["hi"],
        ctx(),
      ),
    ).toEqual({ vectors: [[0.1, 0.2]], usage: { inputTokens: 3, outputTokens: 0 }, costUsd: 0 });
    const t = serve({ models: [{ name: "qwen3:8b" }, { name: "llama3.1:8b" }] });
    expect(await new OllamaClient({ model: "x", http: t.http, catalog }).listModels()).toEqual([
      "llama3.1:8b",
      "qwen3:8b",
    ]);
  });

  it("maps errors and unreachable servers", async () => {
    const missing = serve({ error: "model 'nope' not found" }, 404);
    await expect(
      new OllamaClient({ model: "nope", http: missing.http, catalog }).generate(
        { messages: [{ role: "user", content: "x" }] },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: false });
    const down: SafeFetch = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    await expect(
      new OllamaClient({ model: "x", http: down, catalog }).generate(
        { messages: [{ role: "user", content: "x" }] },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
  });

  it("maps messages, tools and done reasons", () => {
    const body = chatBody(
      "m",
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "look" },
              { type: "image", mimeType: "image/png", data: "AAAA" },
            ],
          },
          { role: "assistant", content: "", toolCalls: [{ id: "t", name: "f", args: { a: 1 } }] },
          { role: "tool", content: "ok", toolCallId: "f" },
        ],
        tools: [
          {
            name: "f",
            description: "d",
            inputSchema: { type: "object" },
            idempotency: "safe",
            approvalRequired: false,
            source: { kind: "builtin", id: "f" },
          },
        ],
      },
      true,
    );
    expect(body.messages).toEqual([
      { role: "user", content: "look", images: ["AAAA"] },
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "f", arguments: { a: 1 } } }],
      },
      { role: "tool", content: "ok", tool_name: "f" },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: { name: "f", description: "d", parameters: { type: "object" } },
      },
    ]);
    expect([
      mapDoneReason("stop", false),
      mapDoneReason("length", false),
      mapDoneReason("stop", true),
      mapDoneReason(undefined, false),
    ]).toEqual(["stop", "length", "tool_calls", "stop"]);
  });

  it("builds from the ollama.host credential or the default host", () => {
    const http: SafeFetch = () => Promise.reject(new Error("unused"));
    expect(
      ollamaFactory().create({ model: "m", credential: { host: "http://h:1" }, http, catalog }).id,
    ).toBe("ollama");
    expect(
      ollamaEmbeddingFactory().create({ model: "m", credential: undefined, http, catalog }).id,
    ).toBe("ollama");
  });
});
