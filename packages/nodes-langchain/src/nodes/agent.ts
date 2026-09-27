/**
 * `langchain.agent`: a LangGraph ReAct agent (`createReactAgent`) over the workflow's tools
 * (`toLangChainTool` → `ctx.tools.call`, so every call is a TOOL_CALLED/TOOL_RETURNED event with
 * capability checks) and the node's chat model (`ctx.providers`, so every step is a
 * GENERATION_COMPLETED event with cost).
 *
 * Bounds: `maxSteps` (model turns), `maxToolCalls`, `maxTokens`, `maxCostUsd` (callback handler)
 * and the node timeout (signal). Approval: the graph always pauses before its tool node; when a
 * pending call targets a tool that needs approval (config `approval: always`, or the tool's own
 * `approvalRequired`), the node suspends with a human approval task. The suspend `state` is the
 * conversation so far (as flowaid chat messages) plus the pending calls, so the run survives
 * restarts; on resume the approved calls execute (or a rejection is reported to the model) and
 * the agent continues.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import {
  fromLangChainMessages,
  textOf,
  toLangChainMessages,
  toLangChainTool,
  toolCallsOf,
} from "@flowaid/langchain";
import { defineNode, ok, suspend } from "@flowaid/node-sdk";
import {
  BoundsExceededError,
  NodeExecutionError,
  type ChatMessage,
  type JsonObject,
  type JsonValue,
  type TokenUsage,
  type ToolCall,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import {
  LLM_SLOT,
  Spend,
  chatModelFor,
  combined,
  handlerFor,
  modelRef,
  nodeId,
  rethrow,
  usageSchema,
} from "../common.js";

const toolConfig = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  approval: z.enum(["never", "always", "tool_default"]).default("tool_default"),
});

interface AgentState {
  v: 1;
  messages: ChatMessage[];
  pending: ToolCall[];
  steps: number;
  toolCalls: number;
  usage: TokenUsage;
  costUsd: number;
  log: { name: string; args: JsonValue; ok: boolean }[];
}

const isAgentState = (v: unknown): v is AgentState =>
  typeof v === "object" && v !== null && (v as { v?: unknown }).v === 1;

export const agentNode = defineNode({
  id: nodeId("agent"),
  version: "1.0.0",
  metadata: {
    name: "LangChain agent",
    description:
      "A LangGraph ReAct agent over the workflow's tools, bounded by steps, tool calls, tokens, cost and time; tool calls that need approval pause the run for a person.",
    category: "agent",
    icon: "bot",
    tags: ["langchain", "langgraph", "agent", "react", "tools"],
    summary: "{{ config.model.model }} · {{ config.maxSteps }} steps",
  },
  configSchema: z.strictObject({
    model: modelRef,
    system: z
      .string()
      .max(32_000)
      .default("You are a careful assistant. Use the tools when they help; answer concisely.")
      .meta({ "x-ui": { widget: "textarea" } }),
    tools: z
      .array(toolConfig)
      .max(32)
      .default([])
      .meta({
        "x-ui": {
          widget: "list",
          help: "Workflow tools the agent may call, with their approval policy.",
        },
      }),
    temperature: z.number().min(0).max(2).default(0.2),
    maxOutputTokens: z.int().min(1).max(65_536).default(2048),
    maxSteps: z.int().min(1).max(50).default(8),
    maxToolCalls: z.int().min(0).max(200).default(16),
    maxTokens: z.int().min(1).optional(),
    maxCostUsd: z.number().min(0).optional(),
  }),
  inputSchema: z.object({
    task: z.string().min(1),
    context: z.unknown().optional(),
  }),
  outputSchema: z.object({
    answer: z.string(),
    steps: z.int().min(0),
    tool_calls: z.array(z.object({ name: z.string(), args: z.unknown(), ok: z.boolean() })),
    usage: usageSchema,
  }),
  credentials: [LLM_SLOT],
  capabilities: ["generation", "credentials", "tools", "suspend"],
  idempotency: "none",
  generation: true,
  defaultPolicy: { timeoutMs: 600_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const resumed = ctx.resume && isAgentState(ctx.resume.state) ? ctx.resume.state : undefined;
    const spend = new Spend();
    if (resumed) spend.add(resumed.usage, resumed.costUsd);
    const handler = handlerFor(ctx, {
      ...(c.maxTokens !== undefined ? { maxTokens: c.maxTokens } : {}),
      ...(c.maxCostUsd !== undefined ? { maxCostUsd: c.maxCostUsd } : {}),
    });
    if (resumed) handler.account(resumed.usage, resumed.costUsd);
    const signal = combined(ctx, handler);
    const log: AgentState["log"] = [...(resumed?.log ?? [])];

    const available = c.tools.length ? await ctx.tools.list() : [];
    const defs = c.tools.map((t) => {
      const def = available.find((d) => d.name === t.name);
      if (!def)
        throw new NodeExecutionError(
          `The agent's tool '${t.name}' is not available in this workflow`,
          false,
        );
      return { def, approval: t.approval };
    });
    const needsApproval = (name: string) => {
      const entry = defs.find((d) => d.def.name === name);
      if (!entry) return false;
      return (
        entry.approval === "always" ||
        (entry.approval === "tool_default" && entry.def.approvalRequired)
      );
    };
    const tools: DynamicStructuredTool[] = defs.map(({ def }: { def: ToolDefinition }) =>
      toLangChainTool(def, async (args) => {
        const result = await ctx.tools.call(def.source, def.name, args);
        log.push({ name: def.name, args, ok: result.ok });
        return result;
      }),
    );

    const llm = chatModelFor(ctx, c.model, {
      spend,
      handler,
      signal,
      settings: { temperature: c.temperature, maxOutputTokens: c.maxOutputTokens },
    });
    const agent = createReactAgent({
      llm,
      tools,
      prompt: c.system,
      checkpointer: new MemorySaver(),
      interruptBefore: ["tools"],
    });
    const config = {
      configurable: { thread_id: randomUUID() },
      callbacks: [handler],
      signal,
      recursionLimit: 2 * c.maxSteps + 4,
    };

    let messages: BaseMessage[];
    let toolCalls = resumed?.toolCalls ?? 0;
    const priorSteps = resumed?.steps ?? 0;
    if (resumed && ctx.resume) {
      messages = toLangChainMessages(resumed.messages);
      const approved = ctx.resume.kind === "human" && ctx.resume.response.action === "approve";
      const comment =
        ctx.resume.kind === "human" && "comment" in ctx.resume.response
          ? ctx.resume.response.comment
          : undefined;
      for (const call of resumed.pending) {
        const tool = tools.find((t) => t.name === call.name);
        if (approved && tool) {
          const msg = (await tool.invoke(
            { type: "tool_call", id: call.id, name: call.name, args: call.args as JsonObject },
            { signal, callbacks: [handler] },
          )) as ToolMessage;
          messages.push(msg);
        } else {
          log.push({ name: call.name, args: call.args, ok: false });
          messages.push(
            new ToolMessage({
              tool_call_id: call.id,
              content: `The call was not approved${ctx.resume.kind === "timeout" ? " (the approval timed out)" : ""}${comment ? `: ${comment}` : ""}. Do not retry it; continue without it.`,
            }),
          );
        }
      }
    } else {
      const context =
        input.context === undefined
          ? ""
          : `\n\nContext:\n${typeof input.context === "string" ? input.context : JSON.stringify(input.context, null, 2)}`;
      messages = [new HumanMessage(`${input.task}${context}`)];
    }
    const baseline = messages.filter((m) => m.getType() === "ai").length;

    let state: { values: { messages: BaseMessage[] }; next: string[] };
    try {
      await agent.invoke({ messages }, config);
      for (;;) {
        state = await agent.getState(config);
        const all = state.values.messages;
        const steps = priorSteps + all.filter((m) => m.getType() === "ai").length - baseline;
        if (steps > c.maxSteps) throw new BoundsExceededError("maxIterations", c.maxSteps, steps);
        if (!state.next.includes("tools")) break;
        const last = all[all.length - 1];
        const calls = last ? toolCallsOf(last) : [];
        toolCalls += calls.length;
        if (toolCalls > c.maxToolCalls)
          throw new BoundsExceededError("maxIterations", c.maxToolCalls, toolCalls);
        const gated = calls.filter((call) => needsApproval(call.name));
        if (gated.length > 0) {
          const saved: AgentState = {
            v: 1,
            messages: fromLangChainMessages(all),
            pending: calls,
            steps,
            toolCalls,
            usage: spend.usage,
            costUsd: spend.costUsd,
            log,
          };
          return suspend(
            {
              kind: "human",
              request: {
                title: `Approve ${gated.map((g) => g.name).join(", ")}`.slice(0, 200),
                context: {
                  task: input.task,
                  calls: calls.map((call) => ({
                    tool: call.name,
                    args: call.args,
                    needsApproval: needsApproval(call.name),
                  })),
                },
                mode: { type: "approval" },
                assignees: [],
                expiresAt: null,
                externalReview: false,
              },
            },
            saved as unknown as JsonValue,
          );
        }
        await agent.invoke(null, config);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "GraphRecursionError")
        throw new BoundsExceededError("maxIterations", c.maxSteps, c.maxSteps + 1);
      rethrow(handler, error);
    }
    const all = state.values.messages;
    const lastAi = [...all].reverse().find((m) => m.getType() === "ai");
    return ok(
      {
        answer: lastAi ? textOf(lastAi) : "",
        steps: priorSteps + all.filter((m) => m.getType() === "ai").length - baseline,
        tool_calls: log,
        usage: spend.usage,
      },
      spend.extra,
    );
  },
});
