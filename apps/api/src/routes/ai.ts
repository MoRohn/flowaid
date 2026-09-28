/**
 * The AI builder and the critic (P6-02).
 *
 * - `POST /v1/workflows/ai/generate { prompt, baseDefinition?, workflowId?, catalogFilter? }` →
 *   `{ definition, diagnostics, rationale, iterations, … }`: structured generation with the
 *   workspace's catalog and a compiler repair loop. Nothing is saved: the client creates the
 *   workflow (or saves the draft) when a person accepts the result.
 * - `POST /v1/workflows/:id/ai/critique { definition?, judge? }` → `Advice[]`: the rubric, plus
 *   an optional yes/no judge through the workspace's decision chain. A judged critique calls a
 *   model, so it is rate-limited like generation (20 a minute per principal); the rubric alone
 *   is cheap and keeps a looser limit of its own.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CRITIC_CHECKS, critique, generateWorkflow, type Judge } from "@flowaid/advisor";
import { compile } from "@flowaid/workflow-compiler";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  WorkflowDefinitionSchema,
  type NodeManifest,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import { uuidv7 } from "@flowaid/shared";
import type { ApiContext } from "../context.js";
import { IdParams } from "../dto/common.js";
import { DiagnosticSchema } from "../dto/workflows.js";
import { compileIn, loadCompileContext } from "../services/compile.js";
import { visibleWorkflow } from "../services/workflows.js";
import {
  advisorModel,
  costContext,
  judgeHop,
  registryOf,
  resolveContext,
  workspaceFailover,
} from "../services/advisor.js";
import { withId } from "./workflows.js";

const AdviceSchema = z.object({
  id: z.string(),
  rule: z.string(),
  source: z.enum(["rubric", "judge"]),
  severity: z.enum(["error", "warning", "suggestion"]),
  category: z.enum(["cost", "safety", "reliability", "correctness", "performance", "style"]),
  title: z.string(),
  detail: z.string(),
  nodeIds: z.array(z.string()),
  fix: z
    .object({ title: z.string(), patch: z.array(z.record(z.string(), z.unknown())) })
    .optional(),
});

const callCtx = (signal: AbortSignal) => ({
  signal,
  runId: "advisor",
  nodeRunId: uuidv7(),
  idempotencyKey: null,
});

/** Model-backed AI calls a principal may make per minute (generation, judged critiques). */
const AI_CALLS_PER_MINUTE = 20;
const RUBRIC_CALLS_PER_MINUTE = 300;

/** Whether a critique request asks for the judge (the body is parsed by the rate-limit hook). */
const wantsJudge = (req: FastifyRequest) =>
  (req.body as { judge?: unknown } | undefined)?.judge === true;

/** The global limiter's key for the caller: session, API key, else IP. */
function principalKey(req: FastifyRequest): string {
  const p = req.principal;
  if (!p) return `ip:${req.ip}`;
  return p.type === "user" ? `sid:${p.sid ?? p.id}` : `key:${p.id}`;
}

function parseDefinition(raw: unknown): WorkflowDefinition {
  const parsed = WorkflowDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestError("the definition does not parse");
  return parsed.data;
}

