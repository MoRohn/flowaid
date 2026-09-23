import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { ITEM_EXPR_UI, compileItemExpr, evalForItem } from "../itemExpr.js";

export const filterNode = defineNode({
  id: "flowaid.data.filter",
  version: "1.0.0",
  metadata: {
    name: "Filter",
    description:
      "Keeps the items for which a FlowExpr predicate is true (`$scope.item`, `$scope.index`); the rest go to `rejected`.",
    category: "data",
    icon: "filter",
    tags: ["data", "array", "expression"],
    summary: "{{ config.predicate }}",
  },
  configSchema: z.strictObject({
    predicate: z.string().min(1).max(4000).meta({ "x-ui": ITEM_EXPR_UI }),
    limit: z.int().min(1).optional(),
  }),
  inputSchema: z.object({ items: z.array(z.unknown()) }),
  outputSchema: z.object({
    items: z.array(z.unknown()),
    rejected: z.array(z.unknown()),
    count: z.int().min(0),
  }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const ast = compileItemExpr(ctx.config.predicate);
    const items: JsonValue[] = [];
    const rejected: JsonValue[] = [];
    input.items.forEach((raw, index) => {
      const item = (raw ?? null) as JsonValue;
      const keep = ctx.config.limit === undefined || items.length < ctx.config.limit;
      if (keep && evalForItem(ast, item, index, ctx.vars, () => ctx.clock.now()) === true)
        items.push(item);
      else rejected.push(item);
    });
    return Promise.resolve(ok({ items, rejected, count: items.length }));
  },
});
