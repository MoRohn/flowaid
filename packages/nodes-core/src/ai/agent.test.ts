import { describe, expect, it } from "vitest";
import { runNode, type TestTool } from "@flowaid/node-sdk/testing";
import type {
  GenerationChunk,
  GenerationProvider,
  GenerationRequest,
  JsonValue,
  ToolCall,
  ToolDefinition,
} from "@flowaid/workflow-core";
import { AGENT_PRESET_BUILTIN, agentNode, effectiveAgent, needsApproval } from "./agent.js";

const model = { provider: "openai", model: "gpt-test" };

/** A model that plays a script: each turn is a list of tool calls, or a final text answer. */
function scripted(turns: (ToolCall[] | string)[]) {
  const requests: GenerationRequest[] = [];
  let i = 0;
  const next = () => {
    const t = turns[Math.min(i, turns.length - 1)];
    i += 1;
    return t ?? "done";
  };
  const provider: GenerationProvider & { requests: GenerationRequest[] } = {
    id: "openai",
    model: "gpt-test",
    requests,
    capabilities: {
      tools: true,
      jsonSchema: false,
      vision: false,
      streaming: true,
      thinking: false,
      maxContext: 128000,
    },
    generate: (req) => {
      requests.push(structuredClone(req));
      const t = next();
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
    async *stream(req): AsyncIterable<GenerationChunk> {
      requests.push(structuredClone(req));
      await Promise.resolve();
      const t = next();
      if (typeof t === "string") yield { type: "text", delta: t };
      else
        for (const [index, c] of t.entries())
          yield {
            type: "tool_call",
            index,
            id: c.id,
            name: c.name,
            argsDelta: JSON.stringify(c.args),
          };
      yield { type: "usage", usage: { inputTokens: 100, outputTokens: 10 } };
      yield { type: "done", finishReason: typeof t === "string" ? "stop" : "tool_calls" };
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

function tool(
  name: string,
  handler: (args: JsonValue) => string | Error,
  over: Partial<ToolDefinition> = {},
): TestTool {
  return {
    definition: {
      name,
      description: name,
      inputSchema: { type: "object" },
      idempotency: "safe",
      approvalRequired: false,
      source: { kind: "mcp", serverId: "00000000-0000-4000-8000-000000000009", tool: name },
      ...over,
    },
    handler: (args) => {
      const out = handler(args);
      if (out instanceof Error)
        return {
          ok: false,
          content: out.message,
          error: { code: "NODE_EXECUTION_ERROR", message: out.message, retryable: false },
          latencyMs: 1,
        };
      return { ok: true, content: out, latencyMs: 1 };
    },
  };
}

const lookup = tool("lookup_order", (a) => `order ${(a as { id: string }).id}: shipped`);
const refund = tool("refund", () => "refunded", { idempotency: "none" });
const call = (id: string, name: string, args: JsonValue = {}): ToolCall => ({ id, name, args });

describe("flowaid.ai.agent", () => {
  it("loops over tools until the model answers (golden trace)", async () => {
    const gen = scripted([[call("c1", "lookup_order", { id: "1182" })], "Order 1182 has shipped."]);
    const r = await runNode(agentNode, {
      config: { model, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "Where is order 1182?" },
      providers: { generation: gen },
      tools: [lookup],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        answer: "Order 1182 has shipped.",
        steps: 2,
        tool_calls: [{ name: "lookup_order", args: { id: "1182" }, ok: true }],
        usage: { inputTokens: 200, outputTokens: 20 },
      },
      costUsd: 0.002,
    });
    // the second turn sees the assistant's call and the tool's result, in order
    expect(gen.requests[1]?.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ]);
    expect(gen.requests[1]?.messages[3]).toEqual({
      role: "tool",
      toolCallId: "c1",
      content: "order 1182: shipped",
    });
    expect(gen.requests[0]?.tools?.map((t) => t.name)).toEqual(["lookup_order"]);
  });

  it("stops at maxSteps and maxToolCalls with BOUNDS_EXCEEDED", async () => {
    const forever = () => scripted([[call("c", "lookup_order", { id: "1" })]]);
    const steps = await runNode(agentNode, {
      config: { model, maxSteps: 3, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "loop" },
      providers: { generation: forever() },
      tools: [lookup],
    });
    expect(steps.result.kind === "error" && steps.result.error.code).toBe("BOUNDS_EXCEEDED");
    const calls = await runNode(agentNode, {
      config: { model, maxToolCalls: 2, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "loop" },
      providers: { generation: forever() },
      tools: [lookup],
    });
    expect(calls.result.kind === "error" && calls.result.error.code).toBe("BOUNDS_EXCEEDED");
    expect(calls.recorder.toolCalls).toHaveLength(2);
  });

  it("stops when tokens or cost run over", async () => {
    const r = await runNode(agentNode, {
      config: { model, maxCostUsd: 0.0015, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "x" },
      providers: { generation: scripted([[call("c", "lookup_order", { id: "1" })], "ok"]) },
      tools: [lookup],
    });
    expect(r.result.kind === "error" && r.result.error.code).toBe("BOUNDS_EXCEEDED");
  });

  it("reports tool errors to the model instead of failing", async () => {
    const broken = tool("lookup_order", () => new Error("upstream 503"));
    const gen = scripted([[call("c1", "lookup_order", { id: "1" })], "Sorry, the lookup failed."]);
    const r = await runNode(agentNode, {
      config: { model, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "x" },
      providers: { generation: gen },
      tools: [broken],
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { tool_calls: [{ ok: false }] } });
    expect(gen.requests[1]?.messages[3]?.content).toContain("upstream 503");
  });

  it("suspends irreversible calls for approval and resumes with the saved state", async () => {
    const config = { model, tools: [{ name: "refund", approval: "irreversible" as const }] };
    const first = await runNode(agentNode, {
      config,
      input: { task: "Refund order 7" },
      providers: { generation: scripted([[call("c1", "refund", { order: 7 })]]) },
      tools: [refund],
    });
    expect(first.result.kind).toBe("suspend");
    if (first.result.kind !== "suspend") return;
    expect(first.result.wait).toMatchObject({
      kind: "human",
      request: { title: "Approve refund", mode: { type: "approval" } },
    });
    expect(first.recorder.toolCalls).toHaveLength(0);

    const approved = await runNode(agentNode, {
      config,
      input: { task: "Refund order 7" },
      providers: { generation: scripted(["Refunded order 7."]) },
      tools: [refund],
      resume: {
        kind: "human",
        state: first.result.state,
        response: { action: "approve" },
        by: "user:1",
        humanTaskId: "t1",
      },
    });
    expect(approved.result).toMatchObject({
      kind: "ok",
      output: { answer: "Refunded order 7.", steps: 2, tool_calls: [{ name: "refund", ok: true }] },
    });
    expect(approved.recorder.toolCalls).toHaveLength(1);

    const gen = scripted(["I did not refund it."]);
    const rejected = await runNode(agentNode, {
      config,
      input: { task: "Refund order 7" },
      providers: { generation: gen },
      tools: [refund],
      resume: {
        kind: "human",
        state: first.result.state,
        response: { action: "reject", comment: "not eligible" },
        by: "user:1",
        humanTaskId: "t1",
      },
    });
    expect(rejected.result).toMatchObject({ kind: "ok", output: { tool_calls: [{ ok: false }] } });
    expect(rejected.recorder.toolCalls).toHaveLength(0);
    expect(gen.requests[0]?.messages.at(-1)?.content).toContain("not eligible");
  });

  it("streams text and assembles streamed tool calls", async () => {
    const r = await runNode(agentNode, {
      config: { model, stream: true, tools: [{ name: "lookup_order", approval: "never" }] },
      input: { task: "x" },
      providers: { generation: scripted([[call("c1", "lookup_order", { id: "9" })], "Shipped."]) },
      tools: [lookup],
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { answer: "Shipped." } });
    expect(r.recorder.toolCalls[0]?.args).toEqual({ id: "9" });
    expect(r.recorder.deltas.map((d) => d.channel)).toEqual(["tool_args", "text"]);
  });

  it("loads a preset through the agent_preset builtin; node settings win", async () => {
    const presetTool: TestTool = {
      definition: {
        name: AGENT_PRESET_BUILTIN,
        description: "",
        inputSchema: { type: "object" },
        idempotency: "safe",
        approvalRequired: false,
        source: { kind: "builtin", id: AGENT_PRESET_BUILTIN },
      },
      handler: () => ({
        ok: true,
        content: "",
        structured: { model, system: "You are the support agent.", maxSteps: 2 },
        latencyMs: 0,
      }),
    };
    const gen = scripted(["hello"]);
    const r = await runNode(agentNode, {
      config: { agentId: "00000000-0000-4000-8000-00000000000a", maxSteps: 5 },
      input: { task: "hi" },
      providers: { generation: gen },
      tools: [presetTool],
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { answer: "hello" } });
    expect(gen.requests[0]?.messages[0]?.content).toBe("You are the support agent.");
  });

  it("merges settings and decides approval by mode", () => {
    expect(() => effectiveAgent({}, null)).toThrow(/no model/);
    expect(effectiveAgent({ maxSteps: 3 }, { model, maxSteps: 9, system: "p" })).toMatchObject({
      maxSteps: 3,
      system: "p",
      stream: false,
    });
    const def = lookup.definition;
    expect(needsApproval(def, "irreversible")).toBe(false);
    expect(needsApproval(refund.definition, "irreversible")).toBe(true);
    expect(needsApproval({ ...def, approvalRequired: true }, "irreversible")).toBe(true);
    expect(needsApproval(def, "always")).toBe(true);
    expect(needsApproval(refund.definition, "never")).toBe(false);
  });

  it("accepts a failover policy as its model", async () => {
    const r = await runNode(agentNode, {
      config: {
        model: {
          candidates: [model, { provider: "anthropic", model: "claude-test" }],
          strategy: "ordered",
        },
      },
      input: { task: "hi" },
      providers: { generation: scripted(["ok"]) },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { answer: "ok" } });
  });
});
