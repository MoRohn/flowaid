/** Workflows, drafts, compile/validate, publish, clone, import/export, templates (API.md §3.3, §3.9). */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { generateWorkflowTs } from "@flowaid/codegen";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { ExternalFlowError, importExternalFlow, type ImportReport } from "@flowaid/importer";
import {
  createWorkflow,
  deploy,
  environments,
  evaluationRuns,
  getVersion,
  publishVersion,
  saveDraft,
  templates,
  workflowDeployments,
  workflowVersions,
  workflows,
  type WorkflowRow,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  FlowaidError,
  ForbiddenError,
  NotFoundError,
  WorkflowDefinitionSchema,
  WorkflowValidationError,
  definitionHash,
  type Diagnostic,
  type JsonObject,
} from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import { assertEnvironmentAllowed, hasScope } from "../auth/principal.js";
import { IdParams, ListQuery, NoContent, decodeCursor, encodeCursor, page } from "../dto/common.js";
import {
  CompileResponseSchema,
  CreateWorkflowRequestSchema,
  DraftResponseSchema,
  PatchWorkflowRequestSchema,
  PublishRequestSchema,
  ValidateRequestSchema,
  ValidateResponseSchema,
  WorkflowSchema,
  WorkflowSummarySchema,
  WorkflowVersionSchema,
} from "../dto/workflows.js";
import { catalogSnapshot, compileIn } from "../services/compile.js";
import { materialiseTriggers } from "../services/triggers.js";
import {
  blankDefinition,
  deploymentDto,
  deploymentsOf,
  instantiateTemplate,
  slugify,
  uniqueSlug,
  visibleWorkflow,
} from "../services/workflows.js";
import { serverCredentialTypes } from "../services/serverKeys.js";
import { missingSecrets, versionDto } from "./versions.js";

const counts = (d: Diagnostic[]) => ({
  errors: d.filter((x) => x.severity === "error").length,
  warnings: d.filter((x) => x.severity === "warning").length,
});

export function summaryDto(w: WorkflowRow, latestVersion: number | null) {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    description: w.description,
    tags: w.tags,
    draftRevision: w.draftRevision,
    latestVersionId: w.latestVersionId,
    latestVersion,
    archived: w.archivedAt !== null,
    ...counts(w.draftDiagnostics),
    updatedAt: w.updatedAt.toISOString(),
  };
}

/** Only E_SCHEMA (the document is not a workflow definition) blocks saving a draft. */
function assertSaveable(diagnostics: Diagnostic[]): void {
  const schema = diagnostics.filter((d) => d.code === "E_SCHEMA" && d.severity === "error");
  if (schema.length > 0) throw new WorkflowValidationError(schema);
}

/** Keeps the definition's `id` equal to the workflow's. */
export function withId(definition: unknown, id: string, name?: string): unknown {
  if (typeof definition !== "object" || definition === null || Array.isArray(definition))
    return definition;
  return {
    ...(definition as JsonObject),
    id,
    ...(name && !(definition as JsonObject).name ? { name } : {}),
  };
}

const EMPTY_ACTIVITY = {
  deployments: [],
  runs24h: Array.from({ length: 24 }, () => 0),
  lastRun: null,
};

/**
 * `include=activity` on the list: deployed version per environment, runs per hour over the last 24
 * hours (oldest first) and the latest run, for one page of workflows in two queries.
 */
