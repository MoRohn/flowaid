import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { ITEM_EXPR_UI, compileItemExpr, evalForItem } from "../itemExpr.js";

export const mapNode = defineNode({
  id: "flowaid.data.map",
  version: "1.0.0",
  metadata: {
    name: "Map",
    description:
      "Transforms every item with a FlowExpr expression (`$scope.item`, `$scope.index`). For per-item nodes use a loop container.",
    category: "data",
    icon: "list-restart",
    tags: ["data", "array", "expression"],
    summary: "{{ config.expr }}",
  },
  configSchema: z.strictObject({
    expr: z.string().min(1).max(4000).meta({ "x-ui": ITEM_EXPR_UI }),
    dropNulls: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
  }),
  inputSchema: z.object({ items: z.array(z.unknown()) }),
  outputSchema: z.object({ items: z.array(z.unknown()) }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const ast = compileItemExpr(ctx.config.expr);
    const items = input.items.map((raw, index) =>
      evalForItem(ast, (raw ?? null) as JsonValue, index, ctx.vars, () => ctx.clock.now()),
    );
    return Promise.resolve(
      ok({ items: ctx.config.dropNulls ? items.filter((v) => v !== null) : items }),
    );
  },
});
