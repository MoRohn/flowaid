/** Runs (API.md §3.4, §4, §5): start (async/sync/idempotent), query, stream over SSE, cancel, replay, human tasks (§3.5). */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  PgRunStore,
  humanTasks,
  listRuns,
  nodeRuns,
  runs,
  runEvents,
  toHumanTask,
  workflowVersions,
  type Tx,
} from "@flowaid/database";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HumanResponseSchema,
  NotFoundError,
  RateLimitError,
  type DurableRunEvent,
  type HumanRequest,
  type HumanResponse,
  type JsonValue,
  type Run,
  type RunStatus,
} from "@flowaid/workflow-core";
import { canSeeWorkflow, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, ListQuery, NoContent, decodeCursor, encodeCursor, page } from "../dto/common.js";
import {
  HumanTaskSchema,
  RunAcceptedSchema,
  RunCompletedSchema,
  RunRequestSchema,
  RunSchema,
} from "../dto/runs.js";
import { envelope } from "../plugins/errors.js";
import { startRun, waitForRun, type StartRunRequest } from "../services/runs.js";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled", "timed_out"]);
const TERMINAL_EVENTS = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED", "RUN_TIMED_OUT"]);

const need = (p: Principal | null): Principal => {
  if (!p) throw new ForbiddenError("no principal");
  return p;
};

async function visibleRun(ctx: ApiContext, p: Principal, id: string): Promise<Run> {
  const run = await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).getRun(id);
  if (!run || run.workspaceId !== p.workspaceId || !canSeeWorkflow(p, run.workflowId))
    throw new NotFoundError(`run ${id} not found`);
  return run;
}

function links(ctx: ApiContext, id: string) {
  const base = ctx.config.baseUrl.replace(/\/$/, "");
  return {
    self: `${base}/v1/runs/${id}`,
    stream: `${base}/v1/runs/${id}/stream`,
    output: `${base}/v1/runs/${id}/output`,
  };
}

function durationMs(run: Run): number {
  return run.endedAt
    ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt ?? run.createdAt))
    : 0;
}

/** Validates a human response against the task's mode (422 on mismatch). */
export function checkResponse(request: HumanRequest, response: HumanResponse): void {
  const mode = request.mode;
  const bad = (m: string) => {
    throw new BadRequestError(m);
  };
  switch (response.action) {
    case "approve":
    case "reject":
      if (mode.type !== "approval" && mode.type !== "review")
        bad(`a ${mode.type} task takes ${mode.type === "choice" ? "choose" : "submit"}`);
      if (
        response.action === "approve" &&
        mode.type === "review" &&
        response.value !== undefined &&
        !ajv.validate(mode.schema as object, response.value)
      )
        bad("the edited value does not match the review schema");
      return;
    case "choose":
      if (mode.type !== "choice") bad(`a ${mode.type} task does not take choose`);
      if (mode.type === "choice" && !mode.options.some((o) => o.id === response.option))
        bad(`unknown option ${response.option}`);
      return;
    case "submit":
      if (mode.type !== "form") bad(`a ${mode.type} task does not take submit`);
      if (mode.type === "form" && !ajv.validate(mode.schema as object, response.value))
        bad(`the form value is invalid: ${ajv.errorsText(ajv.errors)}`);
      return;
    case "escalate":
      return;
  }
}