async function workflowActivity(ctx: ApiContext, workspaceId: string, ids: string[]) {
  const out = new Map<
    string,
    {
      deployments: { environmentId: string; version: number | null }[];
      runs24h: number[];
      lastRun: { id: string; status: string; createdAt: string } | null;
    }
  >();
  if (ids.length === 0) return out;
  const now = ctx.clock.now();
  const since = new Date(now - 24 * 3600_000).toISOString();
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const [deps, hours, latest] = await ctx.db.tenant(workspaceId, (tx) =>
    Promise.all([
      tx
        .select({
          workflowId: workflowDeployments.workflowId,
          environmentId: workflowDeployments.environmentId,
          version: workflowVersions.version,
        })
        .from(workflowDeployments)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
        .where(
          and(
            eq(workflowDeployments.workspaceId, workspaceId),
            eq(workflowDeployments.active, true),
            inArray(workflowDeployments.workflowId, ids),
          ),
        ),
      tx.execute<{ workflow_id: string; bucket: number; n: number }>(sql`
        select workflow_id, floor(extract(epoch from (created_at - ${since}::timestamptz)) / 3600)::int as bucket, count(*)::int as n
        from runs
        where workspace_id = ${workspaceId} and workflow_id in (${idList}) and created_at >= ${since}::timestamptz
        group by 1, 2`),
      tx.execute<{
        workflow_id: string;
        id: string;
        status: string;
        created_at: Date | string;
      }>(sql`
        select distinct on (workflow_id) workflow_id, id, status, created_at
        from runs
        where workspace_id = ${workspaceId} and workflow_id in (${idList})
        order by workflow_id, created_at desc`),
    ]),
  );
  for (const id of ids)
    out.set(id, {
      deployments: [],
      runs24h: Array.from({ length: 24 }, () => 0),
      lastRun: null,
    });
  for (const d of deps)
    out.get(d.workflowId)?.deployments.push({ environmentId: d.environmentId, version: d.version });
  for (const h of hours) {
    const a = out.get(h.workflow_id);
    // runs newer than the reference clock count toward the current hour
    if (a && h.bucket >= 0)
      a.runs24h[Math.min(h.bucket, 23)] = (a.runs24h[Math.min(h.bucket, 23)] ?? 0) + h.n;
  }
  for (const r of latest) {
    const a = out.get(r.workflow_id);
    if (a)
      a.lastRun = {
        id: r.id,
        status: r.status,
        createdAt: new Date(r.created_at).toISOString(),
      };
  }
  return out;
}

const ImportBody = z.object({
  definition: z.unknown().optional(),
  yaml: z
    .string()
    .max(2 * 1024 * 1024)
    .optional(),
  /** an external flow export (agent flow or LangChain chat flow), translated by the FlowAId importer */
  external: z.unknown().optional(),
  name: z.string().min(1).max(200).optional(),
});

const ImportReportSchema = z.object({
  format: z.enum(["agentflow", "chatflow"]),
  workflowName: z.string(),
  counts: z.object({
    imported: z.number(),
    converted: z.number(),
    needsConfig: z.number(),
    unsupported: z.number(),
  }),
  nodes: z.array(
    z.object({
      sourceId: z.string(),
      sourceType: z.string(),
      name: z.string(),
      nodeId: z.string().optional(),
      targetType: z.string().optional(),
      status: z.enum(["imported", "converted", "needs_config", "unsupported"]),
      message: z.string().optional(),
    }),
  ),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["error", "warning"]),
      message: z.string(),
      nodeId: z.string().optional(),
      sourceId: z.string().optional(),
    }),
  ),
  secrets: z.array(z.string()),
});

