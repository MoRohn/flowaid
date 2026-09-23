/**
 * Parser, typer and evaluator agree on the depth limit: an expression the
 * parser accepts is typed and evaluated without a depth failure, and an AST
 * one level taller than {@link MAX_EXPR_DEPTH} is rejected by all three with
 * the same message.
 */
import { describe, expect, it } from "vitest";
import type { ExprAst } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import type { JsonValue } from "../json.js";
import {
  evaluateExpression,
  expressionErrorReason,
  type ExpressionErrorReason,
} from "./evaluator.js";
import { EXPRESSION_TOO_DEEP_MESSAGE, MAX_EXPR_DEPTH } from "./functions.js";
import { parseExpression, type ParseExpressionResult } from "./parser.js";
import { createEvalScope } from "./scope.js";
import { BOOLEAN, INTEGER, UNKNOWN, inferExprType, type ExprType, type TypeEnv } from "./typer.js";

const env: TypeEnv = { schemaOf: () => undefined };
const scope = createEvalScope({});

interface Shape {
  name: string;
  /** Source text whose AST has height exactly `n`. */
  source: (n: number) => string;
  /** The same AST built by hand (for heights the parser refuses to produce). */
  build: (n: number) => ExprAst;
  type: ExprType;
  value: (n: number) => JsonValue;
}

const one: ExprAst = { kind: "literal", value: 1 };
const yes: ExprAst = { kind: "literal", value: true };

const shapes: Shape[] = [
  {
    name: "'+' chain (1 + 1 + …)",
    source: (n) => Array.from({ length: n }, () => "1").join(" + "),
    build: (n) => {
      let ast: ExprAst = one;
      for (let i = 1; i < n; i += 1) ast = { kind: "binary", op: "+", left: ast, right: one };
      return ast;
    },
    type: INTEGER,
    value: (n) => n,
  },
  {
    name: "'*' chain",
    source: (n) => Array.from({ length: n }, () => "1").join(" * "),
    build: (n) => {
      let ast: ExprAst = one;
      for (let i = 1; i < n; i += 1) ast = { kind: "binary", op: "*", left: ast, right: one };
      return ast;
    },
    type: INTEGER,
    value: () => 1,
  },
  {
    name: "'&&' chain",
    source: (n) => Array.from({ length: n }, () => "true").join(" && "),
    build: (n) => {
      let ast: ExprAst = yes;
      for (let i = 1; i < n; i += 1) ast = { kind: "binary", op: "&&", left: ast, right: yes };
      return ast;
    },
    type: BOOLEAN,
    value: () => true,
  },
  {
    name: "'||' chain",
    source: (n) => Array.from({ length: n }, () => "true").join(" || "),
    build: (n) => {
      let ast: ExprAst = yes;
      for (let i = 1; i < n; i += 1) ast = { kind: "binary", op: "||", left: ast, right: yes };
      return ast;
    },
    type: BOOLEAN,
    value: () => true,
  },
  {
    name: "unary chain (!!!…true)",
    source: (n) => "!".repeat(n - 1) + "true",
    build: (n) => {
      let ast: ExprAst = yes;
      for (let i = 1; i < n; i += 1) ast = { kind: "unary", op: "!", operand: ast };
      return ast;
    },
    type: BOOLEAN,
    value: (n) => (n - 1) % 2 === 0,
  },
  {
    name: "call chain (abs(abs(…)))",
    source: (n) => "abs(".repeat(n - 1) + "1" + ")".repeat(n - 1),
    build: (n) => {
      let ast: ExprAst = one;
      for (let i = 1; i < n; i += 1) ast = { kind: "call", fn: "abs", args: [ast] };
      return ast;
    },
    type: INTEGER,
    value: () => 1,
  },
  {
    name: "array nesting ([[[…]]])",
    source: (n) => "[".repeat(n - 1) + "1" + "]".repeat(n - 1),
    build: (n) => {
      let ast: ExprAst = one;
      for (let i = 1; i < n; i += 1) ast = { kind: "array", items: [ast] };
      return ast;
    },
    type: UNKNOWN,
    value: (n) => {
      let value: JsonValue = 1;
      for (let i = 1; i < n; i += 1) value = [value];
      return value;
    },
  },
];

/** Asserts that the parser refused the source with the shared depth message. */
function expectTooDeep(result: ParseExpressionResult): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
}

function depthFailure(
  fn: () => unknown,
): { reason: ExpressionErrorReason | undefined; message: string } | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return { reason: expressionErrorReason(error), message: error.message };
  }
}

describe.each(shapes)("depth agreement: $name", (shape) => {
  it.each([MAX_EXPR_DEPTH - 1, MAX_EXPR_DEPTH])(
    "height %d: parser ok, typer ok, evaluator ok",
    (n) => {
      const parsed = parseExpression(shape.source(n));
      expect(parsed).toEqual({ ok: true, ast: shape.build(n) });
      if (!parsed.ok) return;
      const typed = inferExprType(parsed.ast, env);
      expect(typed.issues).toEqual([]);
      if (shape.type.kind !== "unknown") expect(typed.type).toEqual(shape.type);
      expect(evaluateExpression(parsed.ast, scope)).toEqual(shape.value(n));
    },
  );

  it(`height ${MAX_EXPR_DEPTH + 1}: parser syntax error, typer one issue, evaluator DEPTH_LIMIT — all with the same message`, () => {
    const n = MAX_EXPR_DEPTH + 1;
    expectTooDeep(parseExpression(shape.source(n)));
    const ast = shape.build(n);
    const typed = inferExprType(ast, env);
    expect(typed.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ["type", EXPRESSION_TOO_DEEP_MESSAGE],
    ]);
    expect(typed.type).toEqual(UNKNOWN);
    expect(depthFailure(() => evaluateExpression(ast, scope))).toEqual({
      reason: "DEPTH_LIMIT",
      message: EXPRESSION_TOO_DEEP_MESSAGE,
    });
  });
});

describe("depth agreement: what the parser accepts, the typer and evaluator accept", () => {
  it("a lambda body counts one level more in the parser than at runtime, so parser acceptance is the stricter bound", () => {
    // map(a, x => x + 1 + … ) — the parser counts call → lambda → body, the typer and evaluator call → body.
    const body = (n: number): string => Array.from({ length: n }, () => "1").join(" + ");
    const accepted = parseExpression(`map([1], x => ${body(MAX_EXPR_DEPTH - 2)})`);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(inferExprType(accepted.ast, env).issues).toEqual([]);
    expect(evaluateExpression(accepted.ast, scope)).toEqual([MAX_EXPR_DEPTH - 2]);
    expectTooDeep(parseExpression(`map([1], x => ${body(MAX_EXPR_DEPTH - 1)})`));
  });

  it("parenthesised source nesting is bounded by the same limit even though it adds no AST height", () => {
    expect(
      parseExpression("(".repeat(MAX_EXPR_DEPTH - 1) + "1" + ")".repeat(MAX_EXPR_DEPTH - 1)),
    ).toEqual({ ok: true, ast: one });
    expectTooDeep(parseExpression("(".repeat(MAX_EXPR_DEPTH) + "1" + ")".repeat(MAX_EXPR_DEPTH)));
  });
});
