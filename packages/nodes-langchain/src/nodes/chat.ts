/**
 * `langchain.chat`: a chat model driven by a LangChain `ChatPromptTemplate` (`{variable}`
 * placeholders filled from the `variables` input, an optional `history` placeholder). The model is
 * any generation provider — native (`openai`, `anthropic`, `ollama`) or `langchain:<vendor>` —
 * resolved through `ctx.providers`, so credentials, tracing, pricing and failover are the
 * platform's. Streams text; returns structured output when `outputSchema` is set and the tool
 * calls the model requests when `tools` are offered (it does not execute them; see `agent`).
 */
import { z } from "zod";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { fromLangChainMessages, toLangChainMessages } from "@flowaid/langchain";
import { defineNode, ok } from "@flowaid/node-sdk";
import type {
  GenerationRequest,
  GenerationResult,
  JsonValue,
  ToolCall,
  TokenUsage,
} from "@flowaid/workflow-core";
import { LLM_SLOT, callCtx, modelRef, nodeId, usageSchema } from "../common.js";

const promptMessage = z.object({
  role: z.enum(["system", "human", "ai"]),
  content: z.string().min(1).max(32_000),
});

const historyItem = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
});

export const chatNode = defineNode({
  id: nodeId("chat"),
  version: "1.0.0",
  metadata: {
    name: "LangChain chat",
    description:
      "Runs a chat model with a LangChain prompt template ({variable} placeholders from `variables`, optional chat history). Streams text, returns structured output with an output schema, and returns tool calls when tools are offered.",
    category: "generation",
    icon: "messages-square",
    tags: ["langchain", "llm", "prompt", "chat"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    messages: z
      .array(promptMessage)
      .min(1)
      .max(50)
      .default([{ role: "human", content: "{input}" }])
      .meta({
        "x-ui": {
          widget: "list",
          help: "Prompt template messages; {name} placeholders are filled from the `variables` input ({{ and }} escape braces).",
        },
      }),
    includeHistory: z
      .boolean()
      .default(false)
      .meta({
        "x-ui": { widget: "switch", help: "Insert the `history` input before the last message." },
      }),
    temperature: z.number().min(0).max(2).default(0.7),
    maxOutputTokens: z.int().min(1).max(65_536).default(1024),
    stream: z.boolean().default(true),
    outputSchema: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": {
          widget: "schema",
          help: "JSON Schema for structured output (types `structured`).",
        },
      }),
    tools: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(64)
      .default([])
      .meta({
        "x-ui": {
          widget: "list",
          help: "Workflow tools the model may request (returned as tool_calls).",
        },
      }),
  }),
  inputSchema: z.object({
    variables: z.record(z.string(), z.unknown()).default({}),
    history: z.array(historyItem).optional(),
  }),
  outputSchema: z.object({
    text: z.string(),
    structured: z.unknown(),
    tool_calls: z.array(z.object({ id: z.string(), name: z.string(), args: z.unknown() })),
    finish_reason: z.string(),
    usage: usageSchema.loose(),
  }),
  portRules: [{ kind: "outputSchemaFromConfig", port: "structured", path: "/outputSchema" }],
  credentials: [LLM_SLOT],
  capabilities: ["generation", "credentials", "streaming", "tools"],
  idempotency: "safe",
  generation: true,
  streams: true,
  defaultPolicy: { timeoutMs: 120_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const template = ChatPromptTemplate.fromMessages([
      ...c.messages.slice(0, -1).map((m) => [m.role, m.content] as [string, string]),
      ...(c.includeHistory ? [new MessagesPlaceholder("history")] : []),
      ...c.messages.slice(-1).map((m) => [m.role, m.content] as [string, string]),
    ]);
    const variables: Record<string, unknown> = Object.fromEntries(
      Object.entries(input.variables).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    );
    if (c.includeHistory) variables.history = toLangChainMessages(input.history ?? []);
    const messages = fromLangChainMessages(await template.formatMessages(variables));

    const offered = c.tools.length
      ? (await ctx.tools.list()).filter((t) => c.tools.includes(t.name))
      : [];
    const req: GenerationRequest = {
      messages,
      temperature: c.temperature,
      maxOutputTokens: c.maxOutputTokens,
      ...(offered.length ? { tools: offered, toolChoice: "auto" as const } : {}),
      ...(c.outputSchema
        ? {
            responseFormat: {
              type: "json_schema" as const,
              schema: c.outputSchema,
              strict: false,
            },
          }
        : {}),
    };
    const provider = ctx.providers.generation(c.model, { credentialSlot: "llm" });

    let result: Pick<
      GenerationResult,
      "text" | "structured" | "toolCalls" | "finishReason" | "usage"
    >;
    let costUsd: number | undefined;
    if (c.stream && provider.capabilities.streaming && !c.outputSchema) {
      let text = "";
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let finish: GenerationResult["finishReason"] = "stop";
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of provider.stream(req, callCtx(ctx))) {
        if (chunk.type === "text") {
          text += chunk.delta;
          ctx.events.stream("text", chunk.delta);
        } else if (chunk.type === "thinking") ctx.events.stream("thinking", chunk.delta);
        else if (chunk.type === "tool_call") {
          const call = calls.get(chunk.index) ?? { id: "", name: "", args: "" };
          if (chunk.id) call.id = chunk.id;
          if (chunk.name) call.name = chunk.name;
          call.args += chunk.argsDelta;
          calls.set(chunk.index, call);
          ctx.events.stream("tool_args", chunk.argsDelta);
        } else if (chunk.type === "usage") usage = chunk.usage;
        else finish = chunk.finishReason;
      }
      const toolCalls: ToolCall[] = [...calls.values()].map((call, i) => {
        let args: JsonValue = {};
        try {
          args = call.args ? (JSON.parse(call.args) as JsonValue) : {};
        } catch {
          args = { _raw: call.args };
        }
        return { id: call.id || `call_${i}`, name: call.name, args };
      });
      result = { text, toolCalls, finishReason: finish, usage };
    } else {
      const r = await provider.generate(req, callCtx(ctx));
      result = r;
      costUsd = r.costUsd;
    }
    return ok(
      {
        text: result.text,
        structured: result.structured ?? null,
        tool_calls: result.toolCalls,
        finish_reason: result.finishReason,
        usage: result.usage,
      },
      { usage: result.usage, ...(costUsd !== undefined ? { costUsd } : {}) },
    );
  },
});