/** The definition an import request carries (and the importer's report for external exports). */
function readImport(
  body: { definition?: unknown; yaml?: string; external?: unknown; name?: string },
  id: string,
): { definition: unknown; report?: ImportReport } {
  if (body.external !== undefined) {
    try {
      const out = importExternalFlow(body.external, {
        id,
        ...(body.name ? { name: body.name } : {}),
      });
      return { definition: out.definition, report: out.report };
    } catch (error) {
      if (error instanceof ExternalFlowError || error instanceof SyntaxError)
        throw new BadRequestError(`the flow export could not be read: ${error.message}`);
      throw error;
    }
  }
  if (body.yaml !== undefined) {
    try {
      return {
        definition: parseYaml(body.yaml, {
          schema: "core",
          merge: false,
          maxAliasCount: 100,
        }) as unknown,
      };
    } catch (error) {
      throw new BadRequestError(
        `the YAML does not parse: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (body.definition === undefined)
    throw new BadRequestError("send `definition`, `yaml` or `external`");
  return { definition: body.definition };
}

export function workflowRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/v1/workflows",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "workflow", verb: "list" },
      },
      schema: {
        tags: ["workflows"],
        querystring: ListQuery.extend({
          q: z.string().max(200).optional(),
          tag: z.string().max(40).optional(),
          archived: z.coerce.boolean().default(false),
          include: z.enum(["activity"]).optional(),
        }),
        response: { 200: page(WorkflowSummarySchema) },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const { limit, q, tag, archived } = req.query;
      const cursor = decodeCursor(req.query.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select({ w: workflows, latest: workflowVersions.version })
          .from(workflows)
          .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.latestVersionId))
          .where(
            and(
              eq(workflows.workspaceId, p.workspaceId),
              archived ? undefined : isNull(workflows.archivedAt),
              q
                ? sql`(${workflows.name} ilike ${`%${q}%`} or ${workflows.slug} ilike ${`%${q}%`})`
                : undefined,
              tag ? sql`${workflows.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined,
              p.workflowIds
                ? p.workflowIds.size > 0
                  ? inArray(workflows.id, [...p.workflowIds])
                  : sql`false`
                : undefined,
              cursor
                ? or(
                    lt(workflows.updatedAt, new Date(String(cursor[0]))),
                    and(
                      eq(workflows.updatedAt, new Date(String(cursor[0]))),
                      lt(workflows.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(workflows.updatedAt), desc(workflows.id))
          .limit(limit + 1),
      );
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const activity =
        req.query.include === "activity"
          ? await workflowActivity(
              ctx,
              p.workspaceId,
              items.map((x) => x.w.id),
            )
          : null;
      return {
        items: items.map((x) => ({
          ...summaryDto(x.w, x.latest),
          ...(activity ? (activity.get(x.w.id) ?? EMPTY_ACTIVITY) : {}),
        })),
        next_cursor:
          rows.length > limit && last
            ? encodeCursor(last.w.updatedAt.toISOString(), last.w.id)
            : null,
      };
    },
  );

  r.post(
    "/v1/workflows",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.create", resource: "workflow" },
        cli: { noun: "workflow", verb: "create" },
      },
      schema: {
        tags: ["workflows"],
        summary: "Create a workflow from a definition, a template or blank",
        body: CreateWorkflowRequestSchema,
        response: { 201: WorkflowSchema },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const id = uuidv7();
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        let definition: unknown;
        if (req.body.templateId) {
          const [t] = await tx
            .select()
            .from(templates)
            .where(
              and(
                or(
                  eq(templates.slug, req.body.templateId),
                  sql`${templates.id}::text = ${req.body.templateId}`,
                ),
                or(isNull(templates.workspaceId), eq(templates.workspaceId, p.workspaceId)),
              ),
            );
          if (!t) throw new NotFoundError(`template ${req.body.templateId} not found`);
          definition = instantiateTemplate(t.definition, req.body.resources ?? {});
        } else definition = req.body.definition ?? blankDefinition(id, req.body.name);
        definition = withId(definition, id, req.body.name);
        const compiled = await compileIn(tx, definition, {
          workspaceId: p.workspaceId,
          level: "draft",
        });
        assertSaveable(compiled.diagnostics);
        const slug = await uniqueSlug(tx, p.workspaceId, req.body.slug ?? slugify(req.body.name));
        const draft = WorkflowDefinitionSchema.parse(definition);
        // a template's own description becomes the workflow's unless one is given
        const description = req.body.description ?? draft.description;
        const created = await createWorkflow(tx, {
          workspaceId: p.workspaceId,
          name: req.body.name,
          slug,
          draft,
          ...(description !== undefined ? { description } : {}),
          ...(req.body.tags ? { tags: req.body.tags } : {}),
          createdBy: p.userId,
        });
        const [withIdRow] = await tx
          .update(workflows)
          .set({ id, draftDiagnostics: compiled.diagnostics })
          .where(eq(workflows.id, created.id))
          .returning();
        return withIdRow as WorkflowRow;
      });
      req.audit = { resourceId: row.id, details: { templateId: req.body.templateId ?? null } };
      return reply.code(201).send({
        ...summaryDto(row, null),
        draft: row.draft,
        draftDiagnostics: row.draftDiagnostics,
        evaluationSetId: row.evaluationSetId,
        deployments: [],
        createdAt: row.createdAt.toISOString(),
      });
    },
  );

  r.get(
    "/v1/workflows/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "workflow", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["workflows"], params: IdParams, response: { 200: WorkflowSchema } },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const latest = w.latestVersionId ? await getVersion(tx, w.latestVersionId) : null;
        const deployments = await deploymentsOf(tx, w.id);
        return {
          ...summaryDto(w, latest?.version ?? null),
          draft: w.draft,
          draftDiagnostics: w.draftDiagnostics,
          evaluationSetId: w.evaluationSetId,
          deployments: deployments.map(deploymentDto),
          createdAt: w.createdAt.toISOString(),
        };
      });
    },
  );

  r.patch(
    "/v1/workflows/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.update", resource: "workflow" },
        cli: { noun: "workflow", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        params: IdParams,
        body: PatchWorkflowRequestSchema,
        response: { 200: WorkflowSummarySchema },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        if (req.body.slug && req.body.slug !== w.slug) {
          const [dup] = await tx
            .select()
            .from(workflows)
            .where(
              and(eq(workflows.workspaceId, p.workspaceId), eq(workflows.slug, req.body.slug)),
            );
          if (dup) throw new ConflictError(`the slug '${req.body.slug}' is taken`);
        }
        const [u] = await tx
          .update(workflows)
          .set({
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.slug ? { slug: req.body.slug } : {}),
            ...(req.body.description !== undefined ? { description: req.body.description } : {}),
            ...(req.body.tags ? { tags: req.body.tags } : {}),
            ...(req.body.evaluationSetId !== undefined
              ? { evaluationSetId: req.body.evaluationSetId }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(workflows.id, w.id))
          .returning();
        return u as WorkflowRow;
      });
      req.audit.details = { fields: Object.keys(req.body) };
      return summaryDto(row, null);
    },
  );

  r.delete(
    "/v1/workflows/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:delete",
        audit: { action: "workflow.delete", resource: "workflow" },
        cli: { noun: "workflow", verb: "delete", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "Archive (or purge with ?purge=true)",
        params: IdParams,
        querystring: z.object({ purge: z.coerce.boolean().default(false) }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        if (req.query.purge) await tx.delete(workflows).where(eq(workflows.id, w.id));
        else
          await tx.update(workflows).set({ archivedAt: new Date() }).where(eq(workflows.id, w.id));
      });
      req.audit.details = { purge: req.query.purge };
      return reply.code(204).send(null);
    },
  );

  r.put(
    "/v1/workflows/:id/draft",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.draft_saved", resource: "workflow" },
        cli: { noun: "workflow", verb: "save-draft", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary:
          "Save the draft (If-Match: <draftRevision>); diagnostics are stored, only E_SCHEMA rejects",
        params: IdParams,
        headers: z.object({ "if-match": z.string().regex(/^"?\d+"?$/) }).loose(),
        body: z.object({ definition: z.unknown() }),
        response: { 200: DraftResponseSchema },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const expected = Number(req.headers["if-match"].replace(/"/g, ""));
      const out = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const definition = withId(req.body.definition, w.id);
        const compiled = await compileIn(tx, definition, {
          workspaceId: p.workspaceId,
          level: "draft",
        });
        assertSaveable(compiled.diagnostics);
        try {
          const revision = await saveDraft(
            tx,
            w.id,
            expected,
            WorkflowDefinitionSchema.parse(definition),
            compiled.diagnostics,
          );
          return { draftRevision: revision, diagnostics: compiled.diagnostics };
        } catch (error) {
          if (error instanceof ConflictError)
            throw new PreconditionFailed(error.message, error.toInfo({}).details ?? {});
          throw error;
        }
      });
      req.audit.details = { revision: out.draftRevision, errors: counts(out.diagnostics).errors };
      return out;
    },
  );

  for (const [path, verb, includePlan] of [
    ["/v1/workflows/:id/validate", "validate", false],
    ["/v1/workflows/:id/compile", "compile", true],
  ] as const) {
    r.post(
      path,
      {
        config: {
          auth: "session_or_api_key",
          scope: "workflows:read",
          audit: false,
          cli: { noun: "workflow", verb, positional: ["id"] },
        },
        schema: {
          tags: ["workflows"],
          params: IdParams,
          body: ValidateRequestSchema,
          response: { 200: includePlan ? CompileResponseSchema : ValidateResponseSchema },
        },
      },
      async (req) => {
        const p = req.principal;
        if (!p) throw new ForbiddenError("no principal");
        return ctx.db.tenant(p.workspaceId, async (tx) => {
          const w = await visibleWorkflow(tx, p, req.params.id);
          const definition = withId(req.body.definition ?? w.draft, w.id);
          const result = await compileIn(tx, definition, {
            workspaceId: p.workspaceId,
            environmentId: req.body.environmentId ?? null,
            level: req.body.level,
            serverCredentialTypes: serverCredentialTypes(ctx.env),
          });
          return {
            ok: result.ok,
            diagnostics: result.diagnostics,
            planHash: result.ok ? result.plan.planHash : null,
            ...(includePlan && result.ok ? { plan: result.plan } : {}),
          };
        });
      },
    );
  }

  r.post(
    "/v1/workflows/:id/publish",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:publish",
        audit: { action: "workflow.publish", resource: "workflow" },
        cli: { noun: "workflow", verb: "publish", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "Compile the draft strictly and publish it as the next version",
        params: IdParams,
        body: PublishRequestSchema.default({}),
        response: { 201: WorkflowVersionSchema },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      for (const envId of req.body.deployTo ?? []) assertEnvironmentAllowed(p, envId);
      const version = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const result = await compileIn(tx, w.draft, {
          workspaceId: p.workspaceId,
          level: "publish",
        });
        if (!result.ok) throw new WorkflowValidationError(result.diagnostics);
        if (req.body.requireEvaluation) {
          const gate = req.body.requireEvaluation;
          const [evaluated] = await tx
            .select({ id: evaluationRuns.id, summary: evaluationRuns.summary })
            .from(evaluationRuns)
            .innerJoin(workflowVersions, eq(workflowVersions.id, evaluationRuns.workflowVersionId))
            .where(
              and(
                eq(evaluationRuns.setId, gate.setId),
                eq(evaluationRuns.status, "completed"),
                eq(workflowVersions.planHash, result.plan.planHash),
              ),
            )
            .orderBy(desc(evaluationRuns.createdAt))
            .limit(1);
          if (!evaluated)
            throw new WorkflowValidationError([
              {
                code: "W_REGRESSION",
                severity: "error",
                message:
                  "the publish gate needs a completed evaluation of this draft on the set; run it first (POST /v1/evaluations/runs with draft: true)",
                location: { path: "/" },
              },
            ]);
          const passRate = Number(
            (evaluated.summary as { passRate?: number } | null)?.passRate ?? 0,
          );
          if (passRate < gate.minPassRate)
            throw new EvaluationGateFailed(
              `the evaluation pass rate ${(passRate * 100).toFixed(1)}% is below the gate of ${(gate.minPassRate * 100).toFixed(1)}%`,
              {
                evaluationRunId: evaluated.id,
                summary: evaluated.summary,
                gate,
              },
            );
        }
        const hash = definitionHash(w.draft);
        if (w.latestVersionId) {
          const latest = await getVersion(tx, w.latestVersionId);
          if (latest?.definitionHash === hash)
            throw new ConflictError("nothing changed since the latest version", {
              latestVersionId: latest.id,
            });
        }
        const v = await publishVersion(tx, {
          workflowId: w.id,
          definition: w.draft,
          definitionHash: hash,
          plan: result.plan,
          planHash: result.plan.planHash,
          compilerVersion: result.plan.compilerVersion,
          catalogSnapshot: catalogSnapshot(result.plan),
          diagnostics: result.diagnostics,
          notes: req.body.notes ?? null,
          label: req.body.label ?? null,
          publishedBy: p.userId,
        });
        for (const envId of req.body.deployTo ?? []) {
          const [env] = await tx
            .select()
            .from(environments)
            .where(and(eq(environments.id, envId), eq(environments.workspaceId, p.workspaceId)));
          if (!env) throw new BadRequestError(`unknown environment ${envId}`);
          if (env.protected && !hasScope(p, "admin"))
            throw new ForbiddenError(`deploying to ${env.name} requires admin`);
          // the same check as PUT /deployments/:env: required secrets bound or served by a server key
          const missing = await missingSecrets(
            tx,
            w.id,
            envId,
            w.draft.secrets,
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
          await deploy(tx, {
            workflowId: w.id,
            environmentId: envId,
            versionId: v.id,
            deployedBy: p.userId,
          });
          await materialiseTriggers(tx, {
            workspaceId: p.workspaceId,
            workspaceSlug: p.workspaceSlug,
            workflowId: w.id,
            environmentId: envId,
            triggers: w.draft.triggers,
            baseUrl: ctx.config.baseUrl,
            now: new Date(ctx.clock.now()),
          });
        }
        return v;
      });
      req.audit.details = {
        versionId: version.id,
        version: version.version,
        deployTo: req.body.deployTo ?? [],
      };
      return reply.code(201).send(versionDto(version, true));
    },
  );

  r.post(
    "/v1/workflows/:id/clone",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.clone", resource: "workflow" },
        cli: { noun: "workflow", verb: "clone", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        params: IdParams,
        body: z.object({ name: z.string().min(1).max(200).optional() }).default({}),
        response: { 201: WorkflowSummarySchema },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const name = req.body.name ?? `${w.name} (copy)`;
        const id = uuidv7();
        const definition = { ...w.draft, id, name };
        const created = await createWorkflow(tx, {
          workspaceId: p.workspaceId,
          name,
          slug: await uniqueSlug(tx, p.workspaceId, slugify(name)),
          draft: definition,
          description: w.description,
          tags: w.tags,
          createdBy: p.userId,
        });
        const [u] = await tx
          .update(workflows)
          .set({ id, draftDiagnostics: w.draftDiagnostics })
          .where(eq(workflows.id, created.id))
          .returning();
        return u as WorkflowRow;
      });
      req.audit = { resourceId: row.id, details: { from: req.params.id } };
      return reply.code(201).send(summaryDto(row, null));
    },
  );

  r.post(
    "/v1/workflows/import",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.import", resource: "workflow" },
        cli: { noun: "workflow", verb: "import" },
      },
      schema: {
        tags: ["workflows"],
        summary:
          "Import a definition (JSON or YAML), or an external flow export translated by the FlowAId importer, as a new workflow",
        body: ImportBody,
        response: {
          201: z.object({
            workflow: WorkflowSummarySchema,
            diagnostics: z.array(z.unknown()),
            report: ImportReportSchema.optional(),
          }),
        },
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const id = uuidv7();
      const { definition, report } = readImport(req.body, id);
      const docName =
        typeof definition === "object" && definition !== null
          ? (definition as JsonObject).name
          : undefined;
      const name = req.body.name ?? (typeof docName === "string" ? docName : "Imported workflow");
      const out = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const def = withId(definition, id, name);
        const compiled = await compileIn(tx, def, { workspaceId: p.workspaceId, level: "draft" });
        assertSaveable(compiled.diagnostics);
        const created = await createWorkflow(tx, {
          workspaceId: p.workspaceId,
          name,
          slug: await uniqueSlug(tx, p.workspaceId, slugify(name)),
          draft: WorkflowDefinitionSchema.parse(def),
          createdBy: p.userId,
        });
        const [u] = await tx
          .update(workflows)
          .set({ id, draftDiagnostics: compiled.diagnostics })
          .where(eq(workflows.id, created.id))
          .returning();
        return { row: u as WorkflowRow, diagnostics: compiled.diagnostics };
      });
      req.audit.resourceId = out.row.id;
      if (report)
        req.audit.details = {
          source: `external ${report.format}`,
          counts: report.counts,
        };
      return reply.code(201).send({
        workflow: summaryDto(out.row, null),
        diagnostics: out.diagnostics,
        ...(report ? { report } : {}),
      });
    },
  );

  r.post(
    "/v1/workflows/import/preview",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        // a dry run: nothing is written
        audit: false,
        cli: { noun: "workflow", verb: "import-preview" },
      },
      schema: {
        tags: ["workflows"],
        summary:
          "Translate an external flow export without saving it: the migration report and the compiler's diagnostics",
        body: z.object({ external: z.unknown(), name: z.string().min(1).max(200).optional() }),
        response: {
          200: z.object({
            report: ImportReportSchema,
            definition: z.unknown(),
            diagnostics: z.array(z.unknown()),
          }),
        },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const { definition, report } = readImport(req.body, uuidv7());
      const compiled = await ctx.db.tenant(p.workspaceId, (tx) =>
        compileIn(tx, definition, { workspaceId: p.workspaceId, level: "draft" }),
      );
      return { report: report as ImportReport, definition, diagnostics: compiled.diagnostics };
    },
  );

  r.get(
    "/v1/workflows/:id/draft/export",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "workflow", verb: "export", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "The draft as one file (secrets stay symbolic)",
        params: IdParams,
        querystring: z.object({ format: z.enum(["json", "yaml", "ts"]).default("json") }),
      },
    },
    async (req, reply) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const w = await ctx.db.tenant(p.workspaceId, (tx) => visibleWorkflow(tx, p, req.params.id));
      const filename = `${w.slug}.${req.query.format}`;
      void reply.header("content-disposition", `attachment; filename="${filename}"`);
      if (req.query.format === "ts")
        return reply
          .type("text/plain; charset=utf-8")
          .send(await generateWorkflowTs(w.draft, { title: `${w.name} (draft)` }));
      if (req.query.format === "yaml") return reply.type("application/yaml").send(toYaml(w.draft));
      return reply.type("application/json").send(`${JSON.stringify(w.draft, null, 2)}\n`);
    },
  );

  const TemplateSchema = z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    builtIn: z.boolean(),
    requiredResources: z.unknown(),
    requiredSecrets: z.unknown(),
    /** with `include=graph`: the template's shape, for previews */
    graph: z
      .object({
        nodes: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            type: z.string().nullable(),
            name: z.string(),
          }),
        ),
        edges: z.array(z.object({ source: z.string(), target: z.string() })),
      })
      .optional(),
  });
  r.get(
    "/v1/templates",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "template", verb: "list" },
      },
      schema: {
        tags: ["templates"],
        querystring: z.object({ include: z.enum(["graph"]).optional() }),
        response: { 200: z.array(TemplateSchema) },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(templates)
          .where(or(isNull(templates.workspaceId), eq(templates.workspaceId, p.workspaceId)))
          .orderBy(templates.name),
      );
      return rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        category: t.category,
        builtIn: t.workspaceId === null,
        requiredResources: t.requiredResources,
        requiredSecrets: t.requiredSecrets,
        ...(req.query.include === "graph" ? { graph: templateGraph(t.definition) } : {}),
      }));
    },
  );
}

