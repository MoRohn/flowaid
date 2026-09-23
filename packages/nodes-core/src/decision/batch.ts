import { z } from "zod";
import { defineNode, ok, suspend } from "@flowaid/node-sdk";
import { HumanFallbackSignal } from "@flowaid/providers";
import type {
  DecisionQuestion,
  DecisionResult,
  JsonObject,
  JsonValue,
} from "@flowaid/workflow-core";
import { LLM_SLOT, callCtx, decisionState, humanDecision } from "../common.js";

const question = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("boolean").meta({ "x-jsonSchema": { const: "boolean" } }),
    instructions: z.string().min(1),
    criteria: z.strictObject({ true: z.string(), false: z.string() }).optional(),
  }),
  z.strictObject({
    kind: z.literal("choice").meta({ "x-jsonSchema": { const: "choice" } }),
    instructions: z.string().min(1),
    options: z
      .record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string())
      .meta({ minProperties: 2, maxProperties: 255 }),
  }),
  z.strictObject({
    kind: z.literal("score").meta({ "x-jsonSchema": { const: "score" } }),
    instructions: z.string().min(1),
    levels: z.array(z.string()).min(2).max(10),
  }),
]);

export const batchNode = defineNode({
  id: "flowaid.decision.batch",
  version: "1.0.0",
  metadata: {
    name: "Decision batch",
    description:
      "Asks several typed questions (boolean, choice, score) about one `state` in a single TypeSafe request. Output `answers` holds one DecisionResult per question id.",
    category: "decision",
    icon: "list-checks",
    tags: ["decision", "typesafe", "batch"],
    summary: "{{ config.questions | json }}",
  },
  configSchema: z.strictObject({
    questions: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), question).meta({
      minProperties: 1,
      maxProperties: 32,
      "x-ui": {
        widget: "questions",
        help: "Question id → question. Ids become the keys of `answers`.",
      },
    }),
  }),
  inputSchema: z.object({ state: decisionState }),
  outputSchema: z.object({
    answers: z
      .record(z.string(), z.unknown())
      .describe("One DecisionResult per question id (typed per question by the compiler)."),
  }),
  portRules: [{ kind: "decisionAnswersFromConfig", port: "answers", path: "/questions" }],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: true }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "batch" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const questions = ctx.config.questions as Record<string, DecisionQuestion>;
    if (ctx.resume?.kind === "human") {
      // Failover answered by a person: `value` maps question ids to an option id / "yes" / a level.
      const values =
        ctx.resume.response.action === "submit"
          ? ((ctx.resume.response.value ?? {}) as Record<string, JsonValue>)
          : {};
      const by = ctx.resume.by;
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, q]) => {
          const v = values[id];
          const response =
            q.kind === "boolean"
              ? ({ action: v === true || v === "yes" ? "approve" : "reject" } as const)
              : ({ action: "choose", option: typeof v === "string" ? v : "" } as const);
          return [id, humanDecision(q, response, by)];
        }),
      );
      return ok({ answers });
    }
    const provider = ctx.providers.decision([]);
    try {
      let answers: Record<string, DecisionResult>;
      if (
        provider.capabilities.batch &&
        Object.keys(questions).length <= provider.capabilities.maxQuestions
      ) {
        answers = (await provider.batch(input.state as never, questions, callCtx(ctx))).answers;
      } else {
        answers = {};
        for (const [id, q] of Object.entries(questions)) {
          answers[id] =
            q.kind === "boolean"
              ? await provider.decideBoolean(input.state as never, q, callCtx(ctx))
              : q.kind === "choice"
                ? await provider.decideChoice(input.state as never, q, callCtx(ctx))
                : await provider.decideScore(input.state as never, q, callCtx(ctx));
        }
      }
      const list = Object.values(answers);
      return ok(
        { answers },
        {
          costUsd: list.reduce((a, d) => a + d.costUsd, 0),
          usage: list.reduce(
            (a, d) => ({
              inputTokens: a.inputTokens + (d.usage?.inputTokens ?? 0),
              outputTokens: a.outputTokens + (d.usage?.outputTokens ?? 0),
            }),
            { inputTokens: 0, outputTokens: 0 },
          ),
        },
      );
    } catch (error) {
      if (!(error instanceof HumanFallbackSignal)) throw error;
      const properties: JsonObject = {};
      for (const [id, q] of Object.entries(questions))
        properties[id] =
          q.kind === "boolean"
            ? { type: "boolean", description: q.instructions }
            : {
                type: "string",
                description: q.instructions,
                enum: q.kind === "choice" ? Object.keys(q.options) : q.levels,
              };
      return suspend(
        {
          kind: "human",
          request: {
            title: "Answer the decision questions",
            context: { state: input.state as JsonValue },
            mode: {
              type: "form",
              schema: {
                type: "object",
                properties: properties as never,
                required: Object.keys(questions),
              },
            },
            assignees: [],
            expiresAt: null,
            externalReview: false,
          },
        },
        null,
      );
    }
  },
});
