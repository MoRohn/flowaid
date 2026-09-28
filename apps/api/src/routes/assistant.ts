/**
 * Ask FlowAId (FLOWAID_V2_ROADMAP 4.2): `POST /v1/assistant/ask { question, history? }` answers a
 * question about the workspace with read-only tools (`services/assistant.ts`) and returns typed,
 * cited statements. It changes nothing. The audit records the model, tool names, rounds and cost,
 * not the question.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ask } from "@flowaid/advisor";
import { ConflictError, ForbiddenError } from "@flowaid/workflow-core";
import { uuidv7 } from "@flowaid/shared";
import type { ApiContext } from "../context.js";
import { assistantTools } from "../services/assistant.js";
import { advisorModel, registryOf, resolveContext } from "../services/advisor.js";

/** spend limit per question */
const MAX_COST_USD = 0.25;

const SourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["workflow", "run", "task", "insight", "metrics"]),
  label: z.string(),
  workflowId: z.string().optional(),
});

export const AssistantAnswerSchema = z.object({
  statements: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["fact", "calculation", "recommendation", "uncertain"]),
      sources: z.array(z.string()),
      unverified: z.literal(true).optional(),
    }),
  ),
  sources: z.array(SourceSchema),
  toolCalls: z.array(z.object({ name: z.string(), ok: z.boolean() })),
  rounds: z.int(),
  stopped: z.enum(["rounds", "budget"]).nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  costUsd: z.number(),
  promptHash: z.string(),
  model: z.object({ provider: z.string(), model: z.string() }),
});

export function assistantRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/v1/assistant/ask",
    {
      config: {
        auth: "session_or_api_key",
        scope: "runs:read",
        audit: { action: "assistant.ask", resource: "workspace" },
        rateLimit: { max: 20, timeWindow: 60_000 },
        cli: { noun: "assistant", verb: "ask" },
      },
      schema: {
        tags: ["assistant"],
        summary: "Ask a question about this workspace; the answer cites the records it rests on",
        body: z.object({
          question: z.string().trim().min(3).max(2000),
          /** earlier turns of this conversation, oldest first */
          history: z
            .array(
              z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(4000),
              }),
            )
            .max(12)
            .optional(),
        }),
        response: { 200: AssistantAnswerSchema },
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
      const provider = await registryOf(ctx).generation(
        model.ref,
        resolveContext(ctx, p.workspaceId),
      );
      const controller = new AbortController();
      req.raw.once("close", () => {
        if (!req.raw.complete) controller.abort();
      });
      const answer = await ask({
        question: req.body.question,
        ...(req.body.history ? { history: req.body.history } : {}),
        tools: assistantTools(ctx, p),
        generate: (request) =>
          provider.generate(request, {
            signal: controller.signal,
            runId: "assistant",
            nodeRunId: uuidv7(),
            idempotencyKey: null,
          }),
        maxCostUsd: MAX_COST_USD,
        now: new Date(ctx.clock.now()),
      });
      req.audit = {
        resourceId: p.workspaceId,
        details: {
          model: `${model.ref.provider}/${model.ref.model}`,
          tools: answer.toolCalls.map((c) => c.name),
          rounds: answer.rounds,
          stopped: answer.stopped,
          costUsd: answer.costUsd,
          promptHash: answer.promptHash,
          statements: answer.statements.length,
          unverified: answer.statements.filter((s) => s.unverified).length,
        },
      };
      return { ...answer, model: model.ref };
    },
  );
}
