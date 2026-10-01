/** Versions, diffs, exports, deployments (with trigger materialisation), rollback and secret bindings (API.md §3.3). */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { stringify as toYaml } from "yaml";
import {
  activeDeployment,
  bindSecret,
  credentialUsage,
  credentials,
  deploy,
  environments,
  getVersion,
  listSecretBindings,
  saveDraft,
  unbindSecret,
  workflowVersions,
  workflows,
  type WorkflowVersionRow,
} from "@flowaid/database";
import { generateWorkflowTs } from "@flowaid/codegen";
import { diff } from "@flowaid/workflow-compiler";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  WorkflowValidationError,
  type SecretDecl,
} from "@flowaid/workflow-core";
import {
  assertEnvironmentAllowed,
  canUseEnvironment,
  hasScope,
  type Principal,
} from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, PageQuery, afterCursor, page, toPage } from "../dto/common.js";
import {
  DeployRequestSchema,
  DeployResponseSchema,
  DeploymentSchema,
  WorkflowVersionSchema,
  WorkflowVersionSummarySchema,
} from "../dto/workflows.js";
import { materialiseTriggers } from "../services/triggers.js";
import { deploymentDto, deploymentsOf, visibleWorkflow } from "../services/workflows.js";
import type { Tx } from "@flowaid/database";
import { serverCredentialTypes, unboundRequiredSecrets } from "../services/serverKeys.js";

export function versionDto(v: WorkflowVersionRow, withPlan = false) {
  return {
    id: v.id,
    workflowId: v.workflowId,
    kind: v.kind,
    version: v.version,
    label: v.label,
    definitionHash: v.definitionHash,
    planHash: v.planHash,
    compilerVersion: v.compilerVersion,
    notes: v.notes,
    publishedBy: v.publishedBy,
    createdAt: v.createdAt.toISOString(),
    definition: v.definition,
    diagnostics: v.diagnostics,
    catalogSnapshot: v.catalogSnapshot,
    ...(withPlan ? { plan: v.plan } : {}),
  };
}

async function visibleVersion(tx: Tx, p: Principal, id: string): Promise<WorkflowVersionRow> {
  const v = await getVersion(tx, id);
  if (!v || v.workspaceId !== p.workspaceId) throw new NotFoundError(`version ${id} not found`);
  await visibleWorkflow(tx, p, v.workflowId);
  return v;
}

/**
 * Required secrets that block a deploy: not bound in the environment and not answered by a key
 * the server has for their credential type (a run falls back to that key).
 */
export async function missingSecrets(
  tx: Tx,
  workflowId: string,
  environmentId: string,
  declared: readonly SecretDecl[],
  served: ReadonlySet<string>,
): Promise<string[]> {
  const bound = new Set(
    (await listSecretBindings(tx, workflowId))
      .filter((b) => b.environmentId === environmentId)
      .map((b) => b.secretName),
  );
  return unboundRequiredSecrets(declared, bound, served).map((s) => s.name);
}

