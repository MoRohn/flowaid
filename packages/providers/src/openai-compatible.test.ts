import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "./catalog/index.js";
import { errorFromResponse, retryAfterMs } from "./httpErrors.js";
import { OpenAICompatibleClient, chatBody, mapFinishReason } from "./openai-compatible.js";
import { collectStream } from "./streams.js";
import { chunkedResponse, ctx } from "./test/fakes.js";

const catalog = new DefaultModelCatalog();
type Call = { url: string; init: RequestInit | undefined };

function client(
  respond: (call: Call) => Response,
  extra: Partial<ConstructorParameters<typeof OpenAICompatibleClient>[0]> = {},
) {
  const calls: Call[] = [];
  const c = new OpenAICompatibleClient({
    provider: "openai",
    model: "gpt-4.1-mini",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "sk-test",
    catalog,
    http: (url, init) => {
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
    ...extra,
  });
  return {
    c,
    calls,
    body: (i = 0) => JSON.parse(calls[i]?.init?.body as string) as Record<string, unknown>,
  };
}

describe("OpenAICompatibleClient.generate", () => {
  it("posts chat completions and prices the usage, cached tokens included", async () => {
    const { c, calls, body } = client(() =>
      Response.json({
        model: "gpt-4.1-mini-2025-04-14",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      }),
    );
    const result = await c.generate(
      {
        messages: [{ role: "user", content: "hi" }],
        responseFormat: { type: "json_schema", schema: { type: "object" }, strict: true },
        maxOutputTokens: 50,
      },
      ctx(),
    );
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test",
    );
    expect(body()).toMatchObject({
      model: "gpt-4.1-mini",
      max_completion_tokens: 50,
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(result).toMatchObject({
      text: '{"ok":true}',
      structured: { ok: true },
      finishReason: "stop",
      model: "gpt-4.1-mini-2025-04-14",
    });
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 400 });
    expect(result.costUsd).toBeCloseTo((600 * 0.4 + 400 * 0.1 + 100 * 1.6) / 1e6, 12);
  });

  it("returns tool calls with parsed arguments", async () => {
    const { c, body } = client(() =>
      Response.json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "t1", function: { name: "lookup", arguments: '{"id":7}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const result = await c.generate(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "see" },
              { type: "image", mimeType: "image/png", data: "AAA" },
            ],
          },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "t0", name: "lookup", args: { id: 1 } }],
          },
          { role: "tool", content: "done", toolCallId: "t0" },
        ],
        tools: [
          {
            name: "lookup",
            description: "d",
            inputSchema: { type: "object" },
            idempotency: "safe",
            approvalRequired: false,
            source: { kind: "builtin", id: "lookup" },
          },
        ],
        toolChoice: { name: "lookup" },
        temperature: 0.2,
        topP: 0.9,
        stop: ["x"],
        seed: 1,
      },
      ctx(),
    );
    expect(result.toolCalls).toEqual([{ id: "t1", name: "lookup", args: { id: 7 } }]);
    expect(result.finishReason).toBe("tool_calls");
    expect(body()).toMatchObject({
      tool_choice: { type: "function", function: { name: "lookup" } },
      temperature: 0.2,
      top_p: 0.9,
      stop: ["x"],
      seed: 1,
    });
  });

  it("maps HTTP failures onto the error taxonomy", async () => {
    const cases: [number, Record<string, string>, string, string][] = [
      [401, {}, '{"error":{"message":"bad key"}}', "CREDENTIAL_ERROR"],
      [429, { "retry-after": "2" }, "{}", "PROVIDER_RATE_LIMITED"],
      [529, {}, "{}", "PROVIDER_OVERLOADED"],
      [500, {}, "boom", "PROVIDER_ERROR"],
      [
        400,
        {},
        '{"error":{"message":"This model\'s maximum context length is 8192"}}',
        "BOUNDS_EXCEEDED",
      ],
    ];
    for (const [status, headers, text, code] of cases) {
      const { c } = client(() => new Response(text, { status, headers }));
      await expect(c.generate({ messages: [] }, ctx())).rejects.toMatchObject({ code });
    }
    expect(errorFromResponse("p", 400, new Headers(), '{"detail":[{"msg":"bad"}]}')).toMatchObject({
      retryable: false,
    });
    expect(errorFromResponse("p", 502, new Headers(), "x")).toMatchObject({ retryable: true });
    expect(retryAfterMs("1.5")).toBe(1500);
    expect(
      retryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT")),
    ).toBe(5000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("soon")).toBeUndefined();
  });

  it("uses max_tokens for other compatible servers and maps finish reasons", () => {
    expect(chatBody("m", { messages: [], maxOutputTokens: 5 }, false, "max_tokens")).toMatchObject({
      max_tokens: 5,
    });
    expect(
      ["stop", "length", "function_call", "content_filter", null, "weird"].map(mapFinishReason),
    ).toEqual(["stop", "length", "tool_calls", "content_filter", "stop", "error"]);
  });
});

describe("OpenAICompatibleClient.stream", () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"look',
    'up","arguments":"{\\"id\\""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":3}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\n',
    "data: [DONE]\n\n",
  ];

  it("parses SSE frames split anywhere and assembles tool calls and usage", async () => {
    const { c, body } = client(() => chunkedResponse(frames));
    const seen: string[] = [];
    const result = await collectStream(
      c.stream({ messages: [{ role: "user", content: "hi" }] }, ctx()),
      {
        provider: "openai",
        model: "gpt-4.1-mini",
        catalog,
        startedAt: 0,
        now: () => 5,
      },
      (chunk) => seen.push(chunk.type),
    );
    expect(body()).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(result.text).toBe("Hello");
    expect(result.toolCalls).toEqual([{ id: "c1", name: "lookup", args: { id: 3 } }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(result.finishReason).toBe("tool_calls");
    expect(result.costUsd).toBeCloseTo((10 * 0.4 + 4 * 1.6) / 1e6, 12);
    expect(seen.at(-1)).toBe("done");
  });

  it("surfaces an error frame and an empty body", async () => {
    const { c } = client(() => chunkedResponse(['data: {"error":{"message":"overloaded"}}\n\n']));
    await expect(
      collectStream(c.stream({ messages: [] }, ctx()), {
        provider: "openai",
        model: "m",
        startedAt: 0,
        now: () => 0,
      }),
    ).rejects.toThrow(/overloaded/);
    const empty = client(() => new Response(null, { status: 200 }));
    await expect(
      collectStream(empty.c.stream({ messages: [] }, ctx()), {
        provider: "openai",
        model: "m",
        startedAt: 0,
        now: () => 0,
      }),
    ).rejects.toThrow(/empty stream/);
  });
});

describe("embeddings and discovery", () => {
  it("orders vectors by index and prices input tokens", async () => {
    const { c } = client(
      () =>
        Response.json({
          data: [
            { index: 1, embedding: [2] },
            { index: 0, embedding: [1] },
          ],
          usage: { prompt_tokens: 1_000_000 },
        }),
      {
        model: "text-embedding-3-small",
      },
    );
    const result = await c.embed(["a", "b"], ctx());
    expect(result.vectors).toEqual([[1], [2]]);
    expect(result.costUsd).toBeCloseTo(0.02);
  });

  it("lists models", async () => {
    const { c, calls } = client(() => Response.json({ data: [{ id: "b" }, { id: "a" }] }));
    expect(await c.listModels()).toEqual(["a", "b"]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
    const failing = client(() => new Response("no", { status: 403 }));
    await expect(failing.c.listModels()).rejects.toMatchObject({ code: "CREDENTIAL_ERROR" });
  });
});
