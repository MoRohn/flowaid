/**
 * `GET /v1/insights` (FLOWAID_V2_ROADMAP 4.1): what needs attention (open approvals, workflows
 * with failed runs) and what changed per workflow in the recent window against its baseline,
 * each insight with the evidence it rests on (sample sizes, effect, test, p- and q-value).
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ForbiddenError } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import { INSIGHT_WINDOWS, insightsReport, type InsightWindow } from "../services/insights.js";

const Summary = z.object({
  value: z.number(),
  n: z.int(),
  interval: z.object({ lo: z.number(), hi: z.number() }).optional(),
});

export const InsightSchema = z.object({
  id: z.string(),
  kind: z.enum(["failure_rate", "latency", "cost", "confidence_drop", "new_error"]),
  severity: z.enum(["critical", "warning", "info"]),
  workflowId: z.string(),
  workflowName: z.string(),
  title: z.string(),
  summary: z.string(),
  evidence: z.object({
    metric: z.string(),
    recent: Summary,
    baseline: Summary,
    effect: z.object({ ratio: z.number().optional(), points: z.number().optional() }),
    test: z.enum(["fisher_exact", "mann_whitney_u", "novelty"]),
    pValue: z.number().nullable(),
    qValue: z.number().nullable(),
  }),
  attribution: z
    .object({ versionId: z.string(), version: z.int().nullable(), share: z.number() })
    .optional(),
});

export const InsightsReportSchema = z.object({
  computedAt: z.string(),
  window: z.object({ from: z.string(), to: z.string() }),
  baseline: z.object({ from: z.string(), to: z.string() }),
  attention: z.object({
    openApprovals: z.object({
      count: z.int(),
      oldestAt: z.string().nullable(),
      expiringSoon: z.int(),
    }),
    failingWorkflows: z.array(
      z.object({
        workflowId: z.string(),
        workflowName: z.string(),
        failed: z.int(),
        finished: z.int(),
      }),
    ),
  }),
  insights: z.array(InsightSchema),
});

export function insightRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/v1/insights",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        cli: { noun: "insights", verb: "get" },
      },
      schema: {
        tags: ["metrics"],
        summary: "What needs attention and what changed, per workflow, with evidence",
        querystring: z.object({
          /** the recent window; the baseline is the four windows before it */
          window: z
            .enum(Object.keys(INSIGHT_WINDOWS) as [InsightWindow, ...InsightWindow[]])
            .default("7d"),
          workflowId: z.uuid().optional(),
          environmentId: z.uuid().optional(),
        }),
        response: { 200: InsightsReportSchema },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      return ctx.db.tenant(p.workspaceId, (tx) =>
        insightsReport(tx, {
          workspaceId: p.workspaceId,
          now: new Date(ctx.clock.now()),
          window: req.query.window,
          workflowId: req.query.workflowId,
          environmentId: req.query.environmentId ?? p.environmentId ?? undefined,
          workflowIds: p.workflowIds ? [...p.workflowIds] : null,
        }),
      );
    },
  );
}