export function aiRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/v1/workflows/ai/generate",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:write",
        audit: { action: "workflow.ai_generate", resource: "workflow" },
        rateLimit: { max: AI_CALLS_PER_MINUTE, timeWindow: 60_000 },
        cli: { noun: "workflow", verb: "ai-generate" },
      },
      schema: {
        tags: ["workflows"],
        summary: "Draft a workflow from a description (not saved until accepted)",
        body: z.object({
          prompt: z.string().min(3).max(8000),
          /** refine this definition instead of starting from nothing */
          baseDefinition: z.unknown().optional(),
          /** refine this workflow's saved draft */
          workflowId: z.uuid().optional(),
          catalogFilter: z
            .object({
              categories: z.array(z.string()).max(20).optional(),
              types: z.array(z.string()).max(200).optional(),
            })
            .optional(),
        }),
        response: {
          200: z.object({
            definition: z.unknown().nullable(),
            diagnostics: z.array(DiagnosticSchema),
            rationale: z.string(),
            iterations: z.int(),
            model: z.object({ provider: z.string(), model: z.string() }),
            usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
            costUsd: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const model = await advisorModel(ctx, p.workspaceId);
      if (!model)
        throw new ConflictError(
          "No generation model is available: add an Anthropic, OpenAI or Ollama credential, or set the workspace's advisorModel",
        );
      const { base, compileContext } = await ctx.db.tenant(p.workspaceId, async (tx) => {
        let base: WorkflowDefinition | undefined;
        if (req.body.workflowId) {
          const w = await visibleWorkflow(tx, p, req.body.workflowId);
          base = parseDefinition(withId(w.draft, w.id));
        } else if (req.body.baseDefinition !== undefined)
          base = parseDefinition(req.body.baseDefinition);
        return {
          base,
          compileContext: await loadCompileContext(tx, {
            workspaceId: p.workspaceId,
            level: "draft",
          }),
        };
      });
      const filter = req.body.catalogFilter;
      const manifests: NodeManifest[] = compileContext.catalog
        .list()
        .filter((m) => !m.metadata.deprecated)
        .filter(
          (m) =>
            !filter ||
            (filter.types?.includes(m.id) ?? false) ||
            (filter.categories?.includes(m.metadata.category) ?? false),
        );
      const provider = await registryOf(ctx).generation(
        model.ref,
        resolveContext(ctx, p.workspaceId),
      );
      const controller = new AbortController();
      req.raw.once("close", () => {
        if (!req.raw.complete) controller.abort();
      });
      const out = await generateWorkflow({
        prompt: req.body.prompt,
        ...(base ? { baseDefinition: base } : {}),
        manifests,
        generate: (request) => provider.generate(request, callCtx(controller.signal)),
        compile: (definition) => compile(definition, compileContext),
        jsonSchema: model.jsonSchema,
        newId: () => uuidv7(),
      });
      req.audit = {
        ...(req.body.workflowId ? { resourceId: req.body.workflowId } : {}),
        details: {
          model: `${model.ref.provider}/${model.ref.model}`,
          iterations: out.iterations,
          costUsd: out.costUsd,
          promptHash: out.promptHash,
          safetyFindings: out.safety.map((a) => a.rule),
          ok: out.definition !== null && !out.diagnostics.some((d) => d.severity === "error"),
        },
      };
      return { ...out, model: model.ref };
    },
  );

  r.post(
    "/v1/workflows/:id/ai/critique",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        audit: false,
        // judged and plain critiques count in separate buckets: only the judge calls a model
        rateLimit: {
          max: (req: FastifyRequest) =>
            wantsJudge(req) ? AI_CALLS_PER_MINUTE : RUBRIC_CALLS_PER_MINUTE,
          timeWindow: 60_000,
          keyGenerator: (req: FastifyRequest) =>
            `${wantsJudge(req) ? "critic-judge" : "critic"}:${principalKey(req)}`,
        },
        cli: { noun: "workflow", verb: "critique", positional: ["id"] },
      },
      schema: {
        tags: ["workflows"],
        summary: "Review a workflow against the rubric (and, optionally, a decision judge)",
        params: IdParams,
        body: z
          .object({
            definition: z.unknown().optional(),
            judge: z.boolean().default(false),
          })
          .default({ judge: false }),
        response: {
          200: z.object({
            advice: z.array(AdviceSchema),
            checks: z.array(z.string()),
            reviewedAt: z.string(),
          }),
        },
      },
    },
    async (req) => {
      const p = req.principal;
      if (!p) throw new ForbiddenError("no principal");
      const since = new Date(ctx.clock.now() - 30 * 86_400_000);
      const prepared = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const w = await visibleWorkflow(tx, p, req.params.id);
        const definition = parseDefinition(withId(req.body.definition ?? w.draft, w.id));
        const compiled = await compileIn(tx, definition, {
          workspaceId: p.workspaceId,
          level: "draft",
        });
        const { catalog } = await loadCompileContext(tx, {
          workspaceId: p.workspaceId,
          level: "draft",
        });
        return {
          w,
          definition,
          compiled,
          catalog,
          cost: await costContext(tx, p.workspaceId, w.id, since),
          failover: await workspaceFailover(tx, p.workspaceId),
          hop: req.body.judge ? await judgeHop(tx, p.workspaceId, definition) : null,
        };
      });
      let judge: Judge | undefined;
      if (prepared.hop) {
        const decider = await registryOf(ctx).decision(
          prepared.hop,
          resolveContext(ctx, p.workspaceId),
        );
        if (!decider) throw new BadRequestError(`the ${prepared.hop.provider} hop cannot judge`);
        judge = (state, question) =>
          decider.decideBoolean(
            state as never,
            { kind: "boolean", ...question },
            callCtx(new AbortController().signal),
          );
      }
      const advice = await critique(
        {
          definition: prepared.definition,
          plan: prepared.compiled.ok ? prepared.compiled.plan : null,
          diagnostics: prepared.compiled.diagnostics,
          manifests: (type, version) => prepared.catalog.get(type, version),
          workflow: { evaluationSetId: prepared.w.evaluationSetId },
          defaultFailover: prepared.failover,
          budget: prepared.cost.budget,
          suggestedMaxCostUsd: prepared.cost.suggestedMaxCostUsd,
        },
        judge,
      );
      return {
        advice,
        checks: [...CRITIC_CHECKS],
        reviewedAt: new Date(ctx.clock.now()).toISOString(),
      };
    },
  );
}
