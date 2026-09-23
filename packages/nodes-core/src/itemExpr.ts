import { z } from "zod";
/** Per-item FlowExpr evaluation for filter/map: `$scope.item` / `$scope.index` bound, `$vars` visible. */
import {
  ExpressionError,
  createEvalScope,
  evaluateExpression,
  parseExpression,
  type ExprAst,
  type JsonValue,
} from "@flowaid/workflow-core";

const cache = new Map<string, ExprAst>();

export function compileItemExpr(source: string): ExprAst {
  const hit = cache.get(source);
  if (hit) return hit;
  const parsed = parseExpression(source);
  if (!parsed.ok)
    throw new ExpressionError(`invalid expression at ${parsed.offset}: ${parsed.message}`);
  if (cache.size >= 500) cache.delete(cache.keys().next().value as string);
  cache.set(source, parsed.ast);
  return parsed.ast;
}

export function evalForItem(
  ast: ExprAst,
  item: JsonValue,
  index: number,
  vars: Readonly<Record<string, JsonValue>>,
  now: () => Date,
): JsonValue {
  return evaluateExpression(
    ast,
    createEvalScope({
      scope: { item, index },
      vars: vars,
      now: () => now().toISOString(),
    }),
  );
}

/** Config field for an expression evaluated once per item (kept as source; not compiled as a binding). */
export const ITEM_EXPR_UI = {
  widget: "code",
  language: "flowexpr-item",
  help: "Evaluated once per item with `$scope.item` and `$scope.index`.",
} as const;

/**
 * A config field holding FlowExpr source (`x-ui: { widget: 'code', language: 'flowexpr' }`). The
 * compiler turns it into a config binding, so at `execute()` it holds the expression's *value*;
 * the manifest still describes the source string.
 */
export const flowExprField = () =>
  z.unknown().meta({
    "x-jsonSchema": {
      type: "string",
      minLength: 1,
      maxLength: 4000,
      "x-ui": { widget: "code", language: "flowexpr" },
    },
  });
