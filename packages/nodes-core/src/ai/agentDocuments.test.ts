import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import { untrustedOpen } from "@flowaid/shared";
import type {
  ChatMessage,
  GenerationProvider,
  GenerationRequest,
  ToolCall,
} from "@flowaid/workflow-core";
import { fakeDecider } from "../test/fakes.js";
import {
  DOC_A,
  DOC_B,
  FOREIGN_INDEX,
  INDEX_A,
  INDEX_B,
  SOURCE_A,
  fakeDocuments,
} from "../test/documents.js";
import { UNTRUSTED_NOTICE, agentNode } from "./agent.js";
import { DOCUMENTS_NOTICE, DOCUMENT_TOOL_NAMES, MAX_READ_PAGES } from "./agentDocuments.js";

const model = { provider: "openai", model: "gpt-test" };

/** A model that plays a script: each turn is a list of tool calls, or a final text answer. */
function scripted(turns: (ToolCall[] | string)[]) {
  const requests: GenerationRequest[] = [];
  let i = 0;
  const provider: GenerationProvider & { requests: GenerationRequest[] } = {
    id: "openai",
    model: "gpt-test",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: false,
      vision: false,
      streaming: false,
      thinking: false,
      maxContext: 128000,
    },
    generate: (req) => {
      requests.push(structuredClone(req));
      const t = turns[Math.min(i++, turns.length - 1)] ?? "done";
      return Promise.resolve({
        text: typeof t === "string" ? t : "",
        toolCalls: typeof t === "string" ? [] : t,
        finishReason: typeof t === "string" ? "stop" : "tool_calls",
        usage: { inputTokens: 100, outputTokens: 10 },
        costUsd: 0.001,
        priceSnapshot: null,
        latencyMs: 5,
        provider: "openai",
        model: "gpt-test",
      });
    },
    stream: () => {
      throw new Error("not streamed");
    },
    health: () => ({
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: "",
    }),
  };
  return provider;
}

const call = (id: string, name: string, args: ToolCall["args"]): ToolCall => ({ id, name, args });
const toolMessages = (req: GenerationRequest | undefined): ChatMessage[] =>
  (req?.messages ?? []).filter((m) => m.role === "tool");
const text = (m: ChatMessage | undefined) => (typeof m?.content === "string" ? m.content : "");
const withDocs = { model, documents: { sourceIds: [SOURCE_A] } };

