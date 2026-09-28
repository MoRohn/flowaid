/**
 * Metrics for the dashboard (API.md §3, P6-04): `GET /v1/metrics/overview` → `DashboardMetrics`,
 * `GET /v1/metrics/timeseries` → bucketed series, and `GET /v1/alerts/deliveries`, the log of
 * observability alerts sent to notification channels.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { alertDeliveries } from "@flowaid/database";
import { BadRequestError, ForbiddenError } from "@flowaid/workflow-core";
import { assertEnvironmentAllowed, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { BUCKETS, dashboardMetrics, metricsTimeseries, type Bucket } from "../services/metrics.js";

const DAY = 86_400_000;
const MAX_RANGE = 400 * DAY;

const Filters = z.object({
  workflowId: z.uuid().optional(),
  environmentId: z.uuid().optional(),
  versionId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** `production` (default): API, UI, webhook, schedule, MCP and subflow runs; `all` adds evaluations, replays, restarts and forks */
  origin: z.enum(["production", "all"]).default("production"),
});

const Nullable = z.number().nullable();
const DashboardMetricsSchema = z.object({
  from: z.string(),
  to: z.string(),
  runs: z.object({ total: z.int(), byStatus: z.record(z.string(), z.int()) }),
  successRate: Nullable,
  errorRate: Nullable,
  latencyMs: z.object({ p50: Nullable, p95: Nullable, p99: Nullable }),
  aiCostUsd: z.number(),
  tokens: z.object({ input: z.number(), output: z.number() }),
  toolLatencyMs: z.object({ p50: Nullable, p95: Nullable }),
  decisionConfidence: z.object({
    histogram: z.array(z.object({ lo: z.number(), hi: z.number(), count: z.int() })),
    mean: Nullable,
  }),
  humanReviewRate: Nullable,
  retryRate: Nullable,
  providerFailures: z.array(z.object({ provider: z.string(), code: z.string(), count: z.int() })),
});

const SeriesSchema = z.object({
  bucket: z.enum(Object.keys(BUCKETS) as [Bucket, ...Bucket[]]),
  timestamps: z.array(z.string()),
  series: z.object({
    runs: z.array(z.int()),
    failed: z.array(z.int()),
    costUsd: z.array(z.number()),
    p95LatencyMs: z.array(Nullable),
    humanReviews: z.array(z.int()),
  }),
});

function range(q: z.infer<typeof Filters>, now: number, defaultMs: number) {
  const to = q.to ? new Date(q.to) : new Date(now);
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultMs);
  if (!(from < to)) throw new BadRequestError("from must be before to");
  if (to.getTime() - from.getTime() > MAX_RANGE)
    throw new BadRequestError("the range may span at most 400 days");
  return { from, to };
}

export function metricsRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null | undefined): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const filterOf = (p: Principal, q: z.infer<typeof Filters>, defaultMs: number) => {
    if (q.environmentId) assertEnvironmentAllowed(p, q.environmentId);
    return filterFields(p, q, defaultMs);
  };
  const filterFields = (p: Principal, q: z.infer<typeof Filters>, defaultMs: number) => ({
    workspaceId: p.workspaceId,
    ...range(q, ctx.clock.now(), defaultMs),
    workflowId: q.workflowId,
    environmentId: q.environmentId ?? p.environmentId ?? undefined,
    versionId: q.versionId,
    workflowIds: p.workflowIds ? [...p.workflowIds] : null,
    origin: q.origin,
  });

  r.get(
    "/v1/metrics/overview",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "metrics", verb: "overview" },
      },
      schema: {
        tags: ["metrics"],
        summary: "Runs, success, latency, cost, confidence and review rates for a time range",
        querystring: Filters,
        response: { 200: DashboardMetricsSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const f = filterOf(p, req.query, DAY);
      return ctx.db.tenant(p.workspaceId, (tx) => dashboardMetrics(tx, f));
    },
  );

  r.get(
    "/v1/metrics/timeseries",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "metrics", verb: "timeseries" },
      },
      schema: {
        tags: ["metrics"],
        summary: "Runs, failures, cost, p95 latency and human reviews per time bucket",
        querystring: Filters.extend({
          bucket: z.enum(Object.keys(BUCKETS) as [Bucket, ...Bucket[]]).default("1h"),
        }),
        response: { 200: SeriesSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const f = filterOf(p, req.query, DAY);
      const buckets =
        (f.to.getTime() - f.from.getTime()) /
        { "1m": 60_000, "1h": 3_600_000, "1d": DAY }[req.query.bucket];
      if (buckets > 2000)
        throw new BadRequestError("too many buckets: widen the bucket or shorten the range");
      return ctx.db.tenant(p.workspaceId, (tx) => metricsTimeseries(tx, f, req.query.bucket));
    },
  );

  r.get(
    "/v1/alerts/deliveries",
    {
      config: {
        auth: "session_or_api_key",
        scope: "audit:read",
        cli: { noun: "alerts", verb: "deliveries" },
      },
      schema: {
        tags: ["metrics"],
        summary: "Observability alerts sent (or attempted) to notification channels, newest first",
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          before: z.iso.datetime({ offset: true }).optional(),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                channelId: z.string(),
                event: z.string(),
                key: z.string(),
                status: z.string(),
                error: z.string().nullable(),
                createdAt: z.string(),
                sentAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(alertDeliveries)
          .where(
            and(
              eq(alertDeliveries.workspaceId, p.workspaceId),
              req.query.before
                ? lt(alertDeliveries.createdAt, new Date(req.query.before))
                : undefined,
            ),
          )
          .orderBy(desc(alertDeliveries.createdAt))
          .limit(req.query.limit),
      );
      return {
        items: rows.map((d) => ({
          id: d.id,
          channelId: d.channelId,
          event: d.event,
          key: d.key,
          status: d.status,
          error: d.error,
          createdAt: d.createdAt.toISOString(),
          sentAt: d.sentAt ? d.sentAt.toISOString() : null,
        })),
      };
    },
  );
}
