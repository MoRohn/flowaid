/** Catalog: node manifests, tool signatures, subflow signatures, providers and models (API.md §3.2). */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { BUILTIN_AGENT_TOOLS, coreManifests } from "@flowaid/nodes-core/manifest";
import { DefaultModelCatalog } from "@flowaid/providers";
import {
  environments,
  mcpServers,
  tools,
  workflowDeployments,
  workflowVersions,
} from "@flowaid/database";
import { ForbiddenError, NotFoundError, type ToolDefinition } from "@flowaid/workflow-core";
import { assertEnvironmentAllowed } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { NoContent } from "../dto/common.js";
import {
  ModelDtoSchema,
  NodeManifestDtoSchema,
  ProviderDtoSchema,
  ToolDefinitionDtoSchema,
  WorkflowSignatureSchema,
} from "../dto/catalog.js";
import { visibleWorkflow } from "../services/workflows.js";
import { loadEnabledPlugins } from "../services/plugins.js";
import { serverProviders } from "../services/serverKeys.js";

const CORE_HASH = createHash("sha256").update(JSON.stringify(coreManifests)).digest("base64url");

/** Core plus enabled plugin manifests, and an ETag that changes when either does. */
async function catalogFor(ctx: ApiContext, workspaceId: string | null) {
  const extra = await loadEnabledPlugins(ctx.db, workspaceId);
  const etag = `"${createHash("sha256")
    .update(CORE_HASH)
    .update(JSON.stringify(extra.packages))
    .digest("base64url")
    .slice(0, 20)}"`;
  return { manifests: [...coreManifests, ...extra.manifests], etag };
}

export function catalogRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const models = new DefaultModelCatalog();

  r.get(
    "/v1/nodes",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "node", verb: "list" },
      },
      schema: {
        tags: ["catalog"],
        summary: "Node manifests (core, bundled and enabled plugins)",
        response: { 200: z.array(NodeManifestDtoSchema), 304: NoContent },
      },
    },
    async (req, reply) => {
      const { manifests, etag } = await catalogFor(ctx, req.principal?.workspaceId ?? null);
      void reply.header("etag", etag).header("cache-control", "private, max-age=60");
      if (req.headers["if-none-match"] === etag) return reply.code(304).send(null);
      return manifests;
    },
  );

  r.get(
    "/v1/nodes/:typeId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "node", verb: "get", positional: ["typeId"] },
      },
      schema: {
        tags: ["catalog"],
        params: z.object({ typeId: z.string().min(1).max(200) }),
        querystring: z.object({ version: z.string().optional() }),
        response: { 200: NodeManifestDtoSchema },
      },
    },
    async (req) => {
      const id = decodeURIComponent(req.params.typeId);
      const { manifests } = await catalogFor(ctx, req.principal?.workspaceId ?? null);
      const m = manifests
        .filter((x) => x.id === id && (!req.query.version || x.version === req.query.version))
        .sort((a, b) => (a.version < b.version ? 1 : -1))[0];
      if (!m) throw new NotFoundError(`node type ${id} not found`);
      return m;
    },
  );

  r.get(
    "/v1/tools/catalog",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "tool", verb: "catalog" },
      },
      schema: {
        tags: ["catalog"],
        summary:
          "Tools agents can call: built in (calculator, current time, web pages), MCP, OpenAPI, workflows",
        response: { 200: z.array(ToolDefinitionDtoSchema) },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        // the built-in tools need nothing connected, so every workspace has them
        const out: ToolDefinition[] = [...BUILTIN_AGENT_TOOLS];
        for (const s of await tx
          .select()
          .from(mcpServers)
          .where(eq(mcpServers.workspaceId, p.workspaceId)))
          if (s.status !== "disabled") out.push(...s.discoveredTools);
        for (const t of await tx.select().from(tools).where(eq(tools.workspaceId, p.workspaceId)))
          out.push(...t.definitions);
        return out;
      });
    },
  );

  r.get(
    "/v1/workflows/:id/signature",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "workflow", verb: "signature", positional: ["id"] },
      },
      schema: {
        tags: ["catalog"],
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          environmentId: z.uuid().optional(),
          versionId: z.uuid().optional(),
        }),
        response: { 200: WorkflowSignatureSchema },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await visibleWorkflow(tx, p, req.params.id);
        let versionId = req.query.versionId ?? null;
        if (req.query.environmentId) assertEnvironmentAllowed(p, req.query.environmentId);
        if (!versionId) {
          const envId =
            req.query.environmentId ??
            p.environmentId ??
            (
              await tx
                .select()
                .from(environments)
                .where(
                  and(
                    eq(environments.workspaceId, p.workspaceId),
                    eq(environments.protected, true),
                  ),
                )
            )[0]?.id;
          const [d] = envId
            ? await tx
                .select()
                .from(workflowDeployments)
                .where(
                  and(
                    eq(workflowDeployments.workflowId, req.params.id),
                    eq(workflowDeployments.environmentId, envId),
                    eq(workflowDeployments.active, true),
                  ),
                )
            : [];
          versionId = d?.versionId ?? null;
        }
        if (!versionId) throw new NotFoundError("the workflow has no deployed version there");
        const [v] = await tx
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, versionId));
        if (!v || v.workflowId !== req.params.id) throw new NotFoundError("version not found");
        return {
          versionId: v.id,
          inputs: v.plan.inputs,
          outputs: v.plan.outputs,
          references: [...new Set(v.plan.subflows.map((s) => s.workflowId))],
        };
      });
    },
  );

  r.get(
    "/v1/models",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "model", verb: "list" },
      },
      schema: {
        tags: ["catalog"],
        querystring: z.object({
          provider: z.string().optional(),
          kind: z.enum(["decision", "chat", "embedding", "rerank"]).optional(),
        }),
        response: { 200: z.array(ModelDtoSchema) },
      },
    },
    (req) =>
      models.list({
        ...(req.query.provider ? { provider: req.query.provider } : {}),
        ...(req.query.kind ? { kind: req.query.kind } : {}),
      }),
  );

  r.get(
    "/v1/providers",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "provider", verb: "list" },
      },
      schema: {
        tags: ["catalog"],
        summary: "Providers with their credential types and whether the server has them configured",
        response: { 200: z.array(ProviderDtoSchema) },
      },
    },
    () => {
      const byProvider = new Map<string, number>();
      for (const m of models.list())
        byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + 1);
      const configured = serverProviders(ctx.env);
      return [...byProvider].map(([id, modelCount]) => ({
        id,
        models: modelCount,
        configuredOnServer: configured[id] ?? false,
      }));
    },
  );
}