export function versionRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };

  r.get(
    "/v1/workflows/:id/versions",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "version", verb: "list", positional: ["id"] },
      },
      schema: {
        tags: ["versions"],
        params: IdParams,
        querystring: PageQuery,
        response: { 200: page(WorkflowVersionSummarySchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await visibleWorkflow(tx, p, req.params.id);
        // Published versions, newest first.
        const rows = await tx
          .select()
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.workflowId, req.params.id),
              eq(workflowVersions.kind, "published"),
              afterCursor(workflowVersions.version, workflowVersions.id, cursor, "desc", Number),
            ),
          )
          .orderBy(desc(workflowVersions.version), desc(workflowVersions.id))
          .limit(limit + 1);
        return toPage(
          rows,
          limit,
          (v) => [v.version ?? 0, v.id],
          (v) => {
            const {
              definition: _d,
              diagnostics: _g,
              catalogSnapshot: _c,
              ...summary
            } = versionDto(v);
            return summary;
          },
        );
      });
    },
  );

  r.get(
    "/v1/workflow-versions/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "version", verb: "get", positional: ["id"] },
      },
      schema: {
        tags: ["versions"],
        params: IdParams,
        querystring: z.object({ include: z.enum(["plan"]).optional() }),
        response: { 200: WorkflowVersionSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const v = await ctx.db.tenant(p.workspaceId, (tx) => visibleVersion(tx, p, req.params.id));
      return versionDto(v, req.query.include === "plan");
    },
  );

  r.get(
    "/v1/workflow-versions/:id/diff/:otherId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "version", verb: "diff", positional: ["id", "otherId"] },
      },
      schema: { tags: ["versions"], params: z.object({ id: z.uuid(), otherId: z.uuid() }) },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const a = await visibleVersion(tx, p, req.params.otherId);
        const b = await visibleVersion(tx, p, req.params.id);
        return diff(a.definition, b.definition);
      });
    },
  );

  r.get(
    "/v1/workflow-versions/:id/export",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "version", verb: "export", positional: ["id"] },
      },
      schema: {
        tags: ["versions"],
        params: IdParams,
        querystring: z.object({ format: z.enum(["json", "yaml", "ts"]).default("json") }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const v = await ctx.db.tenant(p.workspaceId, (tx) => visibleVersion(tx, p, req.params.id));
      void reply.header(
        "content-disposition",
        `attachment; filename="workflow-v${v.version ?? "draft"}.${req.query.format}"`,
      );
      if (req.query.format === "ts")
        return reply
          .type("text/plain; charset=utf-8")
          .send(await generateWorkflowTs(v.definition, { title: `v${v.version ?? "draft"}` }));
      if (req.query.format === "yaml")
        return reply.type("application/yaml").send(toYaml(v.definition));
      return reply.type("application/json").send(`${JSON.stringify(v.definition, null, 2)}\n`);
    },
  );

  r.post(
    "/v1/workflow-versions/:id/restore-draft",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.draft_restored", resource: "workflow_version" },
        cli: { noun: "version", verb: "restore", positional: ["id"] },
      },
      schema: {
        tags: ["versions"],
        params: IdParams,
        response: { 200: z.object({ draftRevision: z.number() }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const revision = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const v = await visibleVersion(tx, p, req.params.id);
        const [w] = await tx.select().from(workflows).where(eq(workflows.id, v.workflowId));
        if (!w) throw new NotFoundError("workflow not found");
        return saveDraft(tx, w.id, w.draftRevision, v.definition, v.diagnostics);
      });
      return { draftRevision: revision };
    },
  );

  r.get(
    "/v1/workflows/:id/deployments",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "deployment", verb: "list", positional: ["id"] },
      },
      schema: {
        tags: ["deployments"],
        params: IdParams,
        response: { 200: z.array(DeploymentSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await visibleWorkflow(tx, p, req.params.id);
        return (await deploymentsOf(tx, req.params.id))
          .filter((d) => canUseEnvironment(p, d.environmentId))
          .map(deploymentDto);
      });
    },
  );

  const deployParams = z.object({ id: z.uuid(), environmentId: z.uuid() });
  const doDeploy = async (
    tx: Tx,
    p: Principal,
    workflowId: string,
    environmentId: string,
    versionId: string,
    overrides?: Record<string, unknown>,
  ) => {
    assertEnvironmentAllowed(p, environmentId);
    const w = await visibleWorkflow(tx, p, workflowId);
    const [env] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.id, environmentId), eq(environments.workspaceId, p.workspaceId)));
    if (!env) throw new NotFoundError("environment not found");
    if (env.protected && !hasScope(p, "admin"))
      throw new ForbiddenError(`deploying to ${env.name} requires admin`);
    const v = await getVersion(tx, versionId);
    if (!v || v.workflowId !== w.id || v.kind !== "published")
      throw new BadRequestError("versionId is not a published version of this workflow");
    const missing = await missingSecrets(
      tx,
      w.id,
      environmentId,
      v.definition.secrets,
      serverCredentialTypes(ctx.env),
    );
    if (missing.length > 0)
      throw new WorkflowValidationError(
        missing.map((name) => ({
          code: "E_SECRET_UNBOUND" as const,
          severity: "error" as const,
          message: `secret ${name} is not bound in ${env.name}`,
          location: { path: "/secrets" },
        })),
      );
    const d = await deploy(tx, {
      workflowId: w.id,
      environmentId,
      versionId,
      ...(overrides ? { variableOverrides: overrides as never } : {}),
      deployedBy: p.userId,
    });
    const triggers = await materialiseTriggers(tx, {
      workspaceId: p.workspaceId,
      workspaceSlug: p.workspaceSlug,
      workflowId: w.id,
      environmentId,
      triggers: v.definition.triggers,
      baseUrl: ctx.config.baseUrl,
      now: new Date(ctx.clock.now()),
    });
    return { ...deploymentDto({ ...d, environment: env.name, version: v.version }), triggers };
  };

  r.put(
    "/v1/workflows/:id/deployments/:environmentId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:publish",
        audit: { action: "workflow.deploy", resource: "workflow" },
        cli: { noun: "deployment", verb: "deploy", positional: ["id", "environmentId"] },
      },
      schema: {
        tags: ["deployments"],
        summary: "Deploy a version to an environment and materialise its triggers",
        params: deployParams,
        body: DeployRequestSchema,
        response: { 200: DeployResponseSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const out = await ctx.db.tenant(p.workspaceId, (tx) =>
        doDeploy(
          tx,
          p,
          req.params.id,
          req.params.environmentId,
          req.body.versionId,
          req.body.variableOverrides,
        ),
      );
      req.audit.details = {
        environmentId: req.params.environmentId,
        versionId: req.body.versionId,
      };
      return out;
    },
  );

  r.post(
    "/v1/workflows/:id/deployments/:environmentId/rollback",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:publish",
        audit: { action: "workflow.rollback", resource: "workflow" },
        cli: { noun: "deployment", verb: "rollback", positional: ["id", "environmentId"] },
      },
      schema: {
        tags: ["deployments"],
        params: deployParams,
        body: z.object({ toVersionId: z.uuid().optional() }).default({}),
        response: { 200: DeployResponseSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      assertEnvironmentAllowed(p, req.params.environmentId);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        if (req.body.toVersionId)
          return doDeploy(tx, p, req.params.id, req.params.environmentId, req.body.toVersionId);
        await visibleWorkflow(tx, p, req.params.id);
        const current = await activeDeployment(tx, req.params.id, req.params.environmentId);
        if (!current?.previousVersionId)
          throw new ConflictError("there is no previous deployment to roll back to");
        return doDeploy(
          tx,
          p,
          req.params.id,
          req.params.environmentId,
          current.previousVersionId,
          current.variableOverrides,
        );
      });
    },
  );

  const SecretMap = z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.uuid());
  r.get(
    "/v1/workflows/:id/secrets/:environmentId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "secrets:bind",
        cli: { noun: "secret", verb: "list", positional: ["id", "environmentId"] },
      },
      schema: { tags: ["secrets"], params: deployParams, response: { 200: SecretMap } },
    },
    async (req) => {
      const p = need(req.principal);
      assertEnvironmentAllowed(p, req.params.environmentId);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await visibleWorkflow(tx, p, req.params.id);
        const rows = (await listSecretBindings(tx, req.params.id)).filter(
          (b) => b.environmentId === req.params.environmentId,
        );
        return Object.fromEntries(rows.map((b) => [b.secretName, b.credentialId]));
      });
    },
  );

  r.put(
    "/v1/workflows/:id/secrets/:environmentId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "secrets:bind",
        audit: { action: "secrets.bind", resource: "workflow" },
        cli: { noun: "secret", verb: "bind", positional: ["id", "environmentId"] },
      },
      schema: {
        tags: ["secrets"],
        summary: "Replace the secret → credential bindings of an environment",
        params: deployParams,
        body: SecretMap,
        response: { 200: SecretMap },
      },
    },
    async (req) => {
      const p = need(req.principal);
      assertEnvironmentAllowed(p, req.params.environmentId);
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const [env] = await tx
          .select()
          .from(environments)
          .where(
            and(
              eq(environments.id, req.params.environmentId),
              eq(environments.workspaceId, p.workspaceId),
            ),
          );
        if (!env) throw new NotFoundError("environment not found");
        const declared = new Map(w.draft.secrets.map((s) => [s.name, s]));
        for (const [name, credentialId] of Object.entries(req.body)) {
          const decl = declared.get(name);
          if (!decl) throw new BadRequestError(`the workflow declares no secret ${name}`);
          const [cred] = await tx
            .select()
            .from(credentials)
            .where(
              and(eq(credentials.id, credentialId), eq(credentials.workspaceId, p.workspaceId)),
            );
          if (!cred) throw new BadRequestError(`credential ${credentialId} not found`);
          if (cred.type !== decl.credentialType)
            throw new BadRequestError(
              `${name} needs a ${decl.credentialType} credential, not ${cred.type}`,
            );
          if (cred.environmentId && cred.environmentId !== env.id)
            throw new BadRequestError(`credential ${cred.name} is pinned to another environment`);
          if (cred.allowedWorkflowIds && !cred.allowedWorkflowIds.includes(w.id))
            throw new BadRequestError(`credential ${cred.name} is not allowed for this workflow`);
        }
        const current = (await listSecretBindings(tx, w.id)).filter(
          (b) => b.environmentId === env.id,
        );
        for (const b of current)
          if (!(b.secretName in req.body)) await unbindSecret(tx, w.id, env.id, b.secretName);
        for (const [name, credentialId] of Object.entries(req.body))
          await bindSecret(tx, {
            workspaceId: p.workspaceId,
            workflowId: w.id,
            environmentId: env.id,
            secretName: name,
            credentialId,
          });
      });
      req.audit.details = {
        environmentId: req.params.environmentId,
        secrets: Object.keys(req.body),
      };
      return req.body;
    },
  );

  r.get(
    "/v1/secrets/where-used",
    {
      config: {
        auth: "session_or_api_key",
        scope: "credentials:read",
        cli: { noun: "secret", verb: "where-used" },
      },
      schema: {
        tags: ["secrets"],
        querystring: z.object({ credentialId: z.uuid() }),
        response: {
          200: z.array(
            z.object({ workflowId: z.string(), environmentId: z.string(), secretName: z.string() }),
          ),
        },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        credentialUsage(tx, req.query.credentialId),
      );
      return rows
        .filter((r) => r.workspaceId === p.workspaceId && canUseEnvironment(p, r.environmentId))
        .map((r) => ({
          workflowId: r.workflowId,
          environmentId: r.environmentId,
          secretName: r.secretName,
        }));
    },
  );
}
