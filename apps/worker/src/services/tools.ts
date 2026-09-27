/**
 * `ctx.tools` in the worker: MCP tools and the resource/prompt builtins through the session pool,
 * OpenAPI operations through `executeOperation`, each call reported as TOOL_CALLED/TOOL_RETURNED.
 * Credentials: the node's `mcp`/`auth` slot when bound, else the tool's own credential.
 */
import { and, eq } from "drizzle-orm";
import type { CredentialRepository } from "@flowaid/workflow-core";
import {
  createMcpToolCaller,
  MCP_PROMPT_BUILTIN,
  MCP_RESOURCE_BUILTIN,
  type McpServerConfig,
  type McpSessionPool,
} from "@flowaid/mcp";
import { executeOperation, type OperationSpec } from "@flowaid/openapi-tools";
import { mcpServers, tools, type Database } from "@flowaid/database";
import type { ToolAccess } from "@flowaid/node-sdk";
import { uuidv7 } from "@flowaid/shared";
import {
  NotFoundError,
  toFlowaidError,
  type JsonValue,
  type SafeFetch,
  type ToolDefinition,
  type ToolResult,
  type ToolSource,
} from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";
import type { RunCredentialCache } from "./credentials.js";

export interface ToolDeps {
  db: Database;
  pool: McpSessionPool;
  http: SafeFetch;
  repo: CredentialRepository;
  cache: RunCredentialCache;
  /** development only */
  allowPrivateNetwork?: boolean;
}

type Discovered = ToolDefinition & { "x-mcp-name"?: string };

export function toolAccessFor(deps: ToolDeps, call: ExecutionCall): ToolAccess {
  const op = call.node.op;
  const slots = op.kind === "task" ? op.credentials : {};
  const slotCredential = async (
    slot: string,
  ): Promise<{ id: string; fields: Record<string, string>; type: string } | null> => {
    const secret = slots[slot];
    if (!secret) return null;
    const id = await deps.repo.resolveBinding(call.workflowId, call.environmentId, secret);
    if (!id) return null;
    const row = await deps.repo.getCiphertext(id);
    return { id, fields: await deps.cache.for(call.runId).get(id), type: row?.type ?? "" };
  };
  const credentialById = async (id: string | null) => {
    if (!id) return null;
    const row = await deps.repo.getCiphertext(id);
    return row ? { id, fields: await deps.cache.for(call.runId).get(id), type: row.type } : null;
  };

  const caller = createMcpToolCaller(deps.pool, {
    server: async (serverId) => {
      const [s] = await deps.db.tenant(call.workspaceId, (tx) =>
        tx
          .select()
          .from(mcpServers)
          .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, call.workspaceId))),
      );
      if (!s || s.status === "disabled") return null;
      const nameMap: Record<string, string> = {};
      for (const t of s.discoveredTools as Discovered[])
        if (t["x-mcp-name"]) nameMap[t.name] = t["x-mcp-name"];
      const config: McpServerConfig & { nameMap: Record<string, string> } = {
        id: s.id,
        name: s.name,
        transport: s.transport,
        ...(s.url ? { url: s.url } : {}),
        ...(s.command
          ? { stdio: { command: s.command, args: s.args ?? [], env: s.env ?? {} } }
          : {}),
        toolPolicy: s.toolPolicy,
        nameMap,
      };
      return config;
    },
    credential: async (serverId) => {
      const own = await slotCredential("mcp");
      if (own) return { id: own.id, fields: own.fields };
      const [s] = await deps.db.tenant(call.workspaceId, (tx) =>
        tx
          .select({ credentialId: mcpServers.credentialId })
          .from(mcpServers)
          .where(eq(mcpServers.id, serverId)),
      );
      const c = await credentialById(s?.credentialId ?? null);
      return c ? { id: c.id, fields: c.fields } : null;
    },
  });

  const openapi = async (
    source: Extract<ToolSource, { kind: "openapi" }>,
    args: JsonValue,
    timeoutMs: number | undefined,
  ): Promise<ToolResult> => {
    const [t] = await deps.db.tenant(call.workspaceId, (tx) =>
      tx
        .select()
        .from(tools)
        .where(and(eq(tools.id, source.toolsetId), eq(tools.workspaceId, call.workspaceId))),
    );
    if (!t) throw new NotFoundError(`toolset ${source.toolsetId} not found`);
    const def = t.definitions.find((d) => d.name === source.operationId);
    const spec = ((t.source as { operations?: Record<string, OperationSpec> }).operations ?? {})[
      source.operationId
    ];
    if (!def || !spec) throw new NotFoundError(`operation ${source.operationId} not found`);
    const cred = (await slotCredential("auth")) ?? (await credentialById(t.credentialId));
    return executeOperation(spec, def, args, {
      fetch: deps.http,
      credential: cred ? { type: cred.type, fields: cred.fields } : null,
      idempotencyKey: call.idempotencyKey,
      signal: call.signal,
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(deps.allowPrivateNetwork ? { allowPrivate: true } : {}),
    });
  };

  return {
    list: async () => {
      const [servers, sets] = await deps.db.tenant(call.workspaceId, (tx) =>
        Promise.all([
          tx
            .select({ tools: mcpServers.discoveredTools })
            .from(mcpServers)
            .where(eq(mcpServers.workspaceId, call.workspaceId)),
          tx
            .select({ defs: tools.definitions })
            .from(tools)
            .where(eq(tools.workspaceId, call.workspaceId)),
        ]),
      );
      return [...servers.flatMap((s) => s.tools), ...sets.flatMap((s) => s.defs)];
    },
    call: async (source, name, args, opts) => {
      const toolCallId = uuidv7();
      const kind = source.kind === "builtin" ? "builtin" : source.kind;
      call.emit({
        type: "TOOL_CALLED",
        toolCallId,
        tool: name,
        source: kind,
        args,
        capability: null,
        coerced: false,
      } as never);
      const started = Date.now();
      let result: ToolResult;
      try {
        if (source.kind === "openapi") result = await openapi(source, args, opts?.timeoutMs);
        else if (
          source.kind === "mcp" ||
          (source.kind === "builtin" &&
            (source.id === MCP_RESOURCE_BUILTIN || source.id === MCP_PROMPT_BUILTIN))
        )
          result = await caller(source, name, args, {
            signal: call.signal,
            ...(opts?.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
          });
        else throw new NotFoundError(`no handler for ${source.kind} tools`);
      } catch (error) {
        const e = toFlowaidError(error);
        call.emit({
          type: "TOOL_RETURNED",
          toolCallId,
          tool: name,
          ok: false,
          result: null,
          error: e.toInfo({}),
          latencyMs: Date.now() - started,
        } as never);
        throw e;
      }
      call.emit({
        type: "TOOL_RETURNED",
        toolCallId,
        tool: name,
        ok: result.ok,
        result: (result.structured ?? result.content) as JsonValue,
        error: result.error ?? null,
        latencyMs: Date.now() - started,
      } as never);
      return result;
    },
  };
}
