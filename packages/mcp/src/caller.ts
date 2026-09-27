/**
 * The MCP half of `ctx.tools.call` for the worker: `mcp` sources call tools through the pool, and
 * two builtins serve the resource and prompt nodes (`mcp_resource_read`, `mcp_prompt_get`). Every
 * call applies the server's toolPolicy (to tool names and resource URIs) and returns a `ToolResult`.
 */
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ToolExecutionError,
  toFlowaidError,
  type JsonObject,
  type JsonValue,
  type ToolResult,
  type ToolSource,
} from "@flowaid/workflow-core";
import type { CredentialFields } from "./auth.js";
import type { McpServerConfig } from "./connect.js";
import { evaluatePolicy } from "./policy.js";
import type { McpSessionPool } from "./pool.js";
import type { McpContent, McpPromptMessage } from "./session.js";

export const MCP_RESOURCE_BUILTIN = "mcp_resource_read";
export const MCP_PROMPT_BUILTIN = "mcp_prompt_get";

export interface McpServerLookup {
  server(
    serverId: string,
  ): Promise<(McpServerConfig & { nameMap?: Record<string, string> }) | null>;
  /** The credential bound for this call, if any. */
  credential(serverId: string): Promise<{ id: string | null; fields?: CredentialFields } | null>;
}

export interface McpCallContext {
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}

/** Text a model sees for MCP content blocks. */
export function contentToText(content: readonly McpContent[]): string {
  return content
    .map((c) => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "resource") return c.resource?.text ?? `[resource ${c.resource?.uri ?? ""}]`;
      if (c.type === "resource_link") return `[resource ${c.uri ?? ""}]`;
      return `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ""}]`;
    })
    .join("\n");
}

function parseJson(text: string): JsonValue | undefined {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t) as JsonValue;
  } catch {
    return undefined;
  }
}

/** Chat messages from an MCP prompt (text content only; other blocks become placeholders). */
export function promptToMessages(
  messages: readonly McpPromptMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages.map((m) => ({ role: m.role, content: contentToText([m.content]) }));
}

export function createMcpToolCaller(pool: McpSessionPool, lookup: McpServerLookup) {
  const serverFor = async (serverId: string) => {
    const server = await lookup.server(serverId);
    if (!server) throw new NotFoundError(`MCP server ${serverId} not found`);
    return server;
  };

  return async function call(
    source: ToolSource,
    name: string,
    args: JsonValue,
    o: McpCallContext = {},
  ): Promise<ToolResult> {
    const now = o.now ?? (() => Date.now());
    const started = now();
    const done = (r: Omit<ToolResult, "latencyMs">): ToolResult => ({
      ...r,
      latencyMs: Math.max(0, now() - started),
    });
    const callOpts = {
      ...(o.signal ? { signal: o.signal } : {}),
      ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    };
    try {
      if (source.kind === "mcp") {
        const server = await serverFor(source.serverId);
        const original = server.nameMap?.[source.tool] ?? source.tool;
        const verdict = evaluatePolicy(server.toolPolicy, original);
        if (!verdict.allowed) throw new ForbiddenError(verdict.reason);
        const r = await pool.withSession(
          server,
          await lookup.credential(server.id),
          (s) => s.callTool(original, args ?? {}, callOpts),
          o.signal,
        );
        const content = contentToText(r.content);
        const structured =
          r.structuredContent ??
          (r.content.length === 1 && r.content[0]?.type === "text"
            ? parseJson(content)
            : undefined);
        if (r.isError) {
          const error = new ToolExecutionError(
            content.slice(0, 2000) || `${name} failed`,
            false,
            name,
          );
          return done({ ok: false, content, error: error.toInfo({}) });
        }
        return done({ ok: true, content, ...(structured !== undefined ? { structured } : {}) });
      }
      if (source.kind === "builtin" && source.id === MCP_RESOURCE_BUILTIN) {
        const a = (args ?? {}) as JsonObject;
        if (typeof a.serverId !== "string" || typeof a.uri !== "string")
          throw new BadRequestError("mcp_resource_read needs { serverId, uri }");
        const server = await serverFor(a.serverId);
        const verdict = evaluatePolicy(server.toolPolicy, a.uri);
        if (!verdict.allowed) throw new ForbiddenError(verdict.reason);
        const uri = a.uri;
        const contents = await pool.withSession(
          server,
          await lookup.credential(server.id),
          (s) => s.readResource(uri, callOpts),
          o.signal,
        );
        return done({
          ok: true,
          content: contents.map((c) => c.text ?? `[${c.mimeType ?? "binary"} ${c.uri}]`).join("\n"),
          structured: { contents: contents as unknown as JsonValue },
        });
      }
      if (source.kind === "builtin" && source.id === MCP_PROMPT_BUILTIN) {
        const a = (args ?? {}) as JsonObject;
        if (typeof a.serverId !== "string" || typeof a.name !== "string")
          throw new BadRequestError("mcp_prompt_get needs { serverId, name, arguments }");
        const server = await serverFor(a.serverId);
        const promptName = a.name;
        const promptArgs = Object.fromEntries(
          Object.entries((a.arguments ?? {}) as JsonObject).map(([k, v]) => [
            k,
            typeof v === "string" ? v : JSON.stringify(v),
          ]),
        );
        const r = await pool.withSession(
          server,
          await lookup.credential(server.id),
          (s) => s.getPrompt(promptName, promptArgs, callOpts),
          o.signal,
        );
        const messages = promptToMessages(r.messages);
        return done({
          ok: true,
          content: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
          structured: { messages, ...(r.description ? { description: r.description } : {}) },
        });
      }
      throw new BadRequestError(`the MCP caller does not handle ${source.kind} tools`);
    } catch (error) {
      const e = toFlowaidError(error);
      if (e instanceof BadRequestError || e instanceof ForbiddenError || e instanceof NotFoundError)
        throw e;
      if (e instanceof ToolExecutionError) throw e;
      throw new ToolExecutionError(`MCP ${name}: ${e.message}`, e.retryable, name);
    }
  };
}
