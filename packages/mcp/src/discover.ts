/**
 * Discovery (ARCHITECTURE.md §10.2): lists a server's tools, resources and prompts and turns tools
 * into `ToolDefinition`s — sanitised names (with the original kept for calls), capped descriptions,
 * idempotency from the MCP annotations, toolPolicy applied, and `W_MCP_TOOL_SUSPICIOUS` warnings.
 */
import {
  ToolDefinitionSchema,
  type Idempotency,
  type JsonSchema,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import type { McpServerConfig } from "./connect.js";
import { evaluatePolicy } from "./policy.js";
import { sanitizeToolDescription, sanitizeToolName, suspiciousReasons } from "./sanitize.js";
import type {
  CallOptions,
  McpPromptInfo,
  McpResourceInfo,
  McpResourceTemplateInfo,
  McpSession,
  McpToolInfo,
} from "./session.js";

export interface DiscoveryWarning {
  code: "W_MCP_TOOL_SUSPICIOUS";
  tool: string;
  reasons: string[];
}

export interface DiscoveryResult {
  tools: ToolDefinition[];
  /** sanitised tool name → the server's own name (used for tools/call) */
  nameMap: Record<string, string>;
  /** tools removed by the server's toolPolicy */
  excluded: string[];
  resources: McpResourceInfo[];
  resourceTemplates: McpResourceTemplateInfo[];
  prompts: McpPromptInfo[];
  warnings: DiscoveryWarning[];
  server: { name: string; version: string } | null;
}

/** `readOnlyHint` → safe; `idempotentHint` → keyed; otherwise none. */
export function idempotencyOf(annotations: McpToolInfo["annotations"]): Idempotency {
  if (annotations?.readOnlyHint === true) return "safe";
  if (annotations?.idempotentHint === true) return "keyed";
  return "none";
}

/** A capability name for the tool: `<server>.read` for read-only tools, else `<server>.write`. */
export function capabilityOf(server: McpServerConfig, tool: McpToolInfo): string {
  const prefix =
    sanitizeToolName((server.name ?? "mcp").toLowerCase())
      .replace(/-/g, "_")
      .slice(0, 40) || "mcp";
  return `${prefix}.${tool.annotations?.readOnlyHint === true ? "read" : "write"}`;
}

function objectSchema(schema: unknown): JsonSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema))
    return { type: "object" };
  const s = schema as JsonSchema;
  return s.type === undefined ? { ...s, type: "object" } : s;
}

export function toolsToDefinitions(
  server: McpServerConfig,
  tools: readonly McpToolInfo[],
): Omit<DiscoveryResult, "resources" | "resourceTemplates" | "prompts" | "server"> {
  const out: ToolDefinition[] = [];
  const nameMap: Record<string, string> = {};
  const excluded: string[] = [];
  const warnings: DiscoveryWarning[] = [];
  const used = new Set<string>();
  for (const tool of tools) {
    let name = sanitizeToolName(tool.name);
    for (let i = 2; used.has(name); i++) name = `${sanitizeToolName(tool.name).slice(0, 60)}_${i}`;
    const verdict = evaluatePolicy(server.toolPolicy, tool.name);
    if (!verdict.allowed) {
      excluded.push(tool.name);
      continue;
    }
    used.add(name);
    nameMap[name] = tool.name;
    const description = sanitizeToolDescription(
      tool.description ?? tool.title ?? tool.annotations?.title,
    );
    const reasons = suspiciousReasons(
      tool.name,
      tool.description,
      JSON.stringify(tool.inputSchema ?? {}),
    );
    if (reasons.length > 0) warnings.push({ code: "W_MCP_TOOL_SUSPICIOUS", tool: name, reasons });
    out.push(
      ToolDefinitionSchema.parse({
        name,
        description,
        inputSchema: objectSchema(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: objectSchema(tool.outputSchema) } : {}),
        capability: capabilityOf(server, tool),
        idempotency: idempotencyOf(tool.annotations),
        approvalRequired: verdict.approvalRequired || reasons.length > 0,
        source: { kind: "mcp", serverId: server.id, tool: name },
      }),
    );
  }
  return { tools: out, nameMap, excluded, warnings };
}

export async function discoverTools(
  session: McpSession,
  server: McpServerConfig,
  o?: CallOptions,
): Promise<DiscoveryResult> {
  const tools = await session.listTools(o);
  const { resources, templates } = await session
    .listResources(o)
    .catch(() => ({ resources: [], templates: [] }));
  const prompts = await session.listPrompts(o).catch(() => []);
  const allowedResources = resources.filter(
    (r) => evaluatePolicy(server.toolPolicy, r.uri).allowed,
  );
  return {
    ...toolsToDefinitions(server, tools),
    resources: allowedResources.map((r) => ({
      ...r,
      ...(r.description ? { description: sanitizeToolDescription(r.description) } : {}),
    })),
    resourceTemplates: templates,
    prompts: prompts.map((p) => ({
      ...p,
      ...(p.description ? { description: sanitizeToolDescription(p.description) } : {}),
    })),
    server: session.serverInfo ?? null,
  };
}
