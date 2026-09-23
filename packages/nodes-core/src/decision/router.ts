import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { LLM_SLOT, decide, decisionState, instructions, withSpend } from "../common.js";

/** A choice decision that routes: one control-out per route, `review` below `minConfidence`. */
export const routerNode = defineNode({
  id: "flowaid.decision.router",
  version: "1.0.0",
  metadata: {
    name: "Router",
    description:
      "Routes to the control-out of the chosen option. Below `minConfidence` it fires `review` instead, so an uncertain classification is looked at rather than acted on.",
    category: "decision",
    icon: "split",
    tags: ["decision", "typesafe", "routing"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions("How to pick a route for `state`."),
    routes: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string()).meta({
      minProperties: 2,
      maxProperties: 255,
      "x-ui": {
        widget: "keyvalue",
        help: "Route id → when to take it. Each id is a control-out.",
      },
    }),
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .meta({ "x-ui": { widget: "slider", min: 0, max: 1, step: 0.01 } }),
  }),
  inputSchema: z.object({ state: decisionState }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.choice }),
    route: z
      .string()
      .meta({ "x-port": { description: "The route fired (`review` when below minConfidence)." } }),
  }),
  portRules: [{ kind: "controlPortsFromConfig", path: "/routes" }],
  controlPorts: [
    {
      name: "review",
      label: "Needs review",
      description: "The chosen route's confidence is below minConfidence.",
    },
  ],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "router" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const r = await decide(
      ctx,
      { kind: "choice", instructions: ctx.config.instructions, options: ctx.config.routes },
      input.state as JsonValue,
    );
    if ("suspended" in r) return r.suspended;
    const route =
      r.decision.confidence >= ctx.config.minConfidence ? String(r.decision.value) : "review";
    return withSpend({ decision: r.decision, route }, [r.decision], route);
  },
});
