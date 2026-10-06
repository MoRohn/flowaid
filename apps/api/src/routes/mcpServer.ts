/**
 * `/mcp/:workspaceSlug` (ARCHITECTURE.md §10.2): workflows exposed as MCP tools over stateless
 * Streamable HTTP. Only MCP tokens (service-account keys with `mcp:serve`) are accepted; `tools/list`
 * shows the enabled exposures whose workflow the token is pinned to, with the deployed version's
 * input schema; `tools/call` runs the workflow synchronously (≤ 110 s) and returns structured
 * content, or a `flowaid://runs/<id>` link when the run waits for a person or keeps running;
 * `resources/list` and `resources/read` serve workflow schemas and run status.
 */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  buildExposedTools,
  runOutcomeToCallResult,
  runUri,
  workflowSchemaUri,
  type McpExposure,
} from "@flowaid/mcp";
import {
  PgRunStore,
  mcpExposures,
  workflowDeployments,
  workflowVersions,
  workflows,
} from "@flowaid/database";
import { describeInputIssues, type InputIssue } from "@flowaid/workflow-compiler";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  toFlowaidError,
  type JsonObject,
  type JsonValue,
} from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import type { Principal } from "../auth/principal.js";
import { startRun, waitForRun } from "../services/runs.js";

async function exposuresFor(ctx: ApiContext, p: Principal) {
  return ctx.db.tenant(p.workspaceId, async (tx) => {
    const rows = await tx
      .select({ e: mcpExposures, name: workflows.name, plan: workflowVersions.plan })
      .from(mcpExposures)
      .innerJoin(workflows, eq(workflows.id, mcpExposures.workflowId))
      .leftJoin(
        workflowDeployments,
        and(
          eq(workflowDeployments.workflowId, mcpExposures.workflowId),
          eq(workflowDeployments.environmentId, mcpExposures.environmentId),
          eq(workflowDeployments.active, true),
        ),
      )
      .leftJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
      .where(eq(mcpExposures.workspaceId, p.workspaceId));
    return rows
      .filter((r) => r.plan !== null && (!p.environmentId || r.e.environmentId === p.environmentId))
      .map((r) => ({
        exposure: r.e,
        tool: {
          toolName: r.e.toolName,
          description: r.e.description,
          workflowId: r.e.workflowId,
          workflowName: r.name,
          enabled: r.e.enabled,
          inputSchema: (r.plan?.inputs ?? { type: "object" }) as JsonObject,
          outputSchema: (r.plan?.outputs ?? undefined) as JsonObject | undefined,
        } satisfies McpExposure,
      }));
  });
}

function serverFor(ctx: ApiContext, p: Principal) {
  const server = new Server(
    { name: `flowaid-${p.workspaceSlug}`, version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  const pin = p.workflowIds ? [...p.workflowIds] : null;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list = await exposuresFor(ctx, p);
    return {
      tools: buildExposedTools(
        list.map((x) => x.tool),
        pin,
      ),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const list = await exposuresFor(ctx, p);
    const match = list.find(
      (x) =>
        x.exposure.enabled &&
        x.exposure.toolName === request.params.name &&
        (pin === null || pin.includes(x.exposure.workflowId)),
    );
    if (!match)
      return {
        content: [{ type: "text", text: `unknown tool ${request.params.name}` }],
        isError: true,
      };
    try {
      const started = await startRun(
        ctx,
        { ...p, environmentId: match.exposure.environmentId },
        match.exposure.workflowId,
        {
          input: (request.params.arguments ?? {}) as JsonValue,
          mode: "sync",
          environmentId: match.exposure.environmentId,
          labels: { mcpTool: match.exposure.toolName },
        },
        { origin: "mcp" },
      );
      const outcome = await waitForRun(ctx, p.workspaceId, started.run.id, 110_000);
      const run = outcome.run;
      if (outcome.kind === "terminal" && run.status === "completed")
        return runOutcomeToCallResult({ status: "succeeded", runId: run.id, output: run.output });
      if (outcome.kind === "terminal")
        return runOutcomeToCallResult({
          status: "failed",
          runId: run.id,
          error: {
            code: run.error?.code ?? "RUN_FAILED",
            message: run.error?.message ?? run.status,
          },
        });
      return runOutcomeToCallResult({
        status: outcome.kind === "waiting_for_human" ? "waiting" : "running",
        runId: run.id,
      });
    } catch (error) {
      const e = toFlowaidError(error);
      // arguments that don't fit the tool's input schema name each problem, so the client's
      // model can correct its call ("/message must have required property 'message'")
      const issues = (e.details as { issues?: unknown } | undefined)?.issues;
      const detail =
        Array.isArray(issues) && issues.length
          ? `: ${describeInputIssues(issues as InputIssue[], 5)}`
          : "";
      return {
        content: [{ type: "text", text: `${e.code}: ${e.message}${detail}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const list = await exposuresFor(ctx, p);
    const visible = buildExposedTools(
      list.map((x) => x.tool),
      pin,
    ).map((t) => t.name);
    return {
      resources: list
        .filter((x) => visible.includes(x.exposure.toolName))
        .map((x) => ({
          uri: workflowSchemaUri(x.exposure.workflowId),
          name: `${x.exposure.toolName} schema`,
          mimeType: "application/json",
        })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const wf = /^flowaid:\/\/workflows\/([0-9a-f-]{36})\/schema$/.exec(uri);
    const run = /^flowaid:\/\/runs\/([0-9a-f-]{36})$/.exec(uri);
    if (wf?.[1]) {
      if (pin && !pin.includes(wf[1])) throw new ForbiddenError("not exposed to this token");
      const found = (await exposuresFor(ctx, p)).find((x) => x.exposure.workflowId === wf[1]);
      if (!found) throw new NotFoundError("unknown workflow");
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              inputs: found.tool.inputSchema,
              outputs: found.tool.outputSchema ?? null,
            }),
          },
        ],
      };
    }
    if (run?.[1]) {
      const r = await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).getRun(run[1]);
      if (!r || (pin && !pin.includes(r.workflowId))) throw new NotFoundError("unknown run");
      return {
        contents: [
          {
            uri: runUri(r.id),
            mimeType: "application/json",
            text: JSON.stringify({
              id: r.id,
              status: r.status,
              output: r.output,
              outcome: r.outcome,
              error: r.error,
            }),
          },
        ],
      };
    }
    throw new NotFoundError(`unknown resource ${uri}`);
  });
  return server;
}

export function mcpServerRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.all(
    "/mcp/:workspaceSlug",
    { config: { auth: "api_key", audit: false, rateLimit: false }, schema: { hide: true } },
    async (req, reply) => {
      const p = req.principal;
      if (!p || p.type !== "mcp_token" || !p.scopes.has("mcp:serve"))
        throw new UnauthorizedError("an MCP token is required");
      const slug = (req.params as { workspaceSlug: string }).workspaceSlug;
      if (slug !== p.workspaceSlug) throw new NotFoundError("unknown workspace");
      const server = serverFor(ctx, p);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    },
  );
}