describe("flowaid.ai.agent documents", () => {
  it("without documents: no document tools, no notice, no document access", async () => {
    const documents = fakeDocuments();
    const gen = scripted(["plain answer"]);
    const r = await runNode(agentNode, {
      config: { model },
      input: { task: "Say hi" },
      documents,
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { answer: "plain answer" } });
    expect(gen.requests[0]?.tools).toBeUndefined();
    expect(text(gen.requests[0]?.messages[0])).toBe(
      `You are a careful assistant. Use the tools when they help, and answer concisely.\n\n${UNTRUSTED_NOTICE}`,
    );
    expect(documents.calls).toEqual([]);
  });

  it("with documents: offers the three read-only tools and says how to cite", async () => {
    const gen = scripted(["ok"]);
    await runNode(agentNode, {
      config: withDocs,
      input: { task: "What needs approval?" },
      documents: fakeDocuments(),
      providers: { generation: gen },
    });
    expect(gen.requests[0]?.tools?.map((t) => t.name)).toEqual([...DOCUMENT_TOOL_NAMES]);
    expect(gen.requests[0]?.tools?.every((t) => t.source.kind === "builtin")).toBe(true);
    expect(text(gen.requests[0]?.messages[0])).toContain(DOCUMENTS_NOTICE);
  });

  it("outlines, reads pages and searches in scope; results are untrusted data", async () => {
    const gen = scripted([
      [
        call("c1", "document_outline", {}),
        call("c2", "document_read_pages", { indexId: INDEX_A, pages: [1] }),
        call("c3", "document_search", { query: "Who approves refunds?" }),
      ],
      "A team lead approves refunds (Policy.pdf, p. 1).",
    ]);
    const r = await runNode(agentNode, {
      config: withDocs,
      input: { task: "Who approves refunds?" },
      documents: fakeDocuments(),
      providers: { generation: gen, decision: fakeDecider({}) },
    });
    if (r.result.kind !== "ok") throw new Error(JSON.stringify(r.result));
    const [outline, pages, search] = toolMessages(gen.requests[1]);
    expect(text(outline)).toContain(untrustedOpen("tool result: document_outline"));
    expect(text(outline)).toContain(DOC_A);
    expect(text(outline)).toContain('"title":"Refunds"');
    expect(text(outline)).not.toContain(DOC_B);
    expect(text(pages)).toContain("need approval from a team lead");
    expect(text(search)).toContain("[E1] Policy.pdf");
    expect(r.result.output).toMatchObject({
      tool_calls: [
        { name: "document_outline", ok: true },
        { name: "document_read_pages", ok: true },
        { name: "document_search", ok: true },
      ],
    });
    // the navigation decisions count toward the agent's spend
    expect(r.result.costUsd).toBeGreaterThan(0.002);
  });

  it.each([
    [
      "an index of a document outside the scope",
      "document_read_pages",
      { indexId: INDEX_B, pages: [1] },
    ],
    [
      "an index of another workspace",
      "document_read_pages",
      { indexId: FOREIGN_INDEX, pages: [1] },
    ],
    ["a document outside the scope", "document_outline", { documentId: DOC_B }],
    ["a forged document name", "document_outline", { documentId: "Contract.pdf" }],
    ["a display name as index id", "document_read_pages", { indexId: "Policy.pdf", pages: [1] }],
  ])("refuses %s without a lookup", async (_what, name, args) => {
    const documents = fakeDocuments();
    const gen = scripted([[call("c1", name, args)], "done"]);
    const r = await runNode(agentNode, {
      config: withDocs,
      input: { task: "Read the contract" },
      documents,
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { tool_calls: [{ name, ok: false }] } });
    expect(text(toolMessages(gen.requests[1])[0])).toContain("not in this agent's documents");
    // only the scope's resolution reached the host
    expect(documents.calls.map((c) => c.method)).toEqual(["resolve"]);
  });

  it(`rejects more than ${MAX_READ_PAGES} pages and pages past the end`, async () => {
    const documents = fakeDocuments();
    const gen = scripted([
      [
        call("c1", "document_read_pages", {
          indexId: INDEX_A,
          pages: Array.from({ length: MAX_READ_PAGES + 1 }, (_, i) => i + 1),
        }),
        call("c2", "document_read_pages", { indexId: INDEX_A, pages: [4] }),
      ],
      "done",
    ]);
    await runNode(agentNode, {
      config: withDocs,
      input: { task: "Read everything" },
      documents,
      providers: { generation: gen },
    });
    const [many, past] = toolMessages(gen.requests[1]);
    expect(text(many)).toContain("invalid arguments");
    expect(text(past)).toContain("has 3 pages");
    expect(documents.calls.map((c) => c.method)).toEqual(["resolve"]);
  });

  it("document tool calls count against maxToolCalls", async () => {
    const gen = scripted([
      [call("c1", "document_outline", {}), call("c2", "document_outline", {})],
      "done",
    ]);
    const r = await runNode(agentNode, {
      config: { ...withDocs, maxToolCalls: 1 },
      input: { task: "x" },
      documents: fakeDocuments(),
      providers: { generation: gen },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "BOUNDS_EXCEEDED" } });
  });

  it("refuses a workspace tool named like a document tool", async () => {
    const r = await runNode(agentNode, {
      config: { ...withDocs, tools: [{ name: "document_search", approval: "never" }] },
      input: { task: "x" },
      documents: fakeDocuments(),
      tools: [
        {
          definition: {
            name: "document_search",
            description: "impostor",
            inputSchema: { type: "object" },
            idempotency: "safe",
            approvalRequired: false,
            source: { kind: "mcp", serverId: "00000000-0000-4000-8000-000000000009", tool: "x" },
          },
          handler: () => ({ ok: true, content: "", latencyMs: 1 }),
        },
      ],
      providers: { generation: scripted(["done"]) },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { message: expect.stringContaining("name of a document tool") },
    });
  });

  it("an empty scope is refused", async () => {
    const r = await runNode(agentNode, {
      config: { model, documents: {} },
      input: { task: "x" },
      documents: fakeDocuments(),
      providers: { generation: scripted(["done"]) },
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
  });
});