export function runRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const handleStart = async (
    req: FastifyRequest,
    reply: FastifyReply,
    workflowId: string,
    body: z.infer<typeof RunRequestSchema>,
  ) => {
    const p = need(req.principal);
    const key =
      typeof req.headers["idempotency-key"] === "string"
        ? req.headers["idempotency-key"].slice(0, 200)
        : undefined;
    const request: StartRunRequest = {
      input: body.input as JsonValue,
      mode: body.mode,
      environmentId: body.environmentId,
      versionId: body.versionId,
      draft: body.draft,
      sessionId: body.sessionId,
      variables: body.variables as Record<string, JsonValue> | undefined,
      labels: body.labels,
    };
    const started = await startRun(ctx, p, workflowId, request, { idempotencyKey: key });
    req.audit = {
      resourceId: started.run.id,
      details: { workflowId, mode: body.mode, reused: started.reused },
    };
    const run = started.run;
    const accepted = (status: string, humanTaskId?: string | null) =>
      reply.code(202).send({
        run_id: run.id,
        status,
        links: links(ctx, run.id),
        ...(humanTaskId
          ? {
              human_task: {
                id: humanTaskId,
                url: `${ctx.config.webUrl.replace(/\/$/, "")}/inbox/${humanTaskId}`,
              },
            }
          : {}),
      });
    if (
      body.mode === "async" ||
      (TERMINAL.has(run.status) === false && started.reused && body.mode !== "sync")
    )
      return accepted(run.status);
    const outcome = TERMINAL.has(run.status)
      ? ({ kind: "terminal", run } as const)
      : await waitForRun(ctx, p.workspaceId, run.id, body.waitTimeoutMs);
    if (outcome.kind === "waiting_for_human")
      return accepted("waiting_for_human", outcome.humanTaskId);
    if (outcome.kind === "timeout") return accepted(outcome.run.status);
    const done = outcome.run;
    if (done.status === "completed")
      return reply.code(200).send({
        run_id: done.id,
        status: "completed" as const,
        output: done.output,
        outcome: done.outcome,
        usage: done.usage,
        cost_usd: done.costUsd,
        duration_ms: durationMs(done),
      });
    const err = (done.error ?? {
      code: "INTERNAL",
      message: `run ${done.status}`,
      retryable: false,
    }) as {
      code: string;
      message: string;
      retryable: boolean;
      nodeId?: string;
      nodeRunId?: string;
    };
    const status = done.status === "timed_out" ? 504 : done.status === "cancelled" ? 409 : 500;
    const body2 = envelope(err.code, err.message, req.id, err.retryable);
    return reply.code(status).send({
      error: {
        ...body2.error,
        run_id: done.id,
        ...(err.nodeId ? { node_id: err.nodeId } : {}),
        ...(err.nodeRunId ? { node_run_id: err.nodeRunId } : {}),
      },
    });
  };

  r.post(
    "/v1/workflows/:id/run",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:create",
        audit: { action: "run.create", resource: "run" },
        cli: { noun: "run", verb: "start", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        summary: "Start a run (async, or sync waiting up to waitTimeoutMs)",
        params: IdParams,
        body: RunRequestSchema,
        response: { 200: RunCompletedSchema, 202: RunAcceptedSchema },
      },
    },
    (req, reply) => handleStart(req, reply, req.params.id, req.body),
  );

  r.post(
    "/v1/workflow-versions/:id/run",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:create",
        audit: { action: "run.create", resource: "run" },
        cli: { noun: "run", verb: "start-version", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        params: IdParams,
        body: RunRequestSchema.omit({ versionId: true, draft: true }),
        response: { 200: RunCompletedSchema, 202: RunAcceptedSchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const [v] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select({ workflowId: workflowVersions.workflowId })
          .from(workflowVersions)
          .where(
            and(
              eq(workflowVersions.id, req.params.id),
              eq(workflowVersions.workspaceId, p.workspaceId),
            ),
          ),
      );
      if (!v) throw new NotFoundError("version not found");
      return handleStart(req, reply, v.workflowId, {
        ...req.body,
        versionId: req.params.id,
        draft: false,
      });
    },
  );

  r.get(
    "/v1/runs",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "list" },
      },
      schema: {
        tags: ["runs"],
        querystring: ListQuery.extend({
          workflowId: z.uuid().optional(),
          environmentId: z.uuid().optional(),
          status: z.union([z.string(), z.array(z.string())]).optional(),
          origin: z.string().optional(),
          sessionId: z.string().optional(),
        }),
        response: { 200: page(RunSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      if (req.query.workflowId && !canSeeWorkflow(p, req.query.workflowId))
        return { items: [], next_cursor: null };
      const statuses =
        req.query.status === undefined
          ? undefined
          : ((Array.isArray(req.query.status)
              ? req.query.status
              : req.query.status.split(",")) as Run["status"][]);
      const out = await ctx.db.tenant(p.workspaceId, (tx) =>
        listRuns(tx, {
          workspaceId: p.workspaceId,
          ...(req.query.workflowId ? { workflowId: req.query.workflowId } : {}),
          ...(req.query.environmentId ? { environmentId: req.query.environmentId } : {}),
          ...(statuses ? { status: statuses } : {}),
          ...(req.query.origin ? { origin: req.query.origin as Run["origin"] } : {}),
          ...(req.query.sessionId ? { sessionId: req.query.sessionId } : {}),
          cursor: req.query.cursor ?? null,
          limit: req.query.limit,
        }),
      );
      const items = p.workflowIds
        ? out.items.filter((x) => canSeeWorkflow(p, x.workflowId))
        : out.items;
      return { items, next_cursor: out.nextCursor };
    },
  );

  r.get(
    "/v1/runs/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "get", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        params: IdParams,
        querystring: z.object({ include: z.string().optional() }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      const run = await visibleRun(ctx, p, req.params.id);
      if (req.query.include?.split(",").includes("node_runs"))
        return {
          ...run,
          node_runs: await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).listNodeRuns(
            run.id,
          ),
        };
      return run;
    },
  );

  r.get(
    "/v1/runs/:id/node-runs",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "node-runs", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        params: IdParams,
        querystring: z.object({ nodeId: z.string().optional(), scope: z.string().optional() }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      await visibleRun(ctx, p, req.params.id);
      const all = await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).listNodeRuns(
        req.params.id,
      );
      return all
        .filter(
          (n) =>
            (req.query.nodeId ? n.nodeId === req.query.nodeId : true) &&
            (req.query.scope !== undefined ? n.scope === req.query.scope : true),
        )
        .map((n) => {
          const text = JSON.stringify(n.output ?? null);
          return text.length > 8192 ? { ...n, output: null, truncated: true } : n;
        });
    },
  );

  r.get(
    "/v1/runs/:id/node-runs/:nodeRunId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "node-run", positional: ["id", "nodeRunId"] },
      },
      schema: { tags: ["runs"], params: z.object({ id: z.uuid(), nodeRunId: z.uuid() }) },
    },
    async (req) => {
      const p = need(req.principal);
      await visibleRun(ctx, p, req.params.id);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const [nr] = await tx
          .select()
          .from(nodeRuns)
          .where(and(eq(nodeRuns.id, req.params.nodeRunId), eq(nodeRuns.runId, req.params.id)));
        if (!nr) throw new NotFoundError("node run not found");
        const events = await tx
          .select({ payload: runEvents.payload })
          .from(runEvents)
          .where(
            and(eq(runEvents.runId, req.params.id), eq(runEvents.nodeRunId, req.params.nodeRunId)),
          )
          .orderBy(runEvents.seq);
        const nodeRun = (
          await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).listNodeRuns(req.params.id)
        ).find((n) => n.id === req.params.nodeRunId);
        return { nodeRun, events: events.map((e) => e.payload) };
      });
    },
  );

  r.get(
    "/v1/runs/:id/events",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "events", positional: ["id"] },
      },
      schema: {
        tags: ["events"],
        params: IdParams,
        querystring: z.object({
          after: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(1000).default(200),
          types: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const p = need(req.principal);
      await visibleRun(ctx, p, req.params.id);
      const types = req.query.types?.split(",").filter(Boolean) as
        DurableRunEvent["type"][] | undefined;
      const items = await new PgRunStore(ctx.db, { workspaceId: p.workspaceId }).listEvents(
        req.params.id,
        req.query.after,
        req.query.limit + 1,
        types,
      );
      const pageItems = items.slice(0, req.query.limit);
      return {
        items: pageItems,
        next_cursor: items.length > req.query.limit ? String(pageItems.at(-1)?.seq ?? "") : null,
      };
    },
  );

  r.get(
    "/v1/runs/:id/output",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "run", verb: "output", positional: ["id"] },
      },
      schema: { tags: ["runs"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      const run = await visibleRun(ctx, p, req.params.id);
      if (run.status !== "completed")
        throw new NotFoundError(
          `run ${run.id} is ${run.status}; the output exists once it completes`,
        );
      return { output: run.output, outcome: run.outcome };
    },
  );

  r.post(
    "/v1/runs/:id/cancel",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:cancel",
        audit: { action: "run.cancel", resource: "run" },
        cli: { noun: "run", verb: "cancel", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        params: IdParams,
        body: z.object({ reason: z.string().max(500).optional() }).default({}),
        response: { 202: z.object({ run_id: z.uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const run = await visibleRun(ctx, p, req.params.id);
      if (TERMINAL.has(run.status))
        throw new ConflictError(`run ${run.id} is already ${run.status}`);
      const store = new PgRunStore(ctx.db, { workspaceId: p.workspaceId });
      await store.requestCancel(run.id, `${p.type}:${p.id}`, req.body.reason ?? null);
      // The lease holder picks the flag up on its next heartbeat; a control job reaches idle runs.
      await ctx.queue.enqueue("run:control", {
        type: "run.control",
        runId: run.id,
        action: "cancel",
        by: `${p.type}:${p.id}`,
        reason: req.body.reason ?? null,
      });
      req.audit.details = { reason: req.body.reason ?? null };
      return reply.code(202).send({ run_id: run.id, status: run.status });
    },
  );

  r.post(
    "/v1/runs/:id/replay",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:replay",
        audit: { action: "run.replay", resource: "run" },
        cli: { noun: "run", verb: "replay", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        summary: "Re-execute a run's input on the same (or another) version",
        params: IdParams,
        body: z
          .object({ versionId: z.uuid().optional(), environmentId: z.uuid().optional() })
          .default({}),
        response: { 202: z.object({ run_id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const source = await visibleRun(ctx, p, req.params.id);
      const started = await startRun(
        ctx,
        p,
        source.workflowId,
        {
          input: source.input,
          mode: "async",
          environmentId: req.body.environmentId ?? source.environmentId,
          versionId: req.body.versionId ?? source.workflowVersionId,
          labels: source.labels,
        },
        { origin: "replay", sourceRunId: source.id },
      );
      req.audit.details = { newRunId: started.run.id };
      return reply.code(202).send({ run_id: started.run.id });
    },
  );

  r.delete(
    "/v1/runs/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:delete",
        audit: { action: "run.purge", resource: "run" },
        cli: { noun: "run", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["runs"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const run = await visibleRun(ctx, p, req.params.id);
      if (!TERMINAL.has(run.status)) throw new ConflictError("cancel the run before purging it");
      await ctx.db.tenant(p.workspaceId, (tx) => tx.delete(runs).where(eq(runs.id, run.id)));
      return reply.code(204).send(null);
    },
  );

  // SSE (§5)
  const streams = new Map<string, number>();
  r.get(
    "/v1/runs/:id/stream",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        rateLimit: false,
        cli: { noun: "run", verb: "stream", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        summary: "Server-sent events: replay after Last-Event-ID, then live",
        params: IdParams,
        querystring: z.object({
          after: z.coerce.number().int().min(0).optional(),
          types: z.string().optional(),
          include: z.string().optional(),
          until: z.enum(["terminal", "suspend", "never"]).default("terminal"),
        }),
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const run = await visibleRun(ctx, p, req.params.id);
      const principalKey = `${p.type}:${p.id}`;
      const open = streams.get(principalKey) ?? 0;
      if (open >= ctx.config.sseMaxStreamsPerPrincipal)
        throw new RateLimitError(
          `at most ${ctx.config.sseMaxStreamsPerPrincipal} concurrent streams`,
        );
      const lastId = Number(req.headers["last-event-id"] ?? req.query.after ?? 0);
      if (!Number.isFinite(lastId) || lastId < 0)
        throw new BadRequestError("invalid Last-Event-ID");
      const types = req.query.types ? new Set(req.query.types.split(",")) : null;
      const include = new Set((req.query.include ?? "deltas").split(","));
      const store = new PgRunStore(ctx.db, { workspaceId: p.workspaceId });

      streams.set(principalKey, open + 1);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": req.id,
      });
      let closed = false;
      let seen = lastId;
      let busy = false;
      let again = false;
      const write = (chunk: string) => {
        if (!closed) res.write(chunk);
      };
      const finish = (reason: string) => {
        if (closed) return;
        write(`event: END\ndata: ${JSON.stringify({ run_id: run.id, final_status: reason })}\n\n`);
        close();
      };
      const pump = async (): Promise<void> => {
        if (busy) {
          again = true;
          return;
        }
        busy = true;
        try {
          do {
            again = false;
            for (;;) {
              const events = await store.listEvents(run.id, seen, 500);
              for (const e of events) {
                seen = e.seq;
                if (!types || types.has(e.type))
                  write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
                if (TERMINAL_EVENTS.has(e.type) && req.query.until !== "never")
                  return finish(e.type.replace("RUN_", "").toLowerCase());
                if (e.type === "RUN_WAITING" && req.query.until === "suspend")
                  return finish("waiting");
              }
              if (events.length < 500) break;
            }
          } while (again && !closed);
        } catch (error) {
          req.log.error({ err: error }, "SSE pump failed");
          close();
        } finally {
          busy = false;
        }
      };
      const stop = await ctx.hub.listen(run.id, {
        durable: () => void pump(),
        ephemeral: (event) => {
          const type = (event as { type?: string }).type;
          if (type === "GENERATION_DELTA" && include.has("deltas"))
            write(`event: GENERATION_DELTA\ndata: ${JSON.stringify(event)}\n\n`);
          if (type === "LOG" && include.has("logs"))
            write(`event: LOG\ndata: ${JSON.stringify(event)}\n\n`);
        },
      });
      const heartbeat = setInterval(() => {
        // Re-check the principal: an expired session or revoked key ends the stream.
        const expired = p.exp !== undefined && p.exp * 1000 <= Date.now();
        if (expired) return finishUnauthorized();
        write(": heartbeat\n\n");
      }, 15_000);
      heartbeat.unref();
      const finishUnauthorized = () => {
        write(
          `event: END\ndata: ${JSON.stringify({ run_id: run.id, reason: "unauthorized" })}\n\n`,
        );
        close();
      };
      function close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        stop();
        streams.set(principalKey, Math.max(0, (streams.get(principalKey) ?? 1) - 1));
        res.end();
      }
      req.raw.on("close", close);
      write(`retry: 2000\n: connected run=${run.id} after=${lastId}\n\n`);
      await pump();
    },
  );

  // Human tasks (§3.5)
  r.get(
    "/v1/human-tasks",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "task", verb: "list" },
      },
      schema: {
        tags: ["human-tasks"],
        querystring: ListQuery.extend({
          status: z.enum(["open", "responded", "expired", "cancelled"]).optional(),
          workflowId: z.uuid().optional(),
          assignedToMe: z.coerce.boolean().default(false),
        }),
        response: { 200: page(HumanTaskSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const cursor = decodeCursor(req.query.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(humanTasks)
          .where(
            and(
              eq(humanTasks.workspaceId, p.workspaceId),
              req.query.status ? eq(humanTasks.status, req.query.status) : undefined,
              req.query.workflowId ? eq(humanTasks.workflowId, req.query.workflowId) : undefined,
              p.workflowIds
                ? p.workflowIds.size
                  ? inArray(humanTasks.workflowId, [...p.workflowIds])
                  : sql`false`
                : undefined,
              req.query.assignedToMe && p.userId
                ? sql`(${humanTasks.assignees} = '[]'::jsonb or ${humanTasks.assignees} @> ${JSON.stringify([p.userId])}::jsonb)`
                : undefined,
              cursor
                ? or(
                    lt(humanTasks.createdAt, new Date(String(cursor[0]))),
                    and(
                      eq(humanTasks.createdAt, new Date(String(cursor[0]))),
                      lt(humanTasks.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(humanTasks.createdAt), desc(humanTasks.id))
          .limit(req.query.limit + 1),
      );
      const items = rows.slice(0, req.query.limit);
      const last = items.at(-1);
      return {
        items: items.map((t) => ({ ...toHumanTask(t), assignees: t.assignees })),
        next_cursor:
          rows.length > req.query.limit && last
            ? encodeCursor(last.createdAt.toISOString(), last.id)
            : null,
      };
    },
  );

  const loadTask = async (tx: Tx, p: Principal, id: string) => {
    const [t] = await tx
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.id, id), eq(humanTasks.workspaceId, p.workspaceId)));
    if (!t || !canSeeWorkflow(p, t.workflowId)) throw new NotFoundError("task not found");
    return t;
  };

  r.get(
    "/v1/human-tasks/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "task", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["human-tasks"], params: IdParams },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const t = await loadTask(tx, p, req.params.id);
        const [run] = await tx
          .select({ id: runs.id, status: runs.status, workflowId: runs.workflowId })
          .from(runs)
          .where(eq(runs.id, t.runId));
        return {
          task: { ...toHumanTask(t), assignees: t.assignees },
          run,
          node: { id: t.nodeId },
          request: t.request,
        };
      });
    },
  );

  r.post(
    "/v1/human-tasks/:id/respond",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:approve",
        audit: { action: "human_task.respond", resource: "human_task" },
        cli: { noun: "task", verb: "respond", positional: ["id"] },
      },
      schema: {
        tags: ["human-tasks"],
        params: IdParams,
        body: z.object({ response: HumanResponseSchema }),
        response: { 202: z.object({ run_id: z.uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const out = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const t = await loadTask(tx, p, req.params.id);
        if (t.status !== "open") throw new ConflictError(`the task is already ${t.status}`);
        if (
          t.assignees.length > 0 &&
          p.userId &&
          !t.assignees.includes(p.userId) &&
          !p.scopes.has("admin")
        )
          throw new ForbiddenError("the task is assigned to someone else");
        const response = req.body.response;
        if (response.action === "escalate") {
          await tx
            .update(humanTasks)
            .set({ assignees: response.to, escalatedAt: new Date() })
            .where(eq(humanTasks.id, t.id));
          return { runId: t.runId, status: "open", resumed: false };
        }
        checkResponse(t.request, response);
        const [updated] = await tx
          .update(humanTasks)
          .set({
            status: "responded",
            response,
            respondedBy: p.userId ?? `${p.type}:${p.id}`,
            respondedAt: new Date(),
          })
          .where(and(eq(humanTasks.id, t.id), eq(humanTasks.status, "open")))
          .returning({ id: humanTasks.id });
        if (!updated) throw new ConflictError("the task was answered concurrently");
        return { runId: t.runId, status: "responded", resumed: true };
      });
      if (out.resumed)
        await ctx.queue.enqueue("run:general", {
          type: "run.resume",
          runId: out.runId,
          reason: "human",
        });
      req.audit.details = { runId: out.runId, action: req.body.response.action };
      return reply.code(202).send({ run_id: out.runId, status: out.status });
    },
  );

  r.post(
    "/v1/human-tasks/:id/reassign",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:approve",
        audit: { action: "human_task.reassign", resource: "human_task" },
        cli: { noun: "task", verb: "reassign", positional: ["id"] },
      },
      schema: {
        tags: ["human-tasks"],
        params: IdParams,
        body: z.object({
          assignees: z.array(z.string().min(1)).max(50),
          comment: z.string().max(2000).optional(),
        }),
        response: { 200: HumanTaskSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const t = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await loadTask(tx, p, req.params.id);
        if (cur.status !== "open") throw new ConflictError(`the task is already ${cur.status}`);
        const [u] = await tx
          .update(humanTasks)
          .set({ assignees: req.body.assignees })
          .where(eq(humanTasks.id, cur.id))
          .returning();
        return u as typeof cur;
      });
      req.audit.details = { assignees: req.body.assignees };
      return { ...toHumanTask(t), assignees: t.assignees };
    },
  );
}
