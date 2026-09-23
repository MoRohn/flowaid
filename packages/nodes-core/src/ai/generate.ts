import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { ChatMessage, GenerationResult, TokenUsage } from "@flowaid/workflow-core";
import { callCtx, modelRef } from "../common.js";

const usage = z.object({ inputTokens: z.int().min(0), outputTokens: z.int().min(0) });

export function messagesFor(system: string | undefined, prompt: string): ChatMessage[] {
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: prompt },
  ];
}

export const generateNode = defineNode({
  id: "flowaid.ai.generate",
  version: "1.0.0",
  metadata: {
    name: "Generate text",
    description:
      "Generates text from a prompt with a chat model; streams deltas when `stream` is on.",
    category: "generation",
    icon: "sparkles",
    tags: ["llm", "generation"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    system: z
      .string()
      .max(32000)
      .optional()
      .meta({ "x-ui": { widget: "template" } }),
    temperature: z.number().min(0).max(2).default(1),
    maxOutputTokens: z.int().min(1).max(65536).default(1024),
    stream: z.boolean().default(true),
  }),
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ text: z.string(), finish_reason: z.string(), usage: usage.loose() }),
  credentials: [
    { name: "llm", types: ["openai.api_key", "anthropic.api_key", "ollama.none"], required: true },
  ],
  capabilities: ["generation", "credentials", "streaming"],
  idempotency: "safe",
  generation: true,
  streams: true,
  optionProviders: { models: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 120000 },
  execute: async (ctx, input) => {
    const provider = ctx.providers.generation(ctx.config.model, {
      credentialSlot: "llm",
    });
    const req = {
      messages: messagesFor(ctx.config.system, input.prompt),
      temperature: ctx.config.temperature,
      maxOutputTokens: ctx.config.maxOutputTokens,
    };
    if (ctx.config.stream && provider.capabilities.streaming) {
      let text = "";
      let finish: GenerationResult["finishReason"] = "stop";
      let tokens: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      for await (const chunk of provider.stream(req, callCtx(ctx))) {
        switch (chunk.type) {
          case "text":
            text += chunk.delta;
            ctx.events.stream("text", chunk.delta);
            break;
          case "thinking":
            ctx.events.stream("thinking", chunk.delta);
            break;
          case "usage":
            tokens = chunk.usage;
            break;
          case "done":
            finish = chunk.finishReason;
            break;
          case "tool_call":
            break;
        }
      }
      return ok({ text, finish_reason: finish, usage: tokens }, { usage: tokens });
    }
    const r = await provider.generate(req, callCtx(ctx));
    return ok(
      { text: r.text, finish_reason: r.finishReason, usage: r.usage },
      { usage: r.usage, costUsd: r.costUsd },
    );
  },
});
