import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { expectOk } from "./toolResult.js";

/** The server slot every MCP node shares. */
export const MCP_CREDENTIAL = {
  name: "mcp",
  types: ["mcp.headers", "mcp.oauth", "http.bearer"],
  required: false,
  description: "Credential sent to the MCP server, if it needs one.",
};

export const mcpServerId = z
  .string()
  .min(1)
  .meta({ "x-ui": { widget: "select", optionsProvider: "mcpServers" } });

/**
 * The API answers `mcpServers` / `mcpTools` / `mcpPrompts` from the discovered catalog
 * (`mcp_servers` rows); these node-side providers are the offline fallback.
 */
const none = () => Promise.resolve([]);

export const mcpNode = defineNode({
  id: "flowaid.tools.mcp",
  version: "1.0.0",
  metadata: {
    name: "MCP tool",
    description:
      "Calls one tool of a connected MCP server. Input ports are the tool's arguments; `result` is its structured result and `content` its text content.",
    category: "tool",
    icon: "plug",
    tags: ["tool", "mcp"],
    summary: "{{ config.tool }}",
  },
  configSchema: z.strictObject({
    serverId: mcpServerId,
    tool: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .meta({ "x-ui": { widget: "select", optionsProvider: "mcpTools" } }),
    timeoutMs: z.int().min(1).max(600000).default(60000),
  }),
  inputSchema: z.looseObject({}),
  outputSchema: z.object({ result: z.unknown(), content: z.string() }),
  portRules: [{ kind: "toolSignature", source: "mcp" }],
  credentials: [MCP_CREDENTIAL],
  capabilities: ["network", "credentials", "tools"],
  idempotency: "none",
  optionProviders: { mcpServers: none, mcpTools: none },
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    const { serverId, tool, timeoutMs } = ctx.config;
    const r = expectOk(
      await ctx.tools.call({ kind: "mcp", serverId, tool }, tool, input as JsonValue, {
        timeoutMs,
      }),
      tool,
    );
    return ok({ result: r.structured ?? r.content, content: r.content });
  },
});
