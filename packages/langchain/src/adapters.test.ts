import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AIMessage, ToolMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { RunnableLambda } from "@langchain/core/runnables";
import {
  BoundsExceededError,
  CancelledError,
  CredentialError,
  ProviderRateLimitedError,
  type DecisionCallContext,
  type GenerationChunk,
  type ModelCatalog,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import {
  FlowaidCallbackHandler,
  FlowaidChatModel,
  FlowaidEmbeddings,
  LangChainDecisionProvider,
  LangChainEmbeddingProvider,
  LangChainGenerationProvider,
  fromLangChainMessages,
  fromLangChainTool,
  jsonSchemaToZod,
  langChainGenerationFactory,
  listRunnables,
  registerRunnable,
  runnableFromRegistry,
  toLangChainMessages,
  toLangChainTool,
  toProviderError,
  unregisterRunnable,
  workflowAsLangChainTool,
  zodToJsonSchema,
  type CallbackSink,
} from "./index.js";
import { HashEmbeddings, ScriptedChatModel, scriptedProvider } from "./test/fakes.js";

const call = (signal = new AbortController().signal): DecisionCallContext => ({
  signal,
  runId: "run_1",
  nodeRunId: "nr_1",
  idempotencyKey: null,
});

const catalog: ModelCatalog = {
  get: () => undefined,
  list: () => [],
  resolveAlias: (_p, m) => m,
  price: (_p, _m, u) => ({
    costUsd: (u.inputTokens * 1 + u.outputTokens * 2) / 1_000_000,
    snapshot: { inputPerMTok: 1, outputPerMTok: 2 },
  }),
};

async function collect(it: AsyncIterable<GenerationChunk>): Promise<GenerationChunk[]> {
  const out: GenerationChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("message bridges", () => {
  it("round-trips system, user (text + image), assistant tool calls and tool results", () => {
    const messages = [
      { role: "system" as const, content: "be brief" },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "what is this?" },
          { type: "image" as const, mimeType: "image/png", data: "iVBOR" },
        ],
      },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [{ id: "c1", name: "lookup", args: { q: "x" } }],
      },
      { role: "tool" as const, content: "42", toolCallId: "c1" },
    ];
    const lc = toLangChainMessages(messages);
    expect(lc.map((m) => m.getType())).toEqual(["system", "human", "ai", "tool"]);
    expect((lc[2] as AIMessage).tool_calls?.[0]).toMatchObject({ id: "c1", name: "lookup" });
    expect((lc[3] as ToolMessage).tool_call_id).toBe("c1");
    expect(fromLangChainMessages(lc)).toEqual(messages);
  });
});

describe("schema bridges", () => {
  it("converts JSON Schema to an enforcing Zod schema and reports what it cannot enforce", () => {
    const { schema, warnings } = jsonSchemaToZod({
      type: "object",
      properties: {
        city: { type: "string", minLength: 2 },
        days: { type: "integer", minimum: 1, maximum: 7 },
        units: { enum: ["c", "f"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 2 },
        note: { type: ["string", "null"] },
        extra: { $ref: "#/$defs/x" },
      },
      required: ["city", "days"],
      additionalProperties: false,
    });
    expect(schema.safeParse({ city: "Oslo", days: 3, units: "c", note: null }).success).toBe(true);
    expect(schema.safeParse({ city: "O", days: 3 }).success).toBe(false);
    expect(schema.safeParse({ city: "Oslo", days: 9 }).success).toBe(false);
    expect(schema.safeParse({ city: "Oslo", days: 2, other: 1 }).success).toBe(false);
    expect(schema.safeParse({ city: "Oslo", days: 2, tags: ["a", "b", "c"] }).success).toBe(false);
    expect(warnings).toEqual([
      { path: "/properties/extra/$ref", message: "'$ref' is not enforced" },
    ]);
  });

  it("emits draft 2020-12 JSON Schema from Zod", () => {
    expect(zodToJsonSchema(z.object({ a: z.string(), b: z.number().optional() }))).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a"],
    });
  });
});

