import { describe, expect, it } from "vitest";
import { RunnableLambda } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import {
  FlowaidChatModel,
  FlowaidEmbeddings,
  registerRunnable,
  unregisterRunnable,
} from "@flowaid/langchain";
import { normalizePackage, type StateAccess } from "@flowaid/node-sdk";
import { runNode, type TestTool } from "@flowaid/node-sdk/testing";
import type { JsonValue, ToolDefinition } from "@flowaid/workflow-core";
import {
  agentNode,
  chatNode,
  documentLoaderNode,
  embedNode,
  nodePackage,
  outputParserNode,
  retrieverNode,
  runnableNode,
  textSplitterNode,
  vectorStoreNode,
  bm25,
  chunkId,
  htmlToText,
  parseCsv,
  FlowaidRetriever,
  PineconeVectorStore,
  WorkspaceVectorStore,
  type Strategy,
} from "./index.js";
import { bowEmbeddings, fakeHttp, json, scripted } from "./test/fakes.js";

const CHAT = { provider: "openai", model: "gpt-4.1-mini" };
const EMB = { provider: "openai", model: "text-embedding-3-small" };

type Ok<T> = { kind: "ok"; output: T; usage?: unknown; costUsd?: number };
function okOf<T>(result: { kind: string }): Ok<T> {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result as Ok<T>;
}

describe("package", () => {
  it("normalizes as a plugin with @flowaid/nodes-langchain.* ids and ships langchain:* providers", () => {
    const r = normalizePackage(
      { nodePackage },
      { name: "@flowaid/nodes-langchain", version: "0.1.0" },
    );
    expect(r.ok).toBe(true);
    expect(nodePackage.nodes.map((n) => n.id).sort()).toEqual(
      [
        "agent",
        "chat",
        "document_loader",
        "embed",
        "output_parser",
        "retriever",
        "runnable",
        "text_splitter",
        "vector_store",
      ].map((n) => `@flowaid/nodes-langchain.${n}`),
    );
    expect(nodePackage.providers?.map((p) => `${p.kind}:${p.id}`).sort()).toEqual([
      "embedding:langchain:ollama",
      "embedding:langchain:openai",
      "generation:langchain:anthropic",
      "generation:langchain:ollama",
      "generation:langchain:openai",
    ]);
  });
});

