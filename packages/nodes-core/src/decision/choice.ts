import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { decide, decisionState, instructions, withSpend } from "../common.js";

export const choiceNode = defineNode({
  id: "flowaid.decision.choice",
  version: "1.0.0",
  metadata: {
    name: "Choice",
    description:
      "Classifies `state` into one of the configured options and returns a probability per option (TypeSafe choice decision). Every option id is also a control-out port.",
    category: "decision",
    icon: "list-checks",
    tags: ["decision", "typesafe", "classification"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions("The question the model answers about `state`."),
    options: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string()).meta({
      "x-ui": {
        widget: "keyvalue",
        help: "Option id → description. Each id becomes a control-out port.",
      },
      minProperties: 2,
      maxProperties: 255,
    }),
  }),
  inputSchema: z.object({
    state: decisionState.meta({ "x-port": { description: "What the decision is about." } }),
  }),
  outputSchema: z.object({
    decision: z.unknown().meta({
      "x-jsonSchema": DecisionResultJsonSchema.choice,
      "x-port": { description: "The full DecisionResult (kind = choice)." },
    }),
  }),
  portRules: [{ kind: "controlPortsFromConfig", path: "/options" }],
  credentials: [
    {
      name: "typesafe",
      types: ["typesafe.api_key"],
      required: true,
      description: "TypeSafe API key used by the primary hop.",
    },
  ],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "choice" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const r = await decide(
      ctx,
      { kind: "choice", instructions: ctx.config.instructions, options: ctx.config.options },
      input.state as JsonValue,
    );
    if ("suspended" in r) return r.suspended;
    // Every option is a control-out: fire the chosen one.
    return withSpend({ decision: r.decision }, [r.decision], String(r.decision.value));
  },
});
