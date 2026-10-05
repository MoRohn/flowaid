/** Evaluations (API.md §3.8): sets, cases, runs (executed by the worker's `evaluation.run`), comparisons. */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, desc, eq, gt, lt, max, or } from "drizzle-orm";
import {
  ExpectationSchema,
  answersByNodeRun,
  compare,
  reportToMarkdown,
  summarize,
  type CaseResult,
} from "@flowaid/evaluation";
import {
  PgRunStore,
  environments,
  evaluationCases,
  evaluationResults,
  evaluationRuns,
  evaluationSets,
  workflows,
  type Tx,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type JsonObject,
  type JsonValue,
} from "@flowaid/workflow-core";
import { assertEnvironmentAllowed, canSeeWorkflow, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import {
  IdParams,
  ListQuery,
  NoContent,
  PageQuery,
  afterCursor,
  decodeCursor,
  encodeCursor,
  toPage,
} from "../dto/common.js";
import { resolveRunVersion } from "../services/runs.js";
import { assertWithinBudget } from "../services/budget.js";
import { serverCredentialTypes } from "../services/serverKeys.js";

type SetRow = typeof evaluationSets.$inferSelect;
type CaseRow = typeof evaluationCases.$inferSelect;
type EvalRunRow = typeof evaluationRuns.$inferSelect;

const setDto = (s: SetRow) => ({
  id: s.id,
  workflowId: s.workflowId,
  name: s.name,
  description: s.description,
  inputSchema: s.inputSchema,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
const caseDto = (c: CaseRow) => ({
  id: c.id,
  setId: c.setId,
  ordinal: c.ordinal,
  input: c.input,
  expected: c.expected,
  metadata: c.metadata,
  tags: c.tags,
  sourceRunId: c.sourceRunId,
  createdAt: c.createdAt.toISOString(),
});
const runDto = (r: EvalRunRow) => ({
  id: r.id,
  setId: r.setId,
  workflowId: r.workflowId,
  workflowVersionId: r.workflowVersionId,
  environmentId: r.environmentId,
  baselineEvaluationRunId: r.baselineEvaluationRunId,
  status: r.status,
  concurrency: r.concurrency,
  total: r.total,
  completed: r.completed,
  summary: r.summary,
  report: r.report,
  gate: r.gate,
  createdAt: r.createdAt.toISOString(),
  endedAt: r.endedAt?.toISOString() ?? null,
});

const CaseInput = z.object({
  input: z.unknown(),
  expected: z.unknown().default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().max(50)).max(20).default([]),
});

export async function resultsOf(tx: Tx, evaluationRunId: string): Promise<CaseResult[]> {
  const rows = await tx
    .select()
    .from(evaluationResults)
    .where(eq(evaluationResults.evaluationRunId, evaluationRunId));
  return rows.map((r) => ({
    caseId: r.caseId,
    runId: r.runId,
    passed: r.passed,
    checks: (r.checks as { items?: CaseResult["checks"] }).items ?? [],
    failures: r.failures,
    metrics: r.metrics as unknown as CaseResult["metrics"],
    status: "completed",
  }));
}

export function evaluationRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const loadSet = async (tx: Tx, p: Principal, id: string) => {
    const [s] = await tx
      .select()
      .from(evaluationSets)
      .where(and(eq(evaluationSets.id, id), eq(evaluationSets.workspaceId, p.workspaceId)));
    if (!s || (s.workflowId && !canSeeWorkflow(p, s.workflowId)))
      throw new NotFoundError("evaluation set not found");
    return s;
  };
  const loadRun = async (tx: Tx, p: Principal, id: string) => {
    const [row] = await tx
      .select()
      .from(evaluationRuns)
      .where(and(eq(evaluationRuns.id, id), eq(evaluationRuns.workspaceId, p.workspaceId)));
    if (!row || !canSeeWorkflow(p, row.workflowId))
      throw new NotFoundError("evaluation run not found");
    return row;
  };
  const parseExpected = (e: unknown) => {
    const parsed = ExpectationSchema.safeParse(e ?? {});
    if (!parsed.success)
      throw new BadRequestError("invalid expectation", {
        issues: parsed.error.issues.map((i) => ({
          path: `/${i.path.join("/")}`,
          message: i.message,
        })),
      });
    return parsed.data as unknown as JsonObject;
  };

  r.get(
    "/v1/evaluations/sets",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "dataset", verb: "list" },
      },
      schema: {
        tags: ["datasets"],
        querystring: PageQuery.extend({ workflowId: z.uuid().optional() }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(evaluationSets)
          .where(
            and(
              eq(evaluationSets.workspaceId, p.workspaceId),
              req.query.workflowId
                ? eq(evaluationSets.workflowId, req.query.workflowId)
                : undefined,
              afterCursor(evaluationSets.name, evaluationSets.id, cursor),
            ),
          )
          .orderBy(asc(evaluationSets.name), asc(evaluationSets.id))
          .limit(limit + 1),
      );
      // Sets on workflows the principal cannot see are dropped after paging (as for runs), so a
      // page can hold fewer than `limit` items while `next_cursor` is still set.
      const pg = toPage(
        rows,
        limit,
        (s) => [s.name, s.id],
        (s) => s,
      );
      return {
        items: pg.items.filter((s) => !s.workflowId || canSeeWorkflow(p, s.workflowId)).map(setDto),
        next_cursor: pg.next_cursor,
      };
    },
  );

  r.post(
    "/v1/evaluations/sets",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_set.create", resource: "evaluation_set" },
        cli: { noun: "dataset", verb: "create" },
      },
      schema: {
        tags: ["datasets"],
        body: z.object({
          name: z.string().min(1).max(200),
          description: z.string().max(2000).default(""),
          workflowId: z.uuid().optional(),
          inputSchema: z.record(z.string(), z.unknown()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        if (req.body.workflowId) {
          const [w] = await tx
            .select({ id: workflows.id })
            .from(workflows)
            .where(
              and(eq(workflows.id, req.body.workflowId), eq(workflows.workspaceId, p.workspaceId)),
            );
          if (!w) throw new BadRequestError("workflow not found");
        }
        const [dup] = await tx
          .select({ id: evaluationSets.id })
          .from(evaluationSets)
          .where(
            and(
              eq(evaluationSets.workspaceId, p.workspaceId),
              eq(evaluationSets.name, req.body.name),
            ),
          );
        if (dup) throw new ConflictError(`a set named ${req.body.name} exists`);
        const [created] = await tx
          .insert(evaluationSets)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            name: req.body.name,
            description: req.body.description,
            workflowId: req.body.workflowId ?? null,
            inputSchema: (req.body.inputSchema ?? null) as never,
          })
          .returning();
        return created as SetRow;
      });
      req.audit.resourceId = row.id;
      return reply.code(201).send(setDto(row));
    },
  );

  r.get(
    "/v1/evaluations/sets/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "dataset", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["datasets"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const set = await loadSet(tx, p, req.params.id);
        // the workflows that use the set as their publish gate (named when it is deleted)
        const gated = await tx
          .select({ id: workflows.id, name: workflows.name })
          .from(workflows)
          .where(
            and(eq(workflows.workspaceId, p.workspaceId), eq(workflows.evaluationSetId, set.id)),
          )
          .orderBy(asc(workflows.name));
        return {
          ...setDto(set),
          gateOf: gated.filter((w) => canSeeWorkflow(p, w.id)),
        };
      });
    },
  );

  r.delete(
    "/v1/evaluations/sets/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_set.delete", resource: "evaluation_set" },
        cli: { noun: "dataset", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["datasets"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const unlinked = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSet(tx, p, req.params.id);
        // workflows gated on the set lose the link with it (the column has no foreign key), so
        // none points at a set that no longer exists
        const gated = await tx
          .update(workflows)
          .set({ evaluationSetId: null })
          .where(
            and(
              eq(workflows.workspaceId, p.workspaceId),
              eq(workflows.evaluationSetId, req.params.id),
            ),
          )
          .returning({ id: workflows.id });
        await tx.delete(evaluationSets).where(eq(evaluationSets.id, req.params.id));
        return gated.map((w) => w.id);
      });
      if (unlinked.length) req.audit.details = { unlinkedWorkflowIds: unlinked };
      return reply.code(204).send(null);
    },
  );

  r.get(
    "/v1/evaluations/sets/:id/cases",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "dataset", verb: "cases", positional: ["id"] },
      },
      schema: { tags: ["datasets"], params: IdParams, querystring: ListQuery },
    },
    async (req) => {
      const p = need(req.principal);
      const after = req.query.cursor ? Number(decodeCursor(req.query.cursor)?.[0] ?? -1) : -1;
      const rows = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSet(tx, p, req.params.id);
        return tx
          .select()
          .from(evaluationCases)
          .where(and(eq(evaluationCases.setId, req.params.id), gt(evaluationCases.ordinal, after)))
          .orderBy(asc(evaluationCases.ordinal))
          .limit(req.query.limit + 1);
      });
      const items = rows.slice(0, req.query.limit);
      const last = items.at(-1);
      return {
        items: items.map(caseDto),
        next_cursor:
          rows.length > req.query.limit && last ? encodeCursor(last.ordinal, last.id) : null,
      };
    },
  );

  r.post(
    "/v1/evaluations/sets/:id/cases",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_case.create", resource: "evaluation_set" },
        cli: { noun: "dataset", verb: "add-cases", positional: ["id"] },
      },
      schema: {
        tags: ["datasets"],
        params: IdParams,
        body: z.union([CaseInput, z.array(CaseInput).min(1).max(1000)]),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const list = Array.isArray(req.body) ? req.body : [req.body];
      const rows = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSet(tx, p, req.params.id);
        const [{ n } = { n: null }] = await tx
          .select({ n: max(evaluationCases.ordinal) })
          .from(evaluationCases)
          .where(eq(evaluationCases.setId, req.params.id));
        let ordinal = (n ?? -1) + 1;
        return tx
          .insert(evaluationCases)
          .values(
            list.map((c) => ({
              id: uuidv7(),
              workspaceId: p.workspaceId,
              setId: req.params.id,
              ordinal: ordinal++,
              input: c.input as JsonValue,
              expected: parseExpected(c.expected),
              metadata: c.metadata as JsonObject,
              tags: c.tags,
            })),
          )
          .returning();
      });
      req.audit.details = { added: rows.length };
      return reply.code(201).send(rows.map(caseDto));
    },
  );

  r.patch(
    "/v1/evaluations/cases/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_case.update", resource: "evaluation_case" },
        cli: { noun: "dataset", verb: "update-case", positional: ["id"] },
      },
      schema: { tags: ["datasets"], params: IdParams, body: CaseInput.partial() },
    },
    async (req) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const [c] = await tx
          .select()
          .from(evaluationCases)
          .where(
            and(
              eq(evaluationCases.id, req.params.id),
              eq(evaluationCases.workspaceId, p.workspaceId),
            ),
          );
        if (!c) throw new NotFoundError("case not found");
        await loadSet(tx, p, c.setId);
        const [u] = await tx
          .update(evaluationCases)
          .set({
            ...(req.body.input !== undefined ? { input: req.body.input as JsonValue } : {}),
            ...(req.body.expected !== undefined
              ? { expected: parseExpected(req.body.expected) }
              : {}),
            ...(req.body.metadata ? { metadata: req.body.metadata as JsonObject } : {}),
            ...(req.body.tags ? { tags: req.body.tags } : {}),
            updatedAt: new Date(),
          })
          .where(eq(evaluationCases.id, c.id))
          .returning();
        return u as CaseRow;
      });
      return caseDto(row);
    },
  );

  r.delete(
    "/v1/evaluations/cases/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_case.delete", resource: "evaluation_case" },
        cli: { noun: "dataset", verb: "delete-case", positional: ["id"] },
      },
      schema: { tags: ["datasets"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .delete(evaluationCases)
          .where(
            and(
              eq(evaluationCases.id, req.params.id),
              eq(evaluationCases.workspaceId, p.workspaceId),
            ),
          )
          .returning({ id: evaluationCases.id }),
      );
      if (!rows.length) throw new NotFoundError("case not found");
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/evaluations/runs",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation.start", resource: "evaluation_run" },
        cli: { noun: "evaluation", verb: "start" },
      },
      schema: {
        tags: ["evaluations"],
        summary: "Evaluate a version (or the current draft) against a set",
        body: z.object({
          setId: z.uuid(),
          workflowId: z.uuid().optional(),
          versionId: z.uuid().optional(),
          draft: z.boolean().default(false),
          environmentId: z.uuid().optional(),
          baselineEvaluationRunId: z.uuid().optional(),
          concurrency: z.int().min(1).max(16).default(4),
          gate: z.object({ minPassRate: z.number().min(0).max(1) }).optional(),
        }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const set = await loadSet(tx, p, b.setId);
        const workflowId = b.workflowId ?? set.workflowId;
        if (!workflowId)
          throw new BadRequestError("pass workflowId (the set is not linked to a workflow)");
        const envId =
          b.environmentId ??
          p.environmentId ??
          (
            await tx
              .select({ id: environments.id })
              .from(environments)
              .where(and(eq(environments.workspaceId, p.workspaceId), eq(environments.name, "dev")))
          )[0]?.id;
        if (!envId) throw new BadRequestError("pass environmentId");
        assertEnvironmentAllowed(p, envId);
        const version = await resolveRunVersion(
          tx,
          p,
          workflowId,
          envId,
          { versionId: b.versionId, draft: b.draft },
          serverCredentialTypes(ctx.env),
        );
        // every case is a run: none start once the monthly budget is spent
        await assertWithinBudget(ctx, tx, { id: p.workspaceId, slug: p.workspaceSlug });
        const [created] = await tx
          .insert(evaluationRuns)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            setId: set.id,
            workflowId,
            workflowVersionId: version.id,
            environmentId: envId,
            baselineEvaluationRunId: b.baselineEvaluationRunId ?? null,
            concurrency: b.concurrency,
            gate: b.gate ?? null,
            createdBy: `${p.type}:${p.id}`,
          })
          .returning();
        return created as EvalRunRow;
      });
      await ctx.queue.enqueue(
        "evaluation",
        { type: "evaluation.run", evaluationRunId: row.id },
        { jobId: `evaluation.run:${row.id}` },
      );
      req.audit.resourceId = row.id;
      return reply.code(202).send(runDto(row));
    },
  );

  r.get(
    "/v1/evaluations/runs",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "evaluation", verb: "list" },
      },
      schema: {
        tags: ["evaluations"],
        querystring: ListQuery.extend({
          setId: z.uuid().optional(),
          workflowId: z.uuid().optional(),
        }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const cursor = decodeCursor(req.query.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(evaluationRuns)
          .where(
            and(
              eq(evaluationRuns.workspaceId, p.workspaceId),
              req.query.setId ? eq(evaluationRuns.setId, req.query.setId) : undefined,
              req.query.workflowId
                ? eq(evaluationRuns.workflowId, req.query.workflowId)
                : undefined,
              cursor
                ? or(
                    lt(evaluationRuns.createdAt, new Date(String(cursor[0]))),
                    and(
                      eq(evaluationRuns.createdAt, new Date(String(cursor[0]))),
                      lt(evaluationRuns.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(evaluationRuns.createdAt), desc(evaluationRuns.id))
          .limit(req.query.limit + 1),
      );
      const items = rows.slice(0, req.query.limit).filter((x) => canSeeWorkflow(p, x.workflowId));
      const last = rows.slice(0, req.query.limit).at(-1);
      return {
        items: items.map(runDto),
        next_cursor:
          rows.length > req.query.limit && last
            ? encodeCursor(last.createdAt.toISOString(), last.id)
            : null,
      };
    },
  );

  r.get(
    "/v1/evaluations/runs/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "evaluation", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["evaluations"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      return runDto(await ctx.db.tenant(p.workspaceId, (tx) => loadRun(tx, p, req.params.id)));
    },
  );

  r.get(
    "/v1/evaluations/runs/:id/results",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "evaluation", verb: "results", positional: ["id"] },
      },
      schema: { tags: ["evaluations"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadRun(tx, p, req.params.id);
        return resultsOf(tx, req.params.id);
      });
    },
  );

  r.get(
    "/v1/evaluations/runs/:id/compare/:otherId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:read",
        cli: { noun: "evaluation", verb: "compare", positional: ["id", "otherId"] },
      },
      schema: {
        tags: ["evaluations"],
        params: z.object({ id: z.uuid(), otherId: z.uuid() }),
        querystring: z.object({ format: z.enum(["json", "markdown"]).default("json") }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const report = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const current = await loadRun(tx, p, req.params.id);
        const baseline = await loadRun(tx, p, req.params.otherId);
        const [a, b] = await Promise.all([resultsOf(tx, current.id), resultsOf(tx, baseline.id)]);
        return compare({
          versionId: current.workflowVersionId,
          results: a,
          summary: summarize(a),
          baseline: { versionId: baseline.workflowVersionId, results: b, summary: summarize(b) },
          gate: current.gate ?? null,
        });
      });
      if (req.query.format === "markdown")
        return reply.type("text/markdown").send(reportToMarkdown(report));
      return report;
    },
  );

  r.post(
    "/v1/evaluations/runs/:id/cancel",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation.cancel", resource: "evaluation_run" },
        cli: { noun: "evaluation", verb: "cancel", positional: ["id"] },
      },
      schema: {
        tags: ["evaluations"],
        params: IdParams,
        response: { 202: z.object({ id: z.uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await loadRun(tx, p, req.params.id);
        if (["completed", "failed", "cancelled"].includes(cur.status))
          throw new ConflictError(`the evaluation is already ${cur.status}`);
        const [u] = await tx
          .update(evaluationRuns)
          .set({ status: "cancelled" })
          .where(eq(evaluationRuns.id, cur.id))
          .returning();
        return u as EvalRunRow;
      });
      return reply.code(202).send({ id: row.id, status: row.status });
    },
  );

  r.post(
    "/v1/runs/:id/add-to-evaluation",
    {
      config: {
        auth: "session_or_api_key",
        scope: "evaluations:write",
        audit: { action: "evaluation_case.from_run", resource: "run" },
        cli: { noun: "run", verb: "add-to-evaluation", positional: ["id"] },
      },
      schema: {
        tags: ["datasets"],
        summary: "Turn a run into a case (input, decisions, branches and outcome prefilled)",
        params: IdParams,
        body: z.object({ setId: z.uuid(), expected: z.record(z.string(), z.unknown()).optional() }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const store = new PgRunStore(ctx.db, { workspaceId: p.workspaceId });
      const run = await store.getRun(req.params.id);
      if (!run || !canSeeWorkflow(p, run.workflowId)) throw new NotFoundError("run not found");
      const nodes = await store.listNodeRuns(run.id);
      // a batch step's answers, one per question (its `decision` column holds only one of them)
      const answers = answersByNodeRun(
        (await store.listEvents(run.id, 0, 10_000, ["DECISION_COMPLETED"])).flatMap((e) =>
          e.type === "DECISION_COMPLETED" ? [e] : [],
        ),
      );
      const decisions: JsonObject = {};
      const branches: JsonObject = {};
      for (const n of nodes) {
        const batch = answers.get(n.id);
        if (batch)
          for (const [question, d] of Object.entries(batch))
            decisions[`${n.nodeId}.${question}`] = { value: d.value as JsonValue };
        else if (n.decision) decisions[n.nodeId] = { value: n.decision.value as JsonValue };
        const port = n.firedPorts.find((x) => x !== "done");
        if (port) branches[n.nodeId] = port;
      }
      const expected = parseExpected({
        decisions,
        branches,
        ...(run.outcome ? { outcome: run.outcome } : {}),
        ...(req.body.expected ?? {}),
      });
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSet(tx, p, req.body.setId);
        const [{ n } = { n: null }] = await tx
          .select({ n: max(evaluationCases.ordinal) })
          .from(evaluationCases)
          .where(eq(evaluationCases.setId, req.body.setId));
        const [created] = await tx
          .insert(evaluationCases)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            setId: req.body.setId,
            ordinal: (n ?? -1) + 1,
            input: run.input,
            expected,
            sourceRunId: run.id,
          })
          .returning();
        return created as CaseRow;
      });
      req.audit.details = { caseId: row.id, setId: req.body.setId };
      return reply.code(201).send(caseDto(row));
    },
  );
}
