/**
 * Testing and discovering a server, shared by the API (HTTP servers) and the worker (stdio
 * servers, which only the worker may spawn). The answers are plain JSON so the worker can hand
 * them back through a `jobs` row.
 */
import type { JsonValue, ToolDefinition } from "@flowaid/workflow-core";
import type { McpServerConfig } from "./connect.js";
import { discoverTools, type DiscoveryResult, type DiscoveryWarning } from "./discover.js";
import type { CallOptions, McpPromptInfo, McpResourceInfo, McpSession } from "./session.js";

/** `POST /v1/mcp/servers/:id/test` and `POST /v1/mcp/servers/test`. */
export interface McpTestAnswer {
  ok: boolean;
  /** why it failed (at most 500 characters) */
  message?: string;
  server?: { name: string; version: string } | null;
  /** tools the server lists (before the tool policy); absent when listing failed */
  toolCount?: number;
}

/** `POST /v1/mcp/servers/:id/discover`. */
export interface McpDiscoveryAnswer {
  tools: ToolDefinition[];
  excluded: string[];
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
  warnings: DiscoveryWarning[];
  server: { name: string; version: string } | null;
}

/** The discovery columns of an `mcp_servers` row. */
export interface StoredDiscovery {
  /** sanitised tools; `x-mcp-name` keeps the server's own name for tools/call when it differs */
  discoveredTools: ToolDefinition[];
  discoveredResources: JsonValue;
  discoveredPrompts: JsonValue;
  warnings: string[];
}

/** Pings the server and counts its tools. Throws when the ping fails. */
export async function testSession(session: McpSession, o?: CallOptions): Promise<McpTestAnswer> {
  await session.ping(o);
  const toolCount = await session
    .listTools(o)
    .then((t) => t.length)
    .catch(() => undefined);
  return {
    ok: true,
    server: session.serverInfo ?? null,
    ...(toolCount !== undefined ? { toolCount } : {}),
  };
}

/** A failed test, with the message trimmed for storage and display. */
export function failedTest(error: unknown): McpTestAnswer {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, message: message.slice(0, 500) || "the server did not answer" };
}

export function storedDiscovery(d: DiscoveryResult): StoredDiscovery {
  return {
    // Keep the server's own names next to the sanitised ones for tools/call.
    discoveredTools: d.tools.map((t) => ({
      ...t,
      ...(d.nameMap[t.name] && d.nameMap[t.name] !== t.name
        ? { "x-mcp-name": d.nameMap[t.name] }
        : {}),
    })),
    discoveredResources: d.resources as unknown as JsonValue,
    discoveredPrompts: d.prompts as unknown as JsonValue,
    warnings: d.warnings.map((w) => `W_MCP_TOOL_SUSPICIOUS ${w.tool}: ${w.reasons.join("; ")}`),
  };
}

export function discoveryAnswer(d: DiscoveryResult): McpDiscoveryAnswer {
  return {
    tools: d.tools,
    excluded: d.excluded,
    resources: d.resources,
    prompts: d.prompts,
    warnings: d.warnings,
    server: d.server,
  };
}

/** Discovers over an open session and returns both what to store and what to answer. */
export async function discoverSession(
  session: McpSession,
  server: McpServerConfig,
  o?: CallOptions,
): Promise<{ stored: StoredDiscovery; answer: McpDiscoveryAnswer }> {
  const d = await discoverTools(session, server, o);
  return { stored: storedDiscovery(d), answer: discoveryAnswer(d) };
}
