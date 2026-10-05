/** Tools, OpenAPI toolsets, MCP servers, exposures and MCP tokens (API.md §3.7). */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import {
  connectSession,
  discoverSession,
  evaluatePolicy,
  failedTest,
  planStdioSpawn,
  testSession,
  type McpDiscoveryAnswer,
  type McpServerConfig,
  type McpTestAnswer,
} from "@flowaid/mcp";
import {
  OpenApiImportError,
  executeOperation,
  isPrivateUrl,
  operationsToTools,
  parseOpenApi,
  type OperationSpec,
} from "@flowaid/openapi-tools";
import {
  createApiKey,
  credentials,
  environments,
  jobs,
  mcpExposures,
  mcpServers,
  tools,
  workflowDeployments,
  workflows,
  type Tx,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TimeoutError,
  ToolExecutionError,
  toFlowaidError,
  type ErrorInfo,
  type JsonObject,
  type JsonValue,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import { generateApiKey } from "../auth/apiKey.js";
import { hasScope, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent, PageQuery, afterCursor, toPage } from "../dto/common.js";
import { ApiKeyCreatedSchema } from "../dto/identity.js";

type ToolRow = typeof tools.$inferSelect;
type McpRow = typeof mcpServers.$inferSelect;

const toolDto = (t: ToolRow) => ({
  id: t.id,
  name: t.name,
  kind: t.kind,
  definitions: t.definitions,
  source: t.source,
  credentialId: t.credentialId,
  version: t.version,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
const mcpDto = (s: McpRow) => ({
  id: s.id,
  name: s.name,
  transport: s.transport,
  url: s.url,
  command: s.command,
  args: s.args,
  authKind: s.authKind,
  credentialId: s.credentialId,
  status: s.status,
  toolPolicy: s.toolPolicy,
  toolCount: s.discoveredTools.length,
  warnings: s.warnings,
  lastError: s.lastError,
  lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
});

/**
 * `active`: MCP clients see the tool now — it is switched on and some version of the workflow is
 * deployed to its environment (`deployed`).
 */
const exposureDto = (e: typeof mcpExposures.$inferSelect, deployed: boolean, url: string) => ({
  id: e.id,
  workflowId: e.workflowId,
  environmentId: e.environmentId,
  toolName: e.toolName,
  description: e.description,
  enabled: e.enabled,
  source: e.source,
  deployed,
  active: e.enabled && deployed,
  url,
});

const McpServerRequest = z.object({
  name: z.string().min(1).max(100),
  transport: z.enum(["streamable_http", "sse", "stdio"]),
  url: z.url().optional(),
  command: z.string().max(500).optional(),
  args: z.array(z.string().max(500)).max(50).optional(),
  env: z.record(z.string(), z.string()).optional(),
  authKind: z.enum(["none", "headers", "oauth2"]).default("none"),
  credentialId: z.uuid().nullable().optional(),
});

const PolicySchema = z.object({
  allow: z.array(z.string().max(200)).max(200).default(["*"]),
  deny: z.array(z.string().max(200)).max(200).default([]),
  approvalRequired: z.array(z.string().max(200)).max(200).default([]),
});

export function toolRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const credentialOf = async (tx: Tx, p: Principal, id: string | null | undefined) => {
    if (!id) return null;
    const [c] = await tx
      .select()
      .from(credentials)
      .where(and(eq(credentials.id, id), eq(credentials.workspaceId, p.workspaceId)));
    if (!c) throw new BadRequestError("credential not found");
    return c;
  };

  // --- tools ---
  r.get(
    "/v1/tools",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "tool", verb: "list" },
      },
      schema: { tags: ["tools"], querystring: PageQuery },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(tools)
          .where(
            and(eq(tools.workspaceId, p.workspaceId), afterCursor(tools.name, tools.id, cursor)),
          )
          .orderBy(asc(tools.name), asc(tools.id))
          .limit(limit + 1),
      );
      return toPage(rows, limit, (t) => [t.name, t.id], toolDto);
    },
  );

  r.get(
    "/v1/tools/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "tool", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["tools"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      const [t] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(tools)
          .where(and(eq(tools.id, req.params.id), eq(tools.workspaceId, p.workspaceId))),
      );
      if (!t) throw new NotFoundError("tool not found");
      return toolDto(t);
    },
  );

  r.patch(
    "/v1/tools/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "tool.update", resource: "tool" },
        cli: { noun: "tool", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["tools"],
        params: IdParams,
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          credentialId: z.uuid().nullable().optional(),
        }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const t = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await credentialOf(tx, p, req.body.credentialId);
        const [u] = await tx
          .update(tools)
          .set({
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.credentialId !== undefined ? { credentialId: req.body.credentialId } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(tools.id, req.params.id), eq(tools.workspaceId, p.workspaceId)))
          .returning();
        return u;
      });
      if (!t) throw new NotFoundError("tool not found");
      return toolDto(t);
    },
  );

  r.delete(
    "/v1/tools/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "tool.delete", resource: "tool" },
        cli: { noun: "tool", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["tools"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .delete(tools)
          .where(and(eq(tools.id, req.params.id), eq(tools.workspaceId, p.workspaceId)))
          .returning({ id: tools.id }),
      );
      if (!rows.length) throw new NotFoundError("tool not found");
      return reply.code(204).send(null);
    },
  );

  const OpenApiSource = z.object({
    url: z.url().optional(),
    document: z
      .union([z.string().max(2 * 1024 * 1024), z.record(z.string(), z.unknown())])
      .optional(),
    format: z.enum(["json", "yaml"]).optional(),
  });
  const parseFrom = (b: z.infer<typeof OpenApiSource>) => {
    const opts = { fetch: ctx.http, allowPrivate: ctx.config.allowPrivateNetwork };
    if (b.url) return parseOpenApi({ url: b.url }, opts);
    if (b.document === undefined) throw new BadRequestError("send url or document");
    const text = typeof b.document === "string" ? b.document : JSON.stringify(b.document);
    return parseOpenApi({ text, ...(b.format ? { format: b.format } : {}) }, opts);
  };

  r.post(
    "/v1/tools/openapi/preview",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        audit: false,
        cli: { noun: "tool", verb: "openapi-preview" },
      },
      schema: {
        tags: ["tools"],
        summary: "Parse an OpenAPI document and list its operations",
        body: OpenApiSource,
      },
    },
    async (req) => {
      const parsed = await parseFrom(req.body);
      const { tools: defs, operations } = operationsToTools(parsed.document, {
        toolsetId: "00000000-0000-4000-8000-000000000000",
        toolsetName: parsed.title,
      });
      const schemes =
        parsed.document.components && typeof parsed.document.components === "object"
          ? ((parsed.document.components as JsonObject).securitySchemes ?? {})
          : {};
      return {
        title: parsed.title,
        version: parsed.version,
        servers: parsed.servers,
        authSchemes: schemes,
        warnings: parsed.warnings,
        operations: defs.map((d) => ({
          name: d.name,
          method: operations[d.name]?.method,
          path: operations[d.name]?.path,
          summary: d.description,
          idempotency: d.idempotency,
          capability: d.capability,
        })),
      };
    },
  );

  r.post(
    "/v1/tools/openapi/import",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "tool.import_openapi", resource: "tool" },
        cli: { noun: "tool", verb: "openapi-import" },
      },
      schema: {
        tags: ["tools"],
        body: OpenApiSource.extend({
          name: z.string().min(1).max(100),
          serverUrl: z.url().optional(),
          include: z.array(z.string()).max(500).optional(),
          credentialId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      if (req.body.serverUrl && isPrivateUrl(req.body.serverUrl) && !ctx.config.allowPrivateNetwork)
        throw new OpenApiImportError(
          "E_TOOL_SERVER_PRIVATE",
          `server ${req.body.serverUrl} is a private address`,
        );
      const parsed = await parseFrom(req.body);
      const id = uuidv7();
      const {
        tools: defs,
        operations,
        skipped,
      } = operationsToTools(parsed.document, {
        toolsetId: id,
        toolsetName: req.body.name,
        ...(req.body.serverUrl ? { serverUrl: req.body.serverUrl } : {}),
        ...(req.body.include ? { include: req.body.include } : {}),
      });
      if (defs.length === 0) throw new BadRequestError("the document has no operations to import");
      const specHash = createHash("sha256").update(JSON.stringify(parsed.document)).digest("hex");
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await credentialOf(tx, p, req.body.credentialId);
        const [dup] = await tx
          .select({ id: tools.id })
          .from(tools)
          .where(and(eq(tools.workspaceId, p.workspaceId), eq(tools.name, req.body.name)));
        if (dup) throw new ConflictError(`a tool named ${req.body.name} exists`);
        const [created] = await tx
          .insert(tools)
          .values({
            id,
            workspaceId: p.workspaceId,
            name: req.body.name,
            kind: "openapi",
            definitions: defs,
            source: {
              ...(req.body.url ? { url: req.body.url } : {}),
              serverUrl: req.body.serverUrl ?? parsed.servers[0] ?? null,
              specHash,
              title: parsed.title,
              operations: operations as unknown as JsonValue,
            } as JsonObject,
            credentialId: req.body.credentialId ?? null,
          })
          .returning();
        return created as ToolRow;
      });
      req.audit = { resourceId: row.id, details: { operations: defs.length } };
      return reply.code(201).send({ ...toolDto(row), skipped });
    },
  );

  r.post(
    "/v1/tools/:id/invoke",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:write",
        audit: { action: "tool.invoke", resource: "tool" },
        cli: { noun: "tool", verb: "invoke", positional: ["id"] },
      },
      schema: {
        tags: ["tools"],
        summary: "Test-invoke one operation of a toolset",
        params: IdParams,
        body: z.object({ tool: z.string().min(1).max(64), args: z.unknown().default({}) }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const t = await ctx.db.tenant(
        p.workspaceId,
        async (tx) =>
          (
            await tx
              .select()
              .from(tools)
              .where(and(eq(tools.id, req.params.id), eq(tools.workspaceId, p.workspaceId)))
          )[0],
      );
      if (!t) throw new NotFoundError("tool not found");
      if (t.kind !== "openapi")
        throw new BadRequestError(`test invocation of ${t.kind} tools runs in the worker`);
      const def = t.definitions.find((d) => d.name === req.body.tool);
      const op = ((t.source as { operations?: Record<string, OperationSpec> }).operations ?? {})[
        req.body.tool
      ];
      if (!def || !op) throw new NotFoundError(`operation ${req.body.tool} not found`);
      const cred = t.credentialId
        ? await ctx.db.tenant(
            p.workspaceId,
            async (tx) =>
              (
                await tx
                  .select()
                  .from(credentials)
                  .where(eq(credentials.id, t.credentialId as string))
              )[0],
          )
        : null;
      const fields = cred ? await ctx.credentials.decrypt(cred.id) : null;
      try {
        return await executeOperation(op, def, req.body.args as JsonValue, {
          fetch: ctx.http,
          credential: cred && fields ? { type: cred.type, fields } : null,
          signal: AbortSignal.timeout(30_000),
          timeoutMs: 30_000,
          allowPrivate: ctx.config.allowPrivateNetwork,
        });
      } catch (error) {
        const e = toFlowaidError(error);
        return { ok: false, content: e.message, error: e.toInfo({}), latencyMs: 0 };
      }
    },
  );

  // --- MCP servers ---
  const loadServer = async (tx: Tx, p: Principal, id: string): Promise<McpRow> => {
    const [s] = await tx
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, id), eq(mcpServers.workspaceId, p.workspaceId)));
    if (!s) throw new NotFoundError("MCP server not found");
    return s;
  };
  /**
   * A stdio server is an arbitrary process on the worker, so registering or changing one needs the
   * `admin` scope, and its command, arguments and environment must pass the worker's spawn policy
   * now instead of being stored and refused at run time (ARCHITECTURE.md §10.2).
   */
  const checkStdio = (
    p: Principal,
    s: { command?: string | null; args?: string[] | null; env?: Record<string, string> | null },
  ) => {
    if (!hasScope(p, "admin"))
      throw new ForbiddenError("registering a stdio MCP server needs the admin scope");
    if (!s.command) throw new BadRequestError("command is required for stdio servers");
    const policy = ctx.config.mcpStdio;
    const unlisted = Object.keys(s.env ?? {}).filter((n) => !policy.envAllowlist.includes(n));
    if (unlisted.length)
      throw new BadRequestError(
        `environment variables not in FLOWAID_MCP_STDIO_ENV_ALLOWLIST: ${unlisted.join(", ")}`,
      );
    planStdioSpawn(policy, { command: s.command, args: s.args ?? [], env: s.env ?? {} });
  };
  const configOf = (s: McpRow): McpServerConfig => ({
    id: s.id,
    name: s.name,
    transport: s.transport,
    ...(s.url ? { url: s.url } : {}),
    ...(s.command ? { stdio: { command: s.command, args: s.args ?? [], env: s.env ?? {} } } : {}),
    toolPolicy: s.toolPolicy,
    timeoutMs: 30_000,
  });
  /** An HTTP session (stdio servers run only in the worker: see `viaWorker`). */
  const sessionFor = async (
    s: Pick<McpRow, "transport" | "credentialId">,
    config: McpServerConfig,
  ) => {
    if (s.transport === "stdio")
      throw new BadRequestError("stdio MCP servers run only in the worker; test-calls need HTTP");
    const fields = s.credentialId ? await ctx.credentials.decrypt(s.credentialId) : undefined;
    return connectSession(config, fields, {
      fetch: ctx.http,
      timeoutMs: 30_000,
      signal: AbortSignal.timeout(30_000),
    });
  };
  /**
   * Hands a stdio server's test or discovery to the worker (`mcp.probe` on the `jobs` queue) and
   * waits for its answer in the `jobs` row, which is removed afterwards — also when no worker
   * answered in time, so a late worker finds nothing to run.
   */
  const viaWorker = async (
    p: Principal,
    kind: "mcp.test" | "mcp.discover",
    payload: JsonObject,
  ): Promise<{
    status: "completed" | "failed" | "waiting";
    result?: JsonObject;
    error?: ErrorInfo;
  }> => {
    const id = uuidv7();
    await ctx.db.tenant(p.workspaceId, (tx) =>
      tx
        .insert(jobs)
        .values({ id, workspaceId: p.workspaceId, kind, payload, createdBy: `${p.type}:${p.id}` }),
    );
    try {
      await ctx.queue.enqueue("jobs", { type: "mcp.probe", jobId: id });
      const deadline = Date.now() + (ctx.config.mcpWorkerWaitMs ?? 45_000);
      for (let delay = 50; ; delay = Math.min(delay * 2, 500)) {
        const [row] = await ctx.db.tenant(p.workspaceId, (tx) =>
          tx.select().from(jobs).where(eq(jobs.id, id)),
        );
        if (row?.status === "completed" || row?.status === "failed")
          return {
            status: row.status,
            ...(row.result ? { result: row.result } : {}),
            ...(row.error ? { error: row.error } : {}),
          };
        if (Date.now() >= deadline) return { status: "waiting" };
        await new Promise((r) =>
          setTimeout(r, Math.min(delay, Math.max(0, deadline - Date.now()))),
        );
      }
    } finally {
      await ctx.db.tenant(p.workspaceId, (tx) => tx.delete(jobs).where(eq(jobs.id, id)));
    }
  };
  const NO_WORKER =
    "no worker answered: stdio servers are started by the worker, so check that it is running";
  /** Tests a server: HTTP from here, stdio through the worker. */
  const testServer = async (
    p: Principal,
    s: Pick<McpRow, "transport" | "credentialId">,
    config: McpServerConfig,
    payload: JsonObject,
  ): Promise<McpTestAnswer> => {
    if (s.transport === "stdio") {
      const out = await viaWorker(p, "mcp.test", payload);
      if (out.status === "waiting") return { ok: false, message: NO_WORKER };
      if (out.status === "failed")
        return failedTest(new Error(out.error?.message ?? "the test failed"));
      return out.result as unknown as McpTestAnswer;
    }
    try {
      const session = await sessionFor(s, config);
      try {
        return await testSession(session, { timeoutMs: 10_000 });
      } finally {
        await session.close();
      }
    } catch (error) {
      return failedTest(toFlowaidError(error));
    }
  };

  r.get(
    "/v1/mcp/servers",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:read",
        cli: { noun: "mcp-server", verb: "list" },
      },
      schema: { tags: ["mcp"], querystring: PageQuery },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(mcpServers)
          .where(
            and(
              eq(mcpServers.workspaceId, p.workspaceId),
              afterCursor(mcpServers.name, mcpServers.id, cursor),
            ),
          )
          .orderBy(asc(mcpServers.name), asc(mcpServers.id))
          .limit(limit + 1),
      );
      return toPage(rows, limit, (s) => [s.name, s.id], mcpDto);
    },
  );

  r.post(
    "/v1/mcp/servers",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.create", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "create" },
      },
      schema: { tags: ["mcp"], body: McpServerRequest },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      if (b.transport !== "stdio" && !b.url)
        throw new BadRequestError("url is required for HTTP transports");
      if (b.transport === "stdio") checkStdio(p, b);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await credentialOf(tx, p, b.credentialId);
        const [dup] = await tx
          .select({ id: mcpServers.id })
          .from(mcpServers)
          .where(and(eq(mcpServers.workspaceId, p.workspaceId), eq(mcpServers.name, b.name)));
        if (dup) throw new ConflictError(`an MCP server named ${b.name} exists`);
        const [created] = await tx
          .insert(mcpServers)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            name: b.name,
            transport: b.transport,
            url: b.url ?? null,
            command: b.command ?? null,
            args: b.args ?? null,
            env: b.env ?? null,
            authKind: b.authKind,
            credentialId: b.credentialId ?? null,
          })
          .returning();
        return created as McpRow;
      });
      req.audit.resourceId = row.id;
      return reply.code(201).send(mcpDto(row));
    },
  );

  r.get(
    "/v1/mcp/servers/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:read",
        cli: { noun: "mcp-server", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      return mcpDto(await ctx.db.tenant(p.workspaceId, (tx) => loadServer(tx, p, req.params.id)));
    },
  );

  r.patch(
    "/v1/mcp/servers/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.update", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["mcp"],
        params: IdParams,
        body: McpServerRequest.partial().extend({
          status: z.enum(["pending", "disabled"]).optional(),
        }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const b = req.body;
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await loadServer(tx, p, req.params.id);
        const touchesStdio =
          b.transport !== undefined ||
          b.command !== undefined ||
          b.args !== undefined ||
          b.env !== undefined;
        if (touchesStdio && (b.transport ?? cur.transport) === "stdio")
          checkStdio(p, {
            command: b.command !== undefined ? b.command : cur.command,
            args: b.args !== undefined ? b.args : cur.args,
            env: b.env !== undefined ? b.env : cur.env,
          });
        await credentialOf(tx, p, b.credentialId);
        const [u] = await tx
          .update(mcpServers)
          .set({
            ...(b.name ? { name: b.name } : {}),
            ...(b.transport ? { transport: b.transport } : {}),
            ...(b.url !== undefined ? { url: b.url } : {}),
            ...(b.command !== undefined ? { command: b.command } : {}),
            ...(b.args !== undefined ? { args: b.args } : {}),
            ...(b.env !== undefined ? { env: b.env } : {}),
            ...(b.authKind ? { authKind: b.authKind } : {}),
            ...(b.credentialId !== undefined ? { credentialId: b.credentialId } : {}),
            ...(b.status ? { status: b.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(mcpServers.id, req.params.id))
          .returning();
        return u as McpRow;
      });
      return mcpDto(row);
    },
  );

  r.delete(
    "/v1/mcp/servers/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.delete", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadServer(tx, p, req.params.id);
        await tx.delete(mcpServers).where(eq(mcpServers.id, req.params.id));
      });
      return reply.code(204).send(null);
    },
  );

  const TestAnswer = z.object({
    ok: z.boolean(),
    message: z.string().optional(),
    server: z.unknown().optional(),
    toolCount: z.number().int().optional(),
  });

  r.post(
    "/v1/mcp/servers/test",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.test_unsaved", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "try" },
      },
      schema: {
        tags: ["mcp"],
        summary:
          "Test a server configuration before saving it (HTTP from the API, stdio through the worker); nothing is stored",
        body: McpServerRequest.extend({ name: z.string().min(1).max(100).default("unsaved") }),
        response: { 200: TestAnswer },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const b = req.body;
      if (b.transport !== "stdio" && !b.url)
        throw new BadRequestError("url is required for HTTP transports");
      if (b.transport === "stdio") checkStdio(p, b);
      await ctx.db.tenant(p.workspaceId, (tx) => credentialOf(tx, p, b.credentialId));
      req.audit = { resourceId: "unsaved", details: { transport: b.transport } };
      const config: McpServerConfig = {
        id: "unsaved",
        name: b.name,
        transport: b.transport,
        ...(b.url ? { url: b.url } : {}),
        timeoutMs: 30_000,
      };
      return testServer(
        p,
        { transport: b.transport, credentialId: b.credentialId ?? null },
        config,
        {
          config: {
            name: b.name,
            transport: b.transport,
            ...(b.command ? { command: b.command } : {}),
            args: b.args ?? [],
            env: b.env ?? {},
            credentialId: b.credentialId ?? null,
          },
        },
      );
    },
  );

  r.post(
    "/v1/mcp/servers/:id/test",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.test", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "test", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams, response: { 200: TestAnswer } },
    },
    async (req) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadServer(tx, p, req.params.id));
      return testServer(p, s, configOf(s), { serverId: s.id });
    },
  );

  r.post(
    "/v1/mcp/servers/:id/discover",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.discover", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "discover", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadServer(tx, p, req.params.id));
      if (s.transport === "stdio") {
        // the worker stores the tools on the server row (or its error) itself
        const out = await viaWorker(p, "mcp.discover", { serverId: s.id });
        if (out.status === "waiting") throw new TimeoutError(NO_WORKER);
        if (out.status === "failed" || !out.result)
          throw new ToolExecutionError(out.error?.message ?? "discovery failed", true, "mcp");
        const answer = out.result as unknown as McpDiscoveryAnswer;
        req.audit.details = { tools: answer.tools.length, warnings: answer.warnings.length };
        return answer;
      }
      try {
        const session = await sessionFor(s, configOf(s));
        try {
          const d = await discoverSession(session, configOf(s), { timeoutMs: 30_000 });
          await ctx.db.tenant(p.workspaceId, (tx) =>
            tx
              .update(mcpServers)
              .set({
                status: "connected",
                ...d.stored,
                lastError: null,
                lastCheckedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(mcpServers.id, s.id)),
          );
          req.audit.details = {
            tools: d.answer.tools.length,
            warnings: d.answer.warnings.length,
          };
          return d.answer;
        } finally {
          await session.close();
        }
      } catch (error) {
        const message = toFlowaidError(error).message.slice(0, 500);
        await ctx.db.tenant(p.workspaceId, (tx) =>
          tx
            .update(mcpServers)
            .set({ status: "error", lastError: message, lastCheckedAt: new Date() })
            .where(eq(mcpServers.id, s.id)),
        );
        throw error;
      }
    },
  );

  for (const [what, column] of [
    ["tools", "discoveredTools"],
    ["resources", "discoveredResources"],
    ["prompts", "discoveredPrompts"],
  ] as const) {
    r.get(
      `/v1/mcp/servers/:id/${what}`,
      {
        config: {
          auth: "session_or_api_key",
          scope: "mcp:read",
          cli: { noun: "mcp-server", verb: what, positional: ["id"] },
        },
        schema: { tags: ["mcp"], params: IdParams },
      },
      async (req) => {
        const p = need(req.principal);
        const s = await ctx.db.tenant(p.workspaceId, (tx) => loadServer(tx, p, req.params.id));
        return s[column];
      },
    );
  }

  r.patch(
    "/v1/mcp/servers/:id/policy",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.policy", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "policy", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams, body: PolicySchema },
    },
    async (req) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadServer(tx, p, req.params.id);
        const [u] = await tx
          .update(mcpServers)
          .set({ toolPolicy: req.body, updatedAt: new Date() })
          .where(eq(mcpServers.id, req.params.id))
          .returning();
        return u as McpRow;
      });
      req.audit.details = req.body;
      return mcpDto(row);
    },
  );

  r.post(
    "/v1/mcp/servers/:id/tools/:name/call",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_server.tool_call", resource: "mcp_server" },
        cli: { noun: "mcp-server", verb: "call", positional: ["id", "name"] },
      },
      schema: {
        tags: ["mcp"],
        params: z.object({ id: z.uuid(), name: z.string().min(1).max(64) }),
        body: z.object({ args: z.unknown().default({}) }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadServer(tx, p, req.params.id));
      const discovered: readonly (ToolDefinition & { "x-mcp-name"?: string })[] = s.discoveredTools;
      const def = discovered.find((t) => t.name === req.params.name);
      if (!def)
        throw new NotFoundError(`tool ${req.params.name} was not discovered on this server`);
      const original = def["x-mcp-name"] ?? def.name;
      const verdict = evaluatePolicy(s.toolPolicy, original);
      if (!verdict.allowed) throw new ForbiddenError(verdict.reason);
      const started = Date.now();
      const session = await sessionFor(s, configOf(s));
      try {
        const res = await session.callTool(original, req.body.args as JsonValue, {
          timeoutMs: 30_000,
        });
        const content = res.content.map((c) => c.text ?? `[${c.type}]`).join("\n");
        return {
          ok: !res.isError,
          content,
          ...(res.structuredContent ? { structured: res.structuredContent } : {}),
          latencyMs: Date.now() - started,
        };
      } finally {
        await session.close();
      }
    },
  );

  // --- exposures and tokens ---
  r.get(
    "/v1/mcp/exposures",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:read",
        cli: { noun: "mcp-exposure", verb: "list" },
      },
      schema: { tags: ["mcp"], querystring: PageQuery },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select({ e: mcpExposures, deployedVersionId: workflowDeployments.versionId })
          .from(mcpExposures)
          .leftJoin(
            workflowDeployments,
            and(
              eq(workflowDeployments.workflowId, mcpExposures.workflowId),
              eq(workflowDeployments.environmentId, mcpExposures.environmentId),
              eq(workflowDeployments.active, true),
            ),
          )
          .where(
            and(
              eq(mcpExposures.workspaceId, p.workspaceId),
              afterCursor(mcpExposures.toolName, mcpExposures.id, cursor),
            ),
          )
          .orderBy(asc(mcpExposures.toolName), asc(mcpExposures.id))
          .limit(limit + 1),
      );
      const url = `${ctx.config.baseUrl.replace(/\/$/, "")}/mcp/${p.workspaceSlug}`;
      return toPage(
        rows,
        limit,
        (r) => [r.e.toolName, r.e.id],
        (r) => exposureDto(r.e, r.deployedVersionId !== null, url),
      );
    },
  );

  r.patch(
    "/v1/mcp/exposures/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_exposure.update", resource: "mcp_exposure" },
        cli: { noun: "mcp-exposure", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["mcp"],
        summary:
          "Switch an exposure on or off, or change its description; switching makes it manual, so deploys leave the switch alone",
        params: IdParams,
        body: z
          .object({
            enabled: z.boolean().optional(),
            description: z.string().min(1).max(1000).optional(),
          })
          .refine((b) => b.enabled !== undefined || b.description !== undefined, {
            message: "set enabled or description",
          }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const b = req.body;
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [u] = await tx
          .update(mcpExposures)
          .set({
            ...(b.enabled !== undefined ? { enabled: b.enabled, source: "manual" as const } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
          })
          .where(
            and(eq(mcpExposures.id, req.params.id), eq(mcpExposures.workspaceId, p.workspaceId)),
          )
          .returning();
        if (!u) throw new NotFoundError("exposure not found");
        const [d] = await tx
          .select({ id: workflowDeployments.id })
          .from(workflowDeployments)
          .where(
            and(
              eq(workflowDeployments.workflowId, u.workflowId),
              eq(workflowDeployments.environmentId, u.environmentId),
              eq(workflowDeployments.active, true),
            ),
          );
        return { e: u, deployed: Boolean(d) };
      });
      req.audit.details = { ...b };
      return exposureDto(
        row.e,
        row.deployed,
        `${ctx.config.baseUrl.replace(/\/$/, "")}/mcp/${p.workspaceSlug}`,
      );
    },
  );

  r.post(
    "/v1/mcp/exposures",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_exposure.create", resource: "mcp_exposure" },
        cli: { noun: "mcp-exposure", verb: "create" },
      },
      schema: {
        tags: ["mcp"],
        body: z.object({
          workflowId: z.uuid(),
          environmentId: z.uuid(),
          toolName: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          description: z.string().min(1).max(1000),
        }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [w] = await tx
          .select({ id: workflows.id })
          .from(workflows)
          .where(
            and(eq(workflows.id, req.body.workflowId), eq(workflows.workspaceId, p.workspaceId)),
          );
        if (!w) throw new BadRequestError("workflow not found");
        const [env] = await tx
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              eq(environments.id, req.body.environmentId),
              eq(environments.workspaceId, p.workspaceId),
            ),
          );
        if (!env) throw new BadRequestError("environment not found");
        const [dup] = await tx
          .select({ id: mcpExposures.id, enabled: mcpExposures.enabled })
          .from(mcpExposures)
          .where(
            and(
              eq(mcpExposures.workspaceId, p.workspaceId),
              eq(mcpExposures.toolName, req.body.toolName),
            ),
          );
        if (dup?.enabled)
          throw new ConflictError(
            `the tool name ${req.body.toolName} is taken; switch that tool off to reuse its name`,
          );
        // a switched-off exposure doesn't keep its name: this one takes it over
        if (dup) await tx.delete(mcpExposures).where(eq(mcpExposures.id, dup.id));
        const [created] = await tx
          .insert(mcpExposures)
          .values({ id: uuidv7(), workspaceId: p.workspaceId, ...req.body, source: "manual" })
          .returning();
        return created as typeof mcpExposures.$inferSelect;
      });
      req.audit.resourceId = row.id;
      return reply.code(201).send({
        exposure: row,
        url: `${ctx.config.baseUrl.replace(/\/$/, "")}/mcp/${p.workspaceSlug}`,
      });
    },
  );

  r.delete(
    "/v1/mcp/exposures/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "mcp:write",
        audit: { action: "mcp_exposure.delete", resource: "mcp_exposure" },
        cli: { noun: "mcp-exposure", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["mcp"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .delete(mcpExposures)
          .where(
            and(eq(mcpExposures.id, req.params.id), eq(mcpExposures.workspaceId, p.workspaceId)),
          )
          .returning({ id: mcpExposures.id }),
      );
      if (!rows.length) throw new NotFoundError("exposure not found");
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/mcp/tokens",
    {
      config: {
        auth: "session_or_api_key",
        scope: "api_keys:manage",
        audit: { action: "mcp_token.create", resource: "api_key" },
        cli: { noun: "mcp-token", verb: "create" },
      },
      schema: {
        tags: ["mcp"],
        summary: "Mint an MCP token: a service-account key with mcp:serve pinned to workflows",
        body: z.object({
          name: z.string().min(1).max(100),
          workflowIds: z.array(z.uuid()).min(1).max(200),
          environmentId: z.uuid(),
          expiresAt: z.iso.datetime().optional(),
        }),
        response: { 201: ApiKeyCreatedSchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const generated = generateApiKey("live");
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [env] = await tx
          .select({ id: environments.id })
          .from(environments)
          .where(
            and(
              eq(environments.id, req.body.environmentId),
              eq(environments.workspaceId, p.workspaceId),
            ),
          );
        if (!env) throw new BadRequestError("environment not found");
        return createApiKey(tx, {
          workspaceId: p.workspaceId,
          name: `mcp: ${req.body.name}`,
          prefix: generated.prefix,
          keyHash: generated.hash,
          scopes: ["mcp:serve"],
          environmentId: req.body.environmentId,
          workflowIds: req.body.workflowIds,
          isServiceAccount: true,
          rateLimitPerMin: null,
          createdBy: p.userId,
          expiresAt: req.body.expiresAt
            ? new Date(req.body.expiresAt)
            : new Date(ctx.clock.now() + 365 * 24 * 3600 * 1000),
        });
      });
      req.audit = { resourceId: row.id, details: { workflowIds: req.body.workflowIds } };
      return reply.code(201).send({
        id: row.id,
        prefix: row.prefix,
        key: generated.key,
        expiresAt: row.expiresAt.toISOString(),
      });
    },
  );
}