/**
 * Nodes (kind, task type, name) and edges of a template definition: control edges plus one edge per
 * node that reads another node's port (`{ kind: "port", node }` refs anywhere in its bindings).
 */
export function templateGraph(definition: unknown) {
  const d = definition as {
    nodes?: ({ id: string; kind: string; type?: string; name?: string } & Record<
      string,
      unknown
    >)[];
    edges?: { from: { node: string }; to: { node: string } }[];
  };
  const nodes = d.nodes ?? [];
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: { source: string; target: string }[] = [];
  const add = (source: string, target: string) => {
    const key = `${source}\u0000${target}`;
    if (source === target || !ids.has(source) || !ids.has(target) || seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target });
  };
  for (const e of d.edges ?? []) add(e.from.node, e.to.node);
  const refsIn = (value: unknown, target: string): void => {
    if (Array.isArray(value)) for (const v of value) refsIn(v, target);
    else if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (o.kind === "port" && typeof o.node === "string") add(o.node, target);
      for (const v of Object.values(o)) refsIn(v, target);
    }
  };
  for (const n of nodes) refsIn(n, n.id);
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      type: n.type ?? null,
      name: n.name ?? n.id,
    })),
    edges,
  };
}

/** 422: the publish gate's evaluation did not pass. */
export class EvaluationGateFailed extends FlowaidError {
  readonly code = "WORKFLOW_VALIDATION_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
}

/** 412 for `If-Match` mismatches, with the current revision (API.md §2). */
export class PreconditionFailed extends FlowaidError {
  readonly code = "CONFLICT" as const;
  readonly retryable = false;
  override readonly httpStatus = 412;
}