describe("LangChainGenerationProvider", () => {
  it("generates text with usage (cache reads), finish reason, latency and catalog pricing", async () => {
    const model = new ScriptedChatModel([
      { text: "hello", usage: { input: 10, output: 4, cacheRead: 6 }, finish: "stop" },
    ]);
    const p = new LangChainGenerationProvider(model, {
      id: "langchain:scripted",
      pricing: { catalog, provider: "openai" },
    });
    expect(p).toMatchObject({ id: "langchain:scripted", model: "scripted-1" });
    const r = await p.generate(
      { messages: [{ role: "user", content: "hi" }], stop: ["\n"] },
      call(),
    );
    expect(r).toMatchObject({
      text: "hello",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6 },
      provider: "langchain:scripted",
      model: "scripted-1",
      priceSnapshot: { inputPerMTok: 1 },
    });
    expect(r.costUsd).toBeCloseTo(18 / 1_000_000);
    expect(model.log.options[0]).toMatchObject({ stop: ["\n"], signal: true });
    expect(p.health().status).toBe("healthy");
  });

  it("binds tools with the requested choice and returns tool calls", async () => {
    const model = new ScriptedChatModel([
      { toolCalls: [{ id: "t1", name: "weather", args: { city: "Oslo" } }], finish: "tool_calls" },
    ]);
    const p = new LangChainGenerationProvider(model);
    const tool: ToolDefinition = {
      name: "weather",
      description: "Weather",
      inputSchema: { type: "object", properties: { city: { type: "string" } } },
      idempotency: "safe",
      approvalRequired: false,
      source: { kind: "http" },
    };
    const r = await p.generate(
      { messages: [{ role: "user", content: "weather?" }], tools: [tool], toolChoice: "required" },
      call(),
    );
    expect(r.toolCalls).toEqual([{ id: "t1", name: "weather", args: { city: "Oslo" } }]);
    expect(r.finishReason).toBe("tool_calls");
    expect(model.log.options.find((o) => "bindTools" in o)).toEqual({
      bindTools: { tool_choice: "any" },
    });
    expect(JSON.stringify(model.log.tools[0])).toContain('"name":"weather"');
  });

  it("returns structured output through withStructuredOutput, keeping usage from the raw message", async () => {
    const model = new ScriptedChatModel([
      {
        toolCalls: [{ id: "s1", name: "response", args: { label: "bug", score: 0.9 } }],
        usage: { input: 30, output: 8 },
      },
    ]);
    const r = await new LangChainGenerationProvider(model).generate(
      {
        messages: [{ role: "user", content: "classify" }],
        responseFormat: {
          type: "json_schema",
          strict: true,
          schema: {
            type: "object",
            properties: { label: { type: "string" }, score: { type: "number" } },
            required: ["label", "score"],
          },
        },
      },
      call(),
    );
    expect(r.structured).toEqual({ label: "bug", score: 0.9 });
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 8 });
  });

  it("streams text, reasoning, tool-call argument deltas, usage and the finish reason", async () => {
    const model = new ScriptedChatModel([
      {
        text: "Checking the weather",
        reasoning: "need a tool",
        toolCalls: [{ id: "t1", name: "weather", args: { city: "Oslo" } }],
        usage: { input: 12, output: 9 },
        finish: "tool_calls",
      },
    ]);
    const chunks = await collect(
      new LangChainGenerationProvider(model).stream(
        { messages: [{ role: "user", content: "hi" }] },
        call(),
      ),
    );
    const text = chunks.flatMap((c) => (c.type === "text" ? [c.delta] : [])).join("");
    const args = chunks.flatMap((c) => (c.type === "tool_call" ? [c.argsDelta] : [])).join("");
    expect(text).toBe("Checking the weather");
    expect(chunks.find((c) => c.type === "thinking")).toEqual({
      type: "thinking",
      delta: "need a tool",
    });
    expect(chunks.find((c) => c.type === "tool_call")).toMatchObject({
      index: 0,
      id: "t1",
      name: "weather",
    });
    expect(JSON.parse(args)).toEqual({ city: "Oslo" });
    expect(chunks.at(-2)).toEqual({ type: "usage", usage: { inputTokens: 12, outputTokens: 9 } });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "tool_calls" });
  });

  it("builds the model per sampling setting when given a builder", async () => {
    const settings: unknown[] = [];
    const p = new LangChainGenerationProvider((s) => {
      settings.push(s);
      return new ScriptedChatModel([{ text: "ok" }]);
    });
    await p.generate({ messages: [{ role: "user", content: "a" }], temperature: 0 }, call());
    await p.generate({ messages: [{ role: "user", content: "b" }], temperature: 0 }, call());
    expect(settings).toEqual([{}, { temperature: 0 }]);
  });

  it("maps vendor errors onto the flowaid taxonomy", async () => {
    const rate = Object.assign(new Error("slow down"), {
      status: 429,
      headers: { "retry-after": "2" },
    });
    const p = new LangChainGenerationProvider(new ScriptedChatModel([{ error: rate }]));
    await expect(
      p.generate({ messages: [{ role: "user", content: "x" }] }, call()),
    ).rejects.toEqual(new ProviderRateLimitedError("langchain:scripted", 2000));
    expect(
      toProviderError(Object.assign(new Error("bad key"), { status: 401 }), "x"),
    ).toBeInstanceOf(CredentialError);
    expect(
      toProviderError(Object.assign(new Error("x"), { name: "AbortError" }), "x"),
    ).toBeInstanceOf(CancelledError);
    expect(toProviderError(new Error("prompt is too long"), "x")).toBeInstanceOf(
      BoundsExceededError,
    );
    expect(toProviderError(Object.assign(new Error("boom"), { status: 500 }), "x").retryable).toBe(
      true,
    );
  });
});

