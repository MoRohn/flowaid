import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { MCP_PROMPT_BUILTIN } from "@flowaid/mcp";
import type { JsonObject } from "@flowaid/workflow-core";
import { MCP_CREDENTIAL, mcpServerId } from "./mcp.js";
import { expectOk } from "./toolResult.js";

export const mcpPromptNode = defineNode({
  id: "flowaid.tools.mcp_prompt",
  version: "1.0.0",
  metadata: {
    name: "MCP prompt",
    description:
      "Renders a prompt template from a connected MCP server. Input ports are the prompt's arguments; `messages` are chat messages ready for a generation node.",
    category: "tool",
    icon: "message-square-text",
    tags: ["tool", "mcp", "prompt"],
    summary: "{{ config.name }}",
  },
  configSchema: z.strictObject({
    serverId: mcpServerId,
    name: z
      .string()
      .min(1)
      .max(200)
      .meta({ "x-ui": { widget: "select", optionsProvider: "mcpPrompts" } }),
    timeoutMs: z.int().min(1).max(600000).default(30000),
  }),
  inputSchema: z.looseObject({}),
  dynamicInputs: z.union([z.string(), z.number(), z.boolean()]),
  outputSchema: z.object({
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
    description: z.string(),
  }),
  credentials: [MCP_CREDENTIAL],
  capabilities: ["network", "credentials", "tools"],
  idempotency: "safe",
  optionProviders: { mcpServers: () => Promise.resolve([]), mcpPrompts: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const { serverId, name, timeoutMs } = ctx.config;
    const args = Object.fromEntries(
      Object.entries(input as JsonObject).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    );
    const r = expectOk(
      await ctx.tools.call(
        { kind: "builtin", id: MCP_PROMPT_BUILTIN },
        MCP_PROMPT_BUILTIN,
        { serverId, name, arguments: args },
        { timeoutMs },
      ),
      name,
    );
    const s = (r.structured ?? {}) as {
      messages?: { role: "user" | "assistant"; content: string }[];
      description?: string;
    };
    return ok({ messages: s.messages ?? [], description: s.description ?? "" });
  },
});
