/**
 * Code export (CODE_EXPORT.md §4, API.md §9): "Download code" for a version or the current draft.
 * `POST …/export/package` records a `jobs` row and enqueues `export.package` on the worker's `jobs`
 * queue (RFC-0001), answering 202 `{ job_id }`; `GET /v1/jobs/:id` reports progress and the
 * artifact; `GET /v1/artifacts/:id/download` serves the zip. The draft twin compiles the draft first
 * (422 with diagnostics) and hands the compiled plan to the job. Audited `workflow.exported`.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getVersion, jobs, runs, type Tx } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ErrorInfoSchema,
  ForbiddenError,
  NotFoundError,
  WorkflowValidationError,
  type JsonObject,
} from "@flowaid/workflow-core";
import { canSeeWorkflow, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams } from "../dto/common.js";
import { compileIn } from "../services/compile.js";
import { visibleWorkflow } from "../services/workflows.js";

export const ExportPackageRequestSchema = z
  .object({
    mode: z.enum(["npm", "vendored"]).optional(),
    /** `inputs/example.json` from this run's input (personal data replaced by placeholders). */
    includeSampleFromRunId: z.uuid().optional(),
    /** `tests/recorded-run.json` from this run, replayed by the package's tests. */
    includeRecordedRunId: z.uuid().optional(),
  })
  .default({});

export const JobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["export.package"]),
  status: z.enum(["queued", "running", "completed", "failed"]),
  artifact_id: z.uuid().optional(),
  error: ErrorInfoSchema.optional(),
  created_at: z.iso.datetime(),
  started_at: z.iso.datetime().optional(),
  ended_at: z.iso.datetime().optional(),
});

const JobAccepted = z.object({ job_id: z.uuid() });

type ExportRequest = z.infer<typeof ExportPackageRequestSchema>;

function need(p: Principal | null | undefined): Principal {
  if (!p) throw new ForbiddenError("no principal");
  return p;
}