describe("LangChainDecisionProvider", () => {
  it("answers typed decisions through withStructuredOutput with the LLM decision rules", async () => {
    const model = new ScriptedChatModel([
      {
        toolCalls: [{ id: "d", name: "response", args: { q: { p_yes: 0.8 } } }],
        usage: { input: 50, output: 5 },
      },
    ]);
    const d = new LangChainDecisionProvider(model);
    expect(d).toMatchObject({ id: "llm", model: "scripted-1" });
    const result = await d.decideBoolean(
      "The customer asked for a refund",
      { kind: "boolean", instructions: "Is this a refund request?" },
      call(),
    );
    expect(result).toMatchObject({ kind: "boolean", value: true, pYes: 0.8, provider: "llm" });
  });
});

describe("LangChainEmbeddingProvider", () => {
  it("embeds, learns the dimensions and estimates usage", async () => {
    const p = new LangChainEmbeddingProvider(new HashEmbeddings(), {
      id: "langchain:hash",
      model: "hash",
    });
    const r = await p.embed(["hello world", "abc 123"], call());
    expect(r.vectors).toHaveLength(2);
    expect(p.dimensions).toBe(4);
    expect(r.usage.inputTokens).toBe(3 + 2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(p.embed(["x"], call(aborted.signal))).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("flowaid providers as LangChain components", () => {
  it("FlowaidChatModel answers with tool calls, usage and cost, and binds tools as ToolDefinitions", async () => {
    const provider = scriptedProvider([
      {
        text: "",
        toolCalls: [{ id: "c1", name: "add", args: { a: 1, b: 2 } }],
        finishReason: "tool_calls",
      },
    ]);
    const seen: number[] = [];
    const model = new FlowaidChatModel({
      provider,
      context: call(),
      onResult: (r) => seen.push(r.costUsd),
    });
    const add = new DynamicStructuredTool({
      name: "add",
      description: "adds",
      schema: z.object({ a: z.number(), b: z.number() }),
      func: ({ a, b }) => Promise.resolve(String(a + b)),
    });
    const out = await model
      .bindTools([add], { tool_choice: "any" })
      .invoke([new HumanMessage("1+2?")]);
    expect(out.tool_calls).toEqual([
      { id: "c1", name: "add", args: { a: 1, b: 2 }, type: "tool_call" },
    ]);
    expect(out.usage_metadata).toMatchObject({ input_tokens: 5, output_tokens: 7 });
    expect(provider.requests[0]).toMatchObject({
      toolChoice: "required",
      tools: [{ name: "add", inputSchema: { type: "object", required: ["a", "b"] } }],
    });
    expect(seen).toEqual([0.002]);
  });

  it("FlowaidChatModel streams provider deltas as LangChain chunks", async () => {
    const provider = scriptedProvider([{ text: "streamed answer" }]);
    const model = new FlowaidChatModel({ provider, context: call(), streaming: true });
    let text = "";
    for await (const chunk of await model.stream([new HumanMessage("go")])) text += chunk.text;
    expect(text).toBe("streamed answer");
    const res = await model.invoke([new HumanMessage("again")]);
    expect(res.text).toBe("streamed answer");
  });

  it("FlowaidEmbeddings batches through the provider", async () => {
    const calls: number[] = [];
    const embeddings = new FlowaidEmbeddings({
      provider: {
        id: "e",
        model: "e",
        dimensions: 2,
        embed: (texts) => {
          calls.push(texts.length);
          return Promise.resolve({
            vectors: texts.map((t) => [t.length, 1]),
            usage: { inputTokens: texts.length, outputTokens: 0 },
            costUsd: 0,
          });
        },
        health: () => ({
          status: "healthy",
          errorRate1m: 0,
          p95LatencyMs: 0,
          consecutiveFailures: 0,
          checkedAt: "",
        }),
      },
      context: call(),
      batchSize: 2,
    });
    expect(await embeddings.embedDocuments(["a", "bb", "ccc"])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(await embeddings.embedQuery("dddd")).toEqual([4, 1]);
    expect(calls).toEqual([2, 1, 1]);
  });
});

describe("tool adapters", () => {
  const def: ToolDefinition = {
    name: "lookup_order",
    description: "Find an order",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", pattern: "^ord_" } },
      required: ["id"],
    },
    idempotency: "safe",
    approvalRequired: false,
    source: { kind: "http" },
  };

  it("toLangChainTool validates arguments and returns content with the structured artifact", async () => {
    const tool = toLangChainTool(def, (args) =>
      Promise.resolve({ ok: true, content: "shipped", structured: { args }, latencyMs: 1 }),
    );
    const msg = await tool.invoke({
      type: "tool_call",
      id: "c1",
      name: "lookup_order",
      args: { id: "ord_1" },
    });
    expect(msg.content).toBe("shipped");
    expect(msg.artifact).toEqual({ args: { id: "ord_1" } });
    await expect(tool.invoke({ id: "nope" })).rejects.toThrow();
    const failing = toLangChainTool(def, () => Promise.reject(new CredentialError("no key")));
    const res = await failing.invoke({
      type: "tool_call",
      id: "c2",
      name: "lookup_order",
      args: { id: "ord_2" },
    });
    expect(res.content).toBe("Error (CREDENTIAL_ERROR): no key");
  });

  it("fromLangChainTool produces a ToolDefinition and a ToolResult executor", async () => {
    const lc = new DynamicStructuredTool({
      name: "multiply",
      description: "multiplies",
      schema: z.object({ a: z.number(), b: z.number() }),
      metadata: { idempotency: "safe", capability: "math.use" },
      func: ({ a, b }) => Promise.resolve(JSON.stringify({ product: a * b })),
    });
    const { definition, execute } = fromLangChainTool(lc);
    expect(definition).toMatchObject({
      name: "multiply",
      idempotency: "safe",
      capability: "math.use",
      inputSchema: { type: "object", required: ["a", "b"] },
      source: { kind: "builtin", id: "multiply" },
    });
    expect(await execute({ a: 3, b: 4 }, {})).toMatchObject({
      ok: true,
      structured: { product: 12 },
    });
    expect(await execute({ a: "x" }, {})).toMatchObject({
      ok: false,
      error: { code: expect.any(String) },
    });
  });

  it("workflowAsLangChainTool runs the workflow through the client", async () => {
    const tool = workflowAsLangChainTool(
      {
        runWorkflow: (id, input) =>
          Promise.resolve(
            (input as { q: string }).q === "fail"
              ? { status: "failed", error: { code: "NODE_EXECUTION_ERROR", message: "nope" } }
              : { status: "completed", output: { id, answer: 42 } },
          ),
      },
      "00000000-0000-4000-8000-000000000009",
      {
        name: "ask_flow",
        description: "Ask the flow",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
    );
    const ok = await tool.invoke({
      type: "tool_call",
      id: "a",
      name: "ask_flow",
      args: { q: "hi" },
    });
    expect(JSON.parse(ok.content as string)).toMatchObject({ answer: 42 });
    const bad = await tool.invoke({
      type: "tool_call",
      id: "b",
      name: "ask_flow",
      args: { q: "fail" },
    });
    expect(bad.content).toBe("Error (SUBFLOW_ERROR): nope");
  });
});

describe("FlowaidCallbackHandler", () => {
  function sink() {
    const logs: { level: string; message: string }[] = [];
    const deltas: string[] = [];
    const metrics: { name: string; value: number }[] = [];
    const s: CallbackSink = {
      log: (level, message) => logs.push({ level, message }),
      stream: (_c, d) => deltas.push(d),
      metric: (name, value) => metrics.push({ name, value }),
    };
    return { s, logs, deltas, metrics };
  }

  it("logs model, tool and retriever activity, streams tokens and meters usage", async () => {
    const { s, logs, deltas, metrics } = sink();
    const handler = new FlowaidCallbackHandler(s, {
      redact: (t) => t.replace(/secret-\w+/g, "[redacted]"),
    });
    const model = new ScriptedChatModel([{ text: "Paris", usage: { input: 11, output: 2 } }]);
    const chain = RunnableLambda.from((q: string) => [
      new HumanMessage(`capital? secret-abc ${q}`),
    ]).pipe(model);
    let streamed = "";
    for await (const c of await chain.stream("France", { callbacks: [handler] }))
      streamed += c.text;
    expect(streamed).toBe("Paris");
    expect(deltas.join("")).toBe("Paris");
    expect(logs.map((l) => l.message)).toEqual(
      expect.arrayContaining([
        "langchain: ScriptedChatModel started",
        "langchain: ScriptedChatModel finished",
      ]),
    );
    expect(JSON.stringify(logs)).not.toContain("secret-abc");
    expect(handler.usage).toEqual({ inputTokens: 11, outputTokens: 2 });
    expect(metrics).toContainEqual({ name: "langchain.tokens.input", value: 11 });

    const tool = new DynamicStructuredTool({
      name: "echo",
      description: "echo",
      schema: z.object({ v: z.string() }),
      func: ({ v }) => Promise.resolve(v),
    });
    await tool.invoke({ v: "x" }, { callbacks: [handler] });
    expect(handler.toolCalls).toBe(1);
    expect(logs.map((l) => l.message)).toContain("langchain: tool echo returned");
  });

  it("aborts its signal with BoundsExceededError when the token or cost budget is exceeded", async () => {
    const { s } = sink();
    const handler = new FlowaidCallbackHandler(
      { ...s, remaining: { costUsd: null, tokens: 20 } },
      { maxTokens: 100 },
    );
    const model = new ScriptedChatModel([{ text: "a", usage: { input: 15, output: 10 } }]);
    await model.invoke([new HumanMessage("x")], { callbacks: [handler] });
    expect(handler.signal.aborted).toBe(true);
    expect(handler.exceeded).toEqual(new BoundsExceededError("maxTokens", 20, 25));

    const costly = new FlowaidCallbackHandler(s, { maxCostUsd: 0.01, countUsage: false });
    costly.account({ inputTokens: 1, outputTokens: 1 }, 0.02);
    expect(costly.exceeded?.bound).toBe("maxCostUsd");
  });
});

describe("runnable registry and provider factories", () => {
  it("registers, lists and resolves LCEL runnable factories by name", async () => {
    unregisterRunnable();
    registerRunnable("acme.upper", () => RunnableLambda.from((s: string) => s.toUpperCase()), {
      description: "Upper-cases",
    });
    expect(() =>
      registerRunnable("acme.upper", () => RunnableLambda.from((s: string) => s)),
    ).toThrow(/already/);
    expect(() => registerRunnable("Bad Name", () => RunnableLambda.from((s: string) => s))).toThrow(
      /Invalid/,
    );
    expect(listRunnables()).toEqual([{ name: "acme.upper", description: "Upper-cases" }]);
    const r = await runnableFromRegistry("acme.upper").factory(
      {},
      { tools: [], signal: new AbortController().signal },
    );
    expect(await r.invoke("hi")).toBe("HI");
    expect(() => runnableFromRegistry("missing")).toThrow(/No LangChain runnable 'missing'/);
    unregisterRunnable();
  });

  it("langChainGenerationFactory creates langchain:<vendor> providers from the credential", async () => {
    const seen: unknown[] = [];
    const factory = langChainGenerationFactory({
      vendor: "scripted",
      credentialType: "openai.api_key",
      pricingProvider: "openai",
      build: ({ model, credential }, settings) => {
        seen.push({ model, key: credential?.apiKey, settings });
        return new ScriptedChatModel(
          [{ text: "ok", usage: { input: 1000, output: 0 } }],
          undefined,
          [],
          model,
        );
      },
    });
    expect(factory).toMatchObject({
      id: "langchain:scripted",
      kind: "generation",
      credentialType: "openai.api_key",
    });
    const provider = factory.create({
      model: "m-1",
      credential: { apiKey: "sk-test" },
      options: undefined,
      http: fetch,
      catalog,
    });
    const r = await provider.generate(
      { messages: [{ role: "user", content: "x" }], maxOutputTokens: 5 },
      call(),
    );
    expect(r).toMatchObject({ provider: "langchain:scripted", model: "m-1", text: "ok" });
    expect(r.costUsd).toBeCloseTo(0.001);
    expect(seen).toEqual([
      { model: "m-1", key: "sk-test", settings: {} },
      { model: "m-1", key: "sk-test", settings: { maxOutputTokens: 5 } },
    ]);
  });
});
