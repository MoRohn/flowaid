/**
 * `POST /v1/workflows/:id/optimize` (P6-02): the cost optimizer over the draft (or a definition
 * the builder sends) and 30 days of the workflow's node runs. Suggestions come back as data and as
 * `I_COST_SUGGESTION` diagnostics (RFC-0020) the Problems panel lists with quick-fixes.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { optimize, suggestionDiagnostics } from "@flowaid/advisor";
import { WorkflowDefinitionSchema, ForbiddenError, BadRequestError } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import { IdParams } from "../dto/common.js";
import { DiagnosticSchema } from "../dto/workflows.js";
import { compileIn, loadCompileContext } from "../services/compile.js";
import { visibleWorkflow } from "../services/workflows.js";
import { evalSignal, nodeStats, registryOf } from "../services/advisor.js";
import { withId } from "./workflows.js";

export const SuggestionSchema = z.object({
  id: z.string(),
  kind: z.enum(["cheaper_model", "batch_decisions", "cache_safe_node", "tighten_bounds"]),
  nodeIds: z.array(z.string()),
  title: z.string(),
  rationale: z.string(),
  estimatedSavingsUsdPerRun: z.number(),
  currentCostUsdPerRun: z.number(),
  latencyDeltaMs: z.number(),
  risk: z.enum(["low", "medium", "high"]),
  qualityImpact: z.string(),
  /** RFC 6902 operations against the definition; empty when the change is manual */
  fix: z.array(z.record(z.string(), z.unknown())),
});

export function optimizeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/v1/workflows/:id/optimize",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        audit: false,
        cli: { noun: "workflow", verb: "optimize", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "Cost suggestions from 30 days of the workflow's runs",
        params: IdParams,
        body: z
          .object({
            /** the definition to analyse (default: the saved draft) */
            definition: z.unknown().optional(),
            days: z.int().min(1).max(90).default(30),
          })
          .default({ days: 30 }),
        response: {
          200: z.object({
            suggestions: z.array(SuggestionSchema),
            diagnostics: z.array(DiagnosticSchema),
            window: z.object({ days: z.int(), from: z.string(), runs: z.int() }),
          }),
        },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const since = new Date(ctx.clock.now() - req.body.days * 86_400_000);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const raw = withId(req.body.definition ?? w.draft, w.id);
        const parsed = WorkflowDefinitionSchema.safeParse(raw);
        if (!parsed.success) throw new BadRequestError("the definition does not parse");
        const compiled = await compileIn(tx, parsed.data, {
          workspaceId: p.workspaceId,
          level: "draft",
        });
        const window = { days: req.body.days, from: since.toISOString(), runs: 0 };
        if (!compiled.ok) return { suggestions: [], diagnostics: [], window };
        const catalog = (
          await loadCompileContext(tx, { workspaceId: p.workspaceId, level: "draft" })
        ).catalog;
        const stats = await nodeStats(tx, p.workspaceId, w.id, parsed.data, since);
        const suggestions = optimize({
          definition: parsed.data,
          plan: compiled.plan,
          stats,
          catalog: registryOf(ctx).catalog,
          manifests: (type, version) => catalog.get(type, version),
          evaluation: await evalSignal(tx, w.evaluationSetId),
        });
        return {
          suggestions,
          diagnostics: suggestionDiagnostics(suggestions),
          window: { ...window, runs: Math.max(0, ...stats.map((s) => s.runs)) },
        };
      });
    },
  );
}
