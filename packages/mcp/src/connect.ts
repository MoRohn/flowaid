/** Opening a session to a configured MCP server over its transport. */
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { BadRequestError, ForbiddenError } from "@flowaid/workflow-core";
import { headersFromCredential, type CredentialFields, type FetchLike } from "./auth.js";
import type { ToolPolicy } from "./policy.js";
import { McpSession } from "./session.js";
import {
  PolicyStdioTransport,
  planStdioSpawn,
  type StdioPolicy,
  type StdioServerConfig,
  type StdioTransportOptions,
} from "./stdio.js";

export type McpTransportKind = "streamable_http" | "sse" | "stdio";

/** An `mcp_servers` row as the worker sees it. */
export interface McpServerConfig {
  id: string;
  name?: string;
  transport: McpTransportKind;
  /** streamable_http / sse endpoint */
  url?: string;
  /** static, non-secret headers (secrets come from the bound credential) */
  headers?: Readonly<Record<string, string>>;
  stdio?: StdioServerConfig;
  toolPolicy?: ToolPolicy;
  timeoutMs?: number;
}

export interface ConnectOptions {
  /** SSRF-guarded fetch for HTTP transports (the worker passes SafeFetch). */
  fetch?: FetchLike;
  stdioPolicy?: StdioPolicy;
  stdio?: Omit<StdioTransportOptions, "signal">;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function createTransport(
  server: McpServerConfig,
  credential: CredentialFields | undefined,
  o: ConnectOptions = {},
): Transport {
  switch (server.transport) {
    case "streamable_http":
    case "sse": {
      if (!server.url) throw new BadRequestError(`MCP server ${server.id} has no url`);
      const url = new URL(server.url);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new BadRequestError(`MCP server url must be http(s): ${server.url}`);
      const headers = { ...(server.headers ?? {}), ...headersFromCredential(credential) };
      const init = { requestInit: { headers }, ...(o.fetch ? { fetch: o.fetch as never } : {}) };
      return server.transport === "streamable_http"
        ? new StreamableHTTPClientTransport(url, init)
        : new SSEClientTransport(url, init);
    }
    case "stdio": {
      if (!server.stdio) throw new BadRequestError(`MCP server ${server.id} has no stdio command`);
      if (!o.stdioPolicy) throw new ForbiddenError("stdio MCP servers run only in the worker");
      const plan = planStdioSpawn(o.stdioPolicy, server.stdio, credential ?? {});
      return new PolicyStdioTransport(plan, {
        ...o.stdio,
        ...(o.signal ? { signal: o.signal } : {}),
      });
    }
  }
}

/**
 * Connects, preferring streamable HTTP; a server that answers the initial POST with 404/405 is
 * retried once over legacy SSE (the MCP backwards-compatibility rule).
 */
export async function connectSession(
  server: McpServerConfig,
  credential: CredentialFields | undefined,
  o: ConnectOptions = {},
): Promise<McpSession> {
  const timeoutMs = o.timeoutMs ?? server.timeoutMs;
  const callOpts = {
    ...(o.signal ? { signal: o.signal } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  try {
    return await McpSession.connect(createTransport(server, credential, o), callOpts);
  } catch (error) {
    const status = (error as { code?: unknown }).code;
    if (server.transport === "streamable_http" && (status === 404 || status === 405))
      return McpSession.connect(
        createTransport({ ...server, transport: "sse" }, credential, o),
        callOpts,
      );
    throw error;
  }
}