describe("chat", () => {
  it("formats the LangChain prompt template, streams deltas and reports usage", async () => {
    const provider = scripted([
      { text: "Paris is the capital.", usage: { inputTokens: 20, outputTokens: 6 } },
    ]);
    const { result, recorder } = await runNode(chatNode, {
      config: {
        model: CHAT,
        messages: [
          { role: "system", content: "Answer about {country}." },
          { role: "human", content: "What is the capital of {country}? Reply as {{json}}." },
        ],
      },
      input: { variables: { country: "France" } },
      providers: { generation: provider },
    });
    const out = okOf<{ text: string; usage: unknown }>(result);
    expect(out.output.text).toBe("Paris is the capital.");
    expect(recorder.deltas.map((d) => d.delta).join("")).toBe("Paris is the capital.");
    expect(provider.requests[0]?.messages).toEqual([
      { role: "system", content: "Answer about France." },
      { role: "user", content: "What is the capital of France? Reply as {json}." },
    ]);
    expect(out.usage).toEqual({ inputTokens: 20, outputTokens: 6 });
  });

  it("inserts history, returns structured output and offers workflow tools", async () => {
    const provider = scripted([
      (req) => ({
        text: "",
        structured: { city: "Paris" },
        toolCalls: req.tools?.length ? [{ id: "t1", name: "geo", args: { q: "Paris" } }] : [],
      }),
    ]);
    const geo: TestTool = {
      definition: {
        name: "geo",
        description: "Geocode",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
        idempotency: "safe",
        approvalRequired: false,
        source: { kind: "http" },
      },
      handler: () => ({ ok: true, content: "", latencyMs: 0 }),
    };
    const { result } = await runNode(chatNode, {
      config: {
        model: CHAT,
        includeHistory: true,
        outputSchema: { type: "object", properties: { city: { type: "string" } } },
        tools: ["geo"],
        messages: [{ role: "human", content: "{q}" }],
      },
      input: {
        variables: { q: "Where?" },
        history: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
      providers: { generation: provider },
      tools: [geo],
    });
    const out = okOf<{ structured: unknown; tool_calls: unknown[] }>(result);
    expect(out.output.structured).toEqual({ city: "Paris" });
    expect(out.output.tool_calls).toEqual([{ id: "t1", name: "geo", args: { q: "Paris" } }]);
    expect(provider.requests[0]?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(provider.requests[0]?.responseFormat).toMatchObject({ type: "json_schema" });
  });
});

describe("runnable", () => {
  it("runs a registered LCEL runnable with the node's model and checks the output schema", async () => {
    unregisterRunnable();
    registerRunnable("test.summarize", (config, services) =>
      RunnableLambda.from(async (input: { text: string }) => {
        const answer = await services.chatModel?.invoke([
          new HumanMessage(`${config.style as string}: ${input.text}`),
        ]);
        return { summary: answer?.text ?? "", tools: services.tools.length };
      }),
    );
    const provider = scripted([
      { text: "short", usage: { inputTokens: 30, outputTokens: 2 }, costUsd: 0.003 },
    ]);
    const base = {
      runnable: "test.summarize",
      params: { style: "terse" },
      model: CHAT,
      outputSchema: {
        type: "object",
        required: ["summary"],
        properties: { summary: { type: "string" } },
      },
    };
    const { result } = await runNode(runnableNode, {
      config: base,
      input: { input: { text: "a long text" } },
      providers: { generation: provider },
    });
    const out = okOf<{ output: unknown }>(result);
    expect(out.output.output).toEqual({ summary: "short", tools: 0 });
    expect(out.costUsd).toBeCloseTo(0.003);
    expect(provider.requests[0]?.messages[0]?.content).toBe("terse: a long text");

    const mismatch = await runNode(runnableNode, {
      config: { ...base, outputSchema: { type: "object", required: ["title"] } },
      input: { input: { text: "x" } },
      providers: { generation: provider },
    });
    expect(mismatch.result).toMatchObject({
      kind: "error",
      error: { code: "OUTPUT_SCHEMA_MISMATCH" },
    });

    const bounded = await runNode(runnableNode, {
      config: { ...base, maxTokens: 10 },
      input: { input: { text: "x" } },
      providers: { generation: provider },
    });
    expect(bounded.result).toMatchObject({ kind: "error", error: { code: "BOUNDS_EXCEEDED" } });
    unregisterRunnable();
  });

  it("fails clearly for an unknown runnable", async () => {
    const { result } = await runNode(runnableNode, {
      config: { runnable: "missing.chain" },
      input: { input: 1 },
    });
    expect(result).toMatchObject({ kind: "error", error: { code: "NOT_FOUND" } });
  });
});

describe("agent", () => {
  const lookup: ToolDefinition = {
    name: "lookup_order",
    description: "Look up an order by id",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    idempotency: "safe",
    approvalRequired: false,
    source: { kind: "http" },
  };
  const refund: ToolDefinition = {
    ...lookup,
    name: "refund_order",
    description: "Refund an order",
    approvalRequired: true,
  };
  const tools = (log: string[]): TestTool[] => [
    {
      definition: lookup,
      handler: (a) => (
        log.push(`lookup ${JSON.stringify(a)}`),
        { ok: true, content: "shipped on Monday", latencyMs: 1 }
      ),
    },
    {
      definition: refund,
      handler: (a) => (
        log.push(`refund ${JSON.stringify(a)}`),
        { ok: true, content: "refunded", latencyMs: 1 }
      ),
    },
  ];
  const config = {
    model: CHAT,
    tools: [{ name: "lookup_order" }, { name: "refund_order" }],
    maxSteps: 4,
  };

  it("runs the ReAct loop over workflow tools and answers", async () => {
    const log: string[] = [];
    const provider = scripted([
      {
        toolCalls: [{ id: "c1", name: "lookup_order", args: { id: "ord_1" } }],
        finishReason: "tool_calls",
      },
      { text: "Your order shipped on Monday.", costUsd: 0.002 },
    ]);
    const { result, recorder } = await runNode(agentNode, {
      config,
      input: { task: "Where is order ord_1?" },
      providers: { generation: provider },
      tools: tools(log),
    });
    const out = okOf<{ answer: string; steps: number; tool_calls: unknown[] }>(result);
    expect(out.output).toMatchObject({
      answer: "Your order shipped on Monday.",
      steps: 2,
      tool_calls: [{ name: "lookup_order", args: { id: "ord_1" }, ok: true }],
    });
    expect(log).toEqual(['lookup {"id":"ord_1"}']);
    expect(recorder.toolCalls.map((c) => c.name)).toEqual(["lookup_order"]);
    expect(out.costUsd).toBeCloseTo(0.003);
    // The tool result went back to the model as a tool message.
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "shipped on Monday",
      toolCallId: "c1",
    });
    expect(provider.requests[0]?.tools?.map((t) => t.name)).toEqual([
      "lookup_order",
      "refund_order",
    ]);
  });

  it("suspends before a tool that needs approval and resumes with the decision", async () => {
    const log: string[] = [];
    const script = [
      {
        toolCalls: [{ id: "r1", name: "refund_order", args: { id: "ord_9" } }],
        finishReason: "tool_calls" as const,
      },
      { text: "Refunded order ord_9." },
    ];
    const first = await runNode(agentNode, {
      config,
      input: { task: "Refund ord_9" },
      providers: { generation: scripted(script) },
      tools: tools(log),
    });
    expect(first.result.kind).toBe("suspend");
    if (first.result.kind !== "suspend") return;
    expect(first.result.wait).toMatchObject({
      kind: "human",
      request: {
        title: "Approve refund_order",
        mode: { type: "approval" },
        context: { calls: [{ tool: "refund_order", needsApproval: true }] },
      },
    });
    expect(log).toEqual([]);
    const state = first.result.state;

    const approvedProvider = scripted([script[1] as { text: string }]);
    const approved = await runNode(agentNode, {
      config,
      input: { task: "Refund ord_9" },
      providers: { generation: approvedProvider },
      tools: tools(log),
      resume: {
        kind: "human",
        state,
        response: { action: "approve" },
        by: "user:1",
        humanTaskId: "t",
      },
    });
    expect(okOf<{ answer: string }>(approved.result).output.answer).toBe("Refunded order ord_9.");
    expect(log).toEqual(['refund {"id":"ord_9"}']);
    expect(approvedProvider.requests[0]?.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "refunded",
    });

    const rejectedProvider = scripted([{ text: "I could not refund it." }]);
    const rejected = await runNode(agentNode, {
      config,
      input: { task: "Refund ord_9" },
      providers: { generation: rejectedProvider },
      tools: tools(log),
      resume: {
        kind: "human",
        state,
        response: { action: "reject", comment: "policy" },
        by: "user:1",
        humanTaskId: "t",
      },
    });
    expect(okOf<{ tool_calls: { ok: boolean }[] }>(rejected.result).output.tool_calls).toEqual([
      { name: "refund_order", args: { id: "ord_9" }, ok: false },
    ]);
    expect(JSON.stringify(rejectedProvider.requests[0]?.messages.at(-1)?.content)).toContain(
      "not approved: policy",
    );
    expect(log).toHaveLength(1);
  });

  it("stops at maxSteps / maxToolCalls with BOUNDS_EXCEEDED", async () => {
    const looping = scripted([
      { toolCalls: [{ id: "c", name: "lookup_order", args: { id: "x" } }] },
    ]);
    const steps = await runNode(agentNode, {
      config: { ...config, maxSteps: 2, maxToolCalls: 50 },
      input: { task: "loop" },
      providers: { generation: looping },
      tools: tools([]),
    });
    expect(steps.result).toMatchObject({ kind: "error", error: { code: "BOUNDS_EXCEEDED" } });
    const calls = await runNode(agentNode, {
      config: { ...config, maxSteps: 10, maxToolCalls: 1 },
      input: { task: "loop" },
      providers: {
        generation: scripted([
          { toolCalls: [{ id: "c", name: "lookup_order", args: { id: "x" } }] },
        ]),
      },
      tools: tools([]),
    });
    expect(calls.result).toMatchObject({ kind: "error", error: { code: "BOUNDS_EXCEEDED" } });
  });

  it("refuses tools the workflow does not provide", async () => {
    const { result } = await runNode(agentNode, {
      config: { model: CHAT, tools: [{ name: "nope" }] },
      input: { task: "x" },
      providers: { generation: scripted([{ text: "x" }]) },
    });
    expect(result).toMatchObject({ kind: "error", error: { code: "NODE_EXECUTION_ERROR" } });
  });
});

