import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { MCP_RESOURCE_BUILTIN } from "@flowaid/mcp";
import { MCP_CREDENTIAL, mcpServerId } from "./mcp.js";
import { expectOk } from "./toolResult.js";

const content = z.object({
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
});

export const mcpResourceNode = defineNode({
  id: "flowaid.tools.mcp_resource",
  version: "1.0.0",
  metadata: {
    name: "MCP resource",
    description:
      "Reads a resource from a connected MCP server. `uri` may be a template; the server's toolPolicy applies to the URI.",
    category: "tool",
    icon: "file-text",
    tags: ["tool", "mcp", "resource"],
    summary: "{{ config.uri }}",
  },
  configSchema: z.strictObject({
    serverId: mcpServerId,
    uri: z
      .string()
      .min(1)
      .max(2000)
      .meta({ "x-ui": { widget: "template", placeholder: "kb://guides/{{ start.topic }}" } }),
    timeoutMs: z.int().min(1).max(600000).default(30000),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    contents: z.array(content),
    text: z.string().meta({ "x-port": { description: "Text contents joined by blank lines." } }),
  }),
  credentials: [MCP_CREDENTIAL],
  capabilities: ["network", "credentials", "tools"],
  idempotency: "safe",
  optionProviders: { mcpServers: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx) => {
    const { serverId, uri, timeoutMs } = ctx.config;
    const r = expectOk(
      await ctx.tools.call(
        { kind: "builtin", id: MCP_RESOURCE_BUILTIN },
        MCP_RESOURCE_BUILTIN,
        { serverId, uri },
        { timeoutMs },
      ),
      uri,
    );
    const structured = (r.structured ?? {}) as { contents?: z.infer<typeof content>[] };
    const contents = structured.contents ?? [];
    return ok({
      contents,
      text: contents.flatMap((c) => (c.text !== undefined ? [c.text] : [])).join("\n\n"),
    });
  },
});
