import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { ChatMessage } from "@flowaid/workflow-core";
import { chatMessageSchema } from "../common.js";

export const promptNode = defineNode({
  id: "flowaid.ai.prompt",
  version: "1.0.0",
  metadata: {
    name: "Prompt",
    description:
      "Builds a chat conversation from a system and a user template plus the recent history (for example from session state). Feed `messages` to Generate text.",
    category: "generation",
    icon: "message-square-text",
    tags: ["llm", "prompt", "messages"],
    summary: "prompt",
  },
  configSchema: z.strictObject({
    system: z
      .string()
      .max(32000)
      .optional()
      .meta({
        "x-ui": {
          widget: "template",
          help: "Rendered with the upstream values ({{ node.port }}).",
        },
      }),
    user: z
      .string()
      .min(1)
      .max(64000)
      .meta({ "x-ui": { widget: "template" } }),
    historyLimit: z
      .int()
      .min(0)
      .max(200)
      .default(20)
      .meta({
        "x-ui": {
          help: "Most recent history messages kept; system messages in history are dropped.",
        },
      }),
  }),
  inputSchema: z.object({ history: z.array(chatMessageSchema).optional() }),
  outputSchema: z.object({
    messages: z.array(chatMessageSchema),
    count: z.int().min(0),
  }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    const history = (input.history ?? []).filter((m) => m.role !== "system") as ChatMessage[];
    const kept = ctx.config.historyLimit > 0 ? history.slice(-ctx.config.historyLimit) : [];
    const messages: ChatMessage[] = [
      ...(ctx.config.system ? [{ role: "system" as const, content: ctx.config.system }] : []),
      ...kept,
      { role: "user", content: ctx.config.user },
    ];
    return Promise.resolve(ok({ messages, count: messages.length }));
  },
});