describe("document loader", () => {
  it("loads inline Markdown, JSON, JSON Lines, CSV and HTML with provenance", async () => {
    const load = async (source: string, content: string, extra: Record<string, JsonValue> = {}) =>
      okOf<{ documents: { pageContent: string; metadata: Record<string, unknown> }[] }>(
        (
          await runNode(documentLoaderNode, {
            config: { source, ...extra },
            input: { content, metadata: { team: "docs" } },
          })
        ).result,
      ).output.documents;
    expect(await load("markdown", "# Title\nBody")).toEqual([
      {
        pageContent: "# Title\nBody",
        metadata: { source: "input", loader: "markdown", team: "docs" },
      },
    ]);
    expect(
      (
        await load("json", '{"items":[{"t":"a"},{"t":"b"}]}', {
          jsonPointer: "/items",
          textField: "t",
        })
      ).map((d) => d.pageContent),
    ).toEqual(["a", "b"]);
    expect(
      (await load("jsonl", '{"t":"x"}\n\n{"t":"y"}', { textField: "/t" })).map(
        (d) => d.metadata.line,
      ),
    ).toEqual([1, 3]);
    expect(
      (await load("csv", 'name,note\nAda,"likes, commas"\nBob,"say ""hi"""')).map(
        (d) => d.pageContent,
      ),
    ).toEqual(["name: Ada\nnote: likes, commas", 'name: Bob\nnote: say "hi"']);
    const html = await load(
      "html",
      "<html><head><title>T &amp; C</title><style>x{}</style></head><body><p>One</p><script>bad()</script><p>Two&nbsp;three</p></body></html>",
    );
    expect(html[0]).toMatchObject({ pageContent: "One\nTwo three", metadata: { title: "T & C" } });
  });

  it("fetches URLs, sitemaps and GitHub repositories through SafeFetch", async () => {
    const http = fakeHttp({
      "https://docs.example.com/sitemap.xml": () =>
        new Response(
          "<urlset><url><loc>https://docs.example.com/a</loc></url><url><loc>https://blog.example.com/b</loc></url></urlset>",
        ),
      "https://docs.example.com/a": () =>
        new Response("<h1>Alpha</h1><p>Page A</p>", { headers: { "content-type": "text/html" } }),
      "https://api.github.com/repos/acme/kb/git/trees/main": () =>
        json({
          tree: [
            { path: "docs/guide.md", type: "blob", size: 10 },
            { path: "src/x.ts", type: "blob", size: 5 },
          ],
        }),
      "https://api.github.com/repos/acme/kb/contents/docs/guide.md": () => new Response("# Guide"),
    });
    const sitemap = await runNode(documentLoaderNode, {
      config: { source: "sitemap", include: "https://docs.example.com/" },
      input: { urls: "https://docs.example.com/sitemap.xml" },
      http,
    });
    expect(okOf<{ documents: unknown[] }>(sitemap.result).output.documents).toEqual([
      {
        pageContent: "Alpha\nPage A",
        metadata: {
          source: "https://docs.example.com/a",
          loader: "url",
          sitemap: "https://docs.example.com/sitemap.xml",
        },
      },
    ]);
    const gh = await runNode(documentLoaderNode, {
      config: { source: "github", repo: "acme/kb", path: "docs" },
      input: {},
      http,
      credentials: { github: { token: "ghp_test" } },
    });
    expect(
      okOf<{ documents: { pageContent: string; metadata: { path: string } }[] }>(gh.result).output
        .documents,
    ).toEqual([
      expect.objectContaining({
        pageContent: "# Guide",
        metadata: expect.objectContaining({ path: "docs/guide.md" }),
      }),
    ]);
    expect(http.requests.find((r) => r.url.includes("git/trees"))?.headers.authorization).toBe(
      "Bearer ghp_test",
    );
  });

  it("helpers: htmlToText and parseCsv", () => {
    expect(htmlToText("<ul><li>a</li><li>b</li></ul>").text).toBe("- a\n- b");
    expect(parseCsv("a;b\r\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("text splitter", () => {
  it("splits documents into overlapping chunks with chunk provenance", async () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} talks about topic ${i % 4}.`,
    ).join(" ");
    const { result } = await runNode(textSplitterNode, {
      config: { chunkSize: 200, chunkOverlap: 40 },
      input: { documents: [{ pageContent: text, metadata: { source: "doc.md" } }] },
    });
    const chunks = okOf<{ chunks: { pageContent: string; metadata: Record<string, unknown> }[] }>(
      result,
    ).output.chunks;
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.pageContent.length <= 200)).toBe(true);
    expect(chunks[1]?.metadata).toMatchObject({ source: "doc.md", chunk: 1, chunkOf: 0 });
    const bad = await runNode(textSplitterNode, {
      config: { chunkSize: 100, chunkOverlap: 100 },
      input: { text: "x" },
    });
    expect(bad.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });

  it("splits Markdown and code on structure", async () => {
    const md = await runNode(textSplitterNode, {
      config: { splitter: "markdown", chunkSize: 60, chunkOverlap: 0 },
      input: { text: "# One\nFirst section text here.\n\n# Two\nSecond section text here." },
    });
    expect(
      okOf<{ chunks: { pageContent: string }[] }>(md.result).output.chunks[0]?.pageContent,
    ).toBe("# One\nFirst section text here.");
    const code = await runNode(textSplitterNode, {
      config: { splitter: "code", language: "python", chunkSize: 60, chunkOverlap: 0 },
      input: { text: "def a():\n    return 1\n\ndef b():\n    return 2\n\nclass C:\n    pass\n" },
    });
    expect(okOf<{ count: number }>(code.result).output.count).toBeGreaterThanOrEqual(2);
  });
});

describe("embed, vector store and retriever", () => {
  const docs: { pageContent: string; metadata: Record<string, JsonValue> }[] = [
    {
      pageContent: "Refunds are issued within 14 days of purchase to the original card.",
      metadata: { source: "refunds.md" },
    },
    {
      pageContent: "Shipping takes three to five business days within the country.",
      metadata: { source: "shipping.md" },
    },
    {
      pageContent: "Our office is closed on public holidays and weekends.",
      metadata: { source: "office.md" },
    },
    {
      pageContent: "Refunds for digital goods are not available after download.",
      metadata: { source: "refunds.md", digital: true },
    },
  ];

  it("embeds texts and documents in order", async () => {
    const embeddings = bowEmbeddings();
    const { result } = await runNode(embedNode, {
      config: { model: EMB, batchSize: 2 },
      input: { texts: ["a b c"], documents: docs.slice(0, 2) },
      providers: { embedding: embeddings },
    });
    const out = okOf<{ vectors: number[][]; dimensions: number }>(result).output;
    expect(out.vectors).toHaveLength(3);
    expect(out.dimensions).toBe(64);
    expect(embeddings.calls.map((c) => c.length)).toEqual([2, 1]);
  });

  function memoryState(): StateAccess {
    const data = new Map<string, JsonValue>();
    return {
      get: (ns, key) => Promise.resolve(data.get(`${ns}:${key}`) ?? null),
      set: (ns, key, value) => (data.set(`${ns}:${key}`, value), Promise.resolve()),
      cas: () => Promise.resolve(false),
    };
  }
  const lcEmbeddings = new FlowaidEmbeddings({
    provider: bowEmbeddings(),
    context: {
      signal: new AbortController().signal,
      runId: "r",
      nodeRunId: "n",
      idempotencyKey: null,
    },
  });

  it("the workspace store upserts idempotently and answers similarity, MMR, hybrid and multi-query", async () => {
    const store = new WorkspaceVectorStore(lcEmbeddings, "kb", memoryState());
    const lcDocs = docs.map((d) => new Document(d));
    const ids = await store.addDocuments(lcDocs);
    expect(await store.addDocuments(lcDocs)).toEqual(ids);
    expect(ids[0]).toBe(chunkId("kb", lcDocs[0] as Document));
    const similar = await store.similaritySearchWithScore("how do refunds work", 2);
    expect(similar.map(([d]) => d.metadata.source as string)).toEqual(["refunds.md", "refunds.md"]);
    const filtered = await store.similaritySearch("refunds", 4, { digital: true });
    expect(filtered).toHaveLength(1);

    const retrieve = (strategy: Strategy, model?: FlowaidChatModel) =>
      new FlowaidRetriever({
        store,
        strategy,
        k: 2,
        fetchK: 4,
        lambda: 0.2,
        queries: 2,
        ...(model ? { model } : {}),
      }).invoke("refunds digital goods");
    expect((await retrieve("similarity"))[0]?.metadata.source).toBe("refunds.md");
    const mmr = await retrieve("mmr");
    expect(new Set(mmr.map((d) => d.pageContent)).size).toBe(2);
    const hybrid = await retrieve("hybrid");
    expect(hybrid[0]?.pageContent).toContain("digital goods");
    expect(hybrid[0]?.metadata).toHaveProperty("bm25");
    const provider = scripted([{ text: "money back for downloads\nrefund rules" }]);
    const model = new FlowaidChatModel({
      provider,
      context: {
        signal: new AbortController().signal,
        runId: "r",
        nodeRunId: "n",
        idempotencyKey: null,
      },
    });
    const multi = await retrieve("multi_query", model);
    expect(multi[0]?.metadata).toHaveProperty("fusedScore");
    expect(provider.requests).toHaveLength(1);

    await store.delete({ filter: { digital: true } });
    expect(await store.similaritySearch("refunds", 4)).toHaveLength(3);
  });

  it("vector_store and retriever nodes run end to end against Qdrant over SafeFetch", async () => {
    const points = new Map<string, { vector: number[]; payload: Record<string, unknown> }>();
    let created = false;
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
    const http = fakeHttp({
      "https://qdrant.test/collections/kb/points/search": (req) => {
        const body = req.body as { vector: number[]; limit: number };
        const result = [...points.entries()]
          .map(([id, p]) => ({ id, score: dot(body.vector, p.vector), payload: p.payload }))
          .sort((a, b) => b.score - a.score)
          .slice(0, body.limit);
        return json({ result });
      },
      "https://qdrant.test/collections/kb/points?wait=true": (req) => {
        for (const p of (
          req.body as {
            points: { id: string; vector: number[]; payload: Record<string, unknown> }[];
          }
        ).points)
          points.set(p.id, { vector: p.vector, payload: p.payload });
        return json({ status: "ok" });
      },
      "https://qdrant.test/collections/kb": (req) => {
        if (req.method === "PUT") created = true;
        return created ? json({ result: {} }) : json({ status: { error: "not found" } }, 404);
      },
    });
    const common = {
      http,
      credentials: { store: { key: "qd-secret" } },
      providers: { embedding: bowEmbeddings() },
    };
    const store = {
      store: "qdrant",
      collection: "kb",
      url: "https://qdrant.test",
      embeddingModel: EMB,
    };
    const upsert = await runNode(vectorStoreNode, {
      ...common,
      config: { ...store, operation: "upsert" },
      input: { documents: docs },
    });
    expect(okOf<{ count: number }>(upsert.result).output.count).toBe(4);
    expect(created).toBe(true);
    expect(http.requests.every((r) => r.headers["api-key"] === "qd-secret")).toBe(true);

    const query = await runNode(vectorStoreNode, {
      ...common,
      config: { ...store, operation: "query", k: 1 },
      input: { query: "when is the office closed" },
    });
    expect(
      okOf<{ hits: { metadata: { source: string } }[] }>(query.result).output.hits[0]?.metadata
        .source,
    ).toBe("office.md");

    const { result } = await runNode(retrieverNode, {
      ...common,
      config: { ...store, strategy: "hybrid", k: 2 },
      input: { query: "shipping business days" },
    });
    const out = okOf<{ documents: unknown[]; context: string; count: number }>(result).output;
    expect(out.count).toBe(2);
    expect(out.context).toMatch(/^\[1\] \(shipping\.md\)\nShipping takes/);
  });

  it("the pinecone store speaks the data-plane API", async () => {
    const http = fakeHttp({
      "https://idx.pinecone.test/vectors/upsert": () => json({ upsertedCount: 1 }),
      "https://idx.pinecone.test/query": () =>
        json({
          matches: [{ id: "a", score: 0.9, metadata: { pageContent: "hello", source: "s.md" } }],
        }),
    });
    const store = new PineconeVectorStore(lcEmbeddings, "ns1", {
      http,
      url: "idx.pinecone.test",
      apiKey: "pc",
    });
    await store.addDocuments([
      new Document({
        pageContent: "hello",
        metadata: { source: "s.md", tags: ["a"], nested: { x: 1 } },
      }),
    ]);
    const upsert = http.requests[0]?.body as {
      namespace: string;
      vectors: { metadata: Record<string, unknown> }[];
    };
    expect(upsert.namespace).toBe("ns1");
    expect(upsert.vectors[0]?.metadata).toEqual({
      source: "s.md",
      tags: ["a"],
      nested: '{"x":1}',
      pageContent: "hello",
    });
    const [hit] = await store.similaritySearchWithScore("hello", 1, { source: "s.md" });
    expect(hit?.[0]).toMatchObject({ pageContent: "hello", metadata: { source: "s.md" } });
    expect((http.requests[1]?.body as { filter: unknown }).filter).toEqual({
      source: { $eq: "s.md" },
    });
    expect(http.requests[1]?.headers["api-key"]).toBe("pc");
  });
});

describe("helpers", () => {
  it("bm25 prefers documents that contain rare query terms", () => {
    const scores = bm25("refund digital", [
      "refund policy for cards",
      "digital goods refund rules",
      "shipping times",
    ]);
    expect(scores[1]).toBeGreaterThan(scores[0] ?? 0);
    expect(scores[2]).toBe(0);
  });
});

describe("output parser", () => {
  it("parses JSON against a schema and lists, numbers and booleans", async () => {
    const schema = {
      type: "object",
      required: ["score"],
      properties: { score: { type: "number" } },
    };
    const parse = (config: Record<string, JsonValue>, text: string) =>
      runNode(outputParserNode, { config, input: { text } });
    expect(
      okOf<{ output: unknown }>(
        (await parse({ schema }, 'Sure:\n```json\n{"score": 0.7}\n```')).result,
      ).output,
    ).toEqual({ output: { score: 0.7 }, repaired: false });
    expect((await parse({ schema }, '{"other": 1}')).result).toMatchObject({
      kind: "error",
      error: { code: "OUTPUT_SCHEMA_MISMATCH" },
    });
    expect(
      okOf<{ output: unknown }>((await parse({ parser: "comma_list" }, "a, b, c")).result).output
        .output,
    ).toEqual(["a", "b", "c"]);
    expect(
      okOf<{ output: unknown }>((await parse({ parser: "line_list" }, "1. one\n- two\n")).result)
        .output.output,
    ).toEqual(["one", "two"]);
    expect(
      okOf<{ output: unknown }>((await parse({ parser: "number" }, "About 1,234.5 units")).result)
        .output.output,
    ).toBe(1234.5);
    expect(
      okOf<{ output: unknown }>((await parse({ parser: "boolean" }, "Yes, it is")).result).output
        .output,
    ).toBe(true);
  });

  it("repairs unparseable text with a chat model", async () => {
    const provider = scripted([{ text: '{"score": 1}' }]);
    const { result } = await runNode(outputParserNode, {
      config: { repair: true, model: CHAT, schema: { type: "object", required: ["score"] } },
      input: { text: "score is one" },
      providers: { generation: provider },
    });
    expect(okOf<{ output: unknown; repaired: boolean }>(result).output).toEqual({
      output: { score: 1 },
      repaired: true,
    });
    expect(JSON.stringify(provider.requests[0]?.messages[0]?.content)).toContain(
      "could not be parsed",
    );
  });
});