export function exportRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const modeOf = (body: ExportRequest): "npm" | "vendored" => {
    const mode = body.mode ?? ctx.config.exportMode;
    if (mode === "vendored" && !ctx.config.vendorAvailable)
      throw new BadRequestError(
        "vendored exports need the packed runtime packages (FLOWAID_VENDOR_DIR); use mode 'npm'",
      );
    return mode;
  };

  /** Runs referenced by the request must belong to the exported workflow. */
  const checkRuns = async (tx: Tx, p: Principal, workflowId: string, body: ExportRequest) => {
    for (const id of [body.includeSampleFromRunId, body.includeRecordedRunId]) {
      if (!id) continue;
      const [row] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.id, id),
            eq(runs.workspaceId, p.workspaceId),
            eq(runs.workflowId, workflowId),
          ),
        );
      if (!row) throw new NotFoundError(`run ${id} not found for this workflow`);
    }
  };

  const enqueue = async (
    p: Principal,
    workflowId: string,
    versionId: string | null,
    mode: "npm" | "vendored",
    body: ExportRequest,
    payloadExtra: JsonObject,
    tx: Tx,
    draftRevision?: number,
  ): Promise<string> => {
    const jobId = uuidv7();
    await tx.insert(jobs).values({
      id: jobId,
      workspaceId: p.workspaceId,
      kind: "export.package",
      payload: {
        workflowId,
        versionId,
        mode,
        ...(draftRevision !== undefined ? { draftRevision } : {}),
        ...(body.includeSampleFromRunId
          ? { includeSampleFromRunId: body.includeSampleFromRunId }
          : {}),
        ...(body.includeRecordedRunId ? { includeRecordedRunId: body.includeRecordedRunId } : {}),
        ...payloadExtra,
      },
      createdBy: `${p.type}:${p.id}`,
    });
    return jobId;
  };

  const send = async (
    p: Principal,
    jobId: string,
    workflowId: string,
    versionId: string | null,
    mode: "npm" | "vendored",
    body: ExportRequest,
    draftRevision?: number,
  ) => {
    await ctx.queue.enqueue(
      "jobs",
      {
        type: "export.package",
        jobId,
        workspaceId: p.workspaceId,
        workflowId,
        versionId,
        mode,
        ...(draftRevision !== undefined ? { draftRevision } : {}),
        ...(body.includeSampleFromRunId
          ? { includeSampleFromRunId: body.includeSampleFromRunId }
          : {}),
        ...(body.includeRecordedRunId ? { includeRecordedRunId: body.includeRecordedRunId } : {}),
        requestedBy: `${p.type}:${p.id}`,
      },
      { jobId },
    );
  };

  r.post(
    "/v1/workflow-versions/:id/export/package",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        audit: { action: "workflow.exported", resource: "workflow" },
        cli: { noun: "version", verb: "package", positional: ["id"] },
      },
      schema: {
        tags: ["versions"],
        summary: "Build the code package (zip) of a version; poll GET /v1/jobs/:id",
        params: IdParams,
        body: ExportPackageRequestSchema,
        response: { 202: JobAccepted },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const mode = modeOf(req.body);
      const out = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const v = await getVersion(tx, req.params.id);
        if (!v || v.workspaceId !== p.workspaceId)
          throw new NotFoundError(`version ${req.params.id} not found`);
        await visibleWorkflow(tx, p, v.workflowId);
        await checkRuns(tx, p, v.workflowId, req.body);
        const jobId = await enqueue(p, v.workflowId, v.id, mode, req.body, {}, tx);
        return { jobId, workflowId: v.workflowId };
      });
      await send(p, out.jobId, out.workflowId, req.params.id, mode, req.body);
      req.audit = {
        resourceId: out.workflowId,
        details: { workflowId: out.workflowId, versionId: req.params.id, mode, jobId: out.jobId },
      };
      return reply.code(202).send({ job_id: out.jobId });
    },
  );

  r.post(
    "/v1/workflows/:id/draft/export/package",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        audit: { action: "workflow.exported", resource: "workflow" },
        cli: { noun: "workflow", verb: "package", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "Build the code package (zip) of the current draft (422 when it does not compile)",
        params: IdParams,
        body: ExportPackageRequestSchema,
        response: { 202: JobAccepted },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const mode = modeOf(req.body);
      const out = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const compiled = await compileIn(tx, w.draft, {
          workspaceId: p.workspaceId,
          level: "publish",
        });
        if (!compiled.ok) throw new WorkflowValidationError(compiled.diagnostics);
        await checkRuns(tx, p, w.id, req.body);
        const jobId = await enqueue(
          p,
          w.id,
          null,
          mode,
          req.body,
          {
            definition: w.draft as unknown as JsonObject,
            plan: compiled.plan as unknown as JsonObject,
          },
          tx,
          w.draftRevision,
        );
        return { jobId, revision: w.draftRevision };
      });
      await send(p, out.jobId, req.params.id, null, mode, req.body, out.revision);
      req.audit = {
        resourceId: req.params.id,
        details: {
          workflowId: req.params.id,
          versionId: null,
          draftRevision: out.revision,
          mode,
          jobId: out.jobId,
        },
      };
      return reply.code(202).send({ job_id: out.jobId });
    },
  );

  r.get(
    "/v1/jobs/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "job", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["jobs"], params: IdParams, response: { 200: JobSchema } },
    },
    async (req) => {
      const p = need(req.principal);
      const [job] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.id, req.params.id), eq(jobs.workspaceId, p.workspaceId))),
      );
      const workflowId = (job?.payload as { workflowId?: string } | undefined)?.workflowId;
      // MCP probes are the API's own short-lived rows, not jobs anyone polls
      if (!job || job.kind !== "export.package" || (workflowId && !canSeeWorkflow(p, workflowId)))
        throw new NotFoundError("job not found");
      return {
        id: job.id,
        kind: job.kind,
        status: job.status,
        ...(job.artifactId ? { artifact_id: job.artifactId } : {}),
        ...(job.error ? { error: job.error } : {}),
        created_at: job.createdAt.toISOString(),
        ...(job.startedAt ? { started_at: job.startedAt.toISOString() } : {}),
        ...(job.endedAt ? { ended_at: job.endedAt.toISOString() } : {}),
      };
    },
  );
}
