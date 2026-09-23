import { describe, expect, it } from "vitest";
import { parseRef, type ExprAst } from "../bindings.js";
import { EXPRESSION_TOO_DEEP_MESSAGE, MAX_EXPR_DEPTH } from "./functions.js";
import { parseExpression } from "./parser.js";
import { printAst } from "./printer.js";

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`expected '${source}' to parse: ${r.message} at ${r.offset}`);
  return r.ast;
}
function fail(source: string): { message: string; offset: number } {
  const r = parseExpression(source);
  if (r.ok) throw new Error(`expected '${source}' to fail, got ${JSON.stringify(r.ast)}`);
  return { message: r.message, offset: r.offset };
}
const lit = (value: string | number | boolean | null): ExprAst => ({ kind: "literal", value });
const bin = (
  op: Extract<ExprAst, { kind: "binary" }>["op"],
  left: ExprAst,
  right: ExprAst,
): ExprAst => ({ kind: "binary", op, left, right });
const ref = (source: string): ExprAst => {
  const r = parseRef(source);
  if (!r.ok) throw new Error(r.message);
  return { kind: "ref", ref: r.ref };
};

describe("parseExpression: literals", () => {
  it.each<[string, ExprAst]>([
    ["1", lit(1)],
    ["0", lit(0)],
    ["3.5", lit(3.5)],
    ["1e3", lit(1000)],
    ["1e308", lit(1e308)],
    ["1.7976931348623157e308", lit(Number.MAX_VALUE)],
    ["5e-324", lit(Number.MIN_VALUE)],
    ["1e-400", lit(0)],
    ["2.5E-1", lit(0.25)],
    ["-5", { kind: "unary", op: "-", operand: lit(5) }],
    ["- 5", { kind: "unary", op: "-", operand: lit(5) }],
    ["--5", { kind: "unary", op: "-", operand: { kind: "unary", op: "-", operand: lit(5) } }],
    ["'x'", lit("x")],
    ['"x"', lit("x")],
    ["'a\\nb'", lit("a\nb")],
    ["true", lit(true)],
    ["false", lit(false)],
    ["null", lit(null)],
    ["(1)", lit(1)],
    ["((1))", lit(1)],
    ["[]", { kind: "array", items: [] }],
    ["[1, 2]", { kind: "array", items: [lit(1), lit(2)] }],
    [
      "[ [1], [] ]",
      {
        kind: "array",
        items: [
          { kind: "array", items: [lit(1)] },
          { kind: "array", items: [] },
        ],
      },
    ],
    ["{}", { kind: "object", entries: [] }],
    ["{a: 1}", { kind: "object", entries: [{ key: "a", value: lit(1) }] }],
    [
      "{'x-y': 1, \"b\": 2}",
      {
        kind: "object",
        entries: [
          { key: "x-y", value: lit(1) },
          { key: "b", value: lit(2) },
        ],
      },
    ],
    ["{true: 1}", { kind: "object", entries: [{ key: "true", value: lit(1) }] }],
    [
      "{a: {b: [1]}}",
      {
        kind: "object",
        entries: [
          {
            key: "a",
            value: {
              kind: "object",
              entries: [{ key: "b", value: { kind: "array", items: [lit(1)] } }],
            },
          },
        ],
      },
    ],
  ])("parses %s", (source, expected) => {
    expect(ast(source)).toEqual(expected);
  });
});

describe("parseExpression: precedence and associativity", () => {
  it.each<[string, string]>([
    ["1 + 2 * 3", "1 + (2 * 3)"],
    ["1 * 2 + 3", "(1 * 2) + 3"],
    ["1 - 2 - 3", "(1 - 2) - 3"],
    ["1 / 2 / 3", "(1 / 2) / 3"],
    ["1 - 2 + 3", "(1 - 2) + 3"],
    ["1 * 2 % 3", "(1 * 2) % 3"],
    ["-1 * 2", "(-1) * 2"],
    ["-1 + 2", "(-1) + 2"],
    ["!true || false", "(!true) || false"],
    ["true || false && true", "true || (false && true)"],
    ["true && false || true", "(true && false) || true"],
    ["1 < 2 && 3 > 2", "(1 < 2) && (3 > 2)"],
    ["1 + 2 < 3 * 4", "(1 + 2) < (3 * 4)"],
    ["1 == 2 || false", "(1 == 2) || false"],
    ["true ? 1 : 2", "true ? 1 : 2"],
    ["true ? 1 : false ? 2 : 3", "true ? 1 : (false ? 2 : 3)"],
    ["true ? false ? 1 : 2 : 3", "true ? (false ? 1 : 2) : 3"],
    ["1 < 2 ? 3 : 4", "(1 < 2) ? 3 : 4"],
    ["true || false ? 1 : 2", "(true || false) ? 1 : 2"],
    ["-(1 + 2)", "-(1 + 2)"],
    ["!(true && false)", "!(true && false)"],
    ["(1 + 2) * 3", "(1 + 2) * 3"],
    ["1 + (2 + 3)", "1 + (2 + 3)"],
    ["-[1][0]", "-([1][0])"],
    ["[1, 2][0] + 1", "([1, 2][0]) + 1"],
    ["'a' in ['a'] && true", "('a' in ['a']) && true"],
    ["'a' matches 'a|b' || false", "('a' matches 'a|b') || false"],
    ["1 + 2 in [3]", "(1 + 2) in [3]"],
  ])("%s parses as %s", (source, explicit) => {
    expect(ast(source)).toEqual(ast(explicit));
  });

  it.each<[string, string]>([
    ["1 < 2 < 3", "do not chain"],
    ["1 == 2 == 3", "do not chain"],
    ["a.b in c.d in e.f", "do not chain"],
    ["1 < 2 == true", "do not chain"],
  ])("rejects chained comparison %s", (source, message) => {
    expect(fail(source).message).toContain(message);
  });
});

describe("parseExpression: operators", () => {
  it.each([
    "||",
    "&&",
    "==",
    "!=",
    "<",
    "<=",
    ">",
    ">=",
    "in",
    "matches",
    "+",
    "-",
    "*",
    "/",
    "%",
  ] as const)("parses binary %s", (op) => {
    expect(ast(`a.x ${op} b.y`)).toEqual(bin(op, ref("a.x"), ref("b.y")));
  });
  it("parses unary operators", () => {
    expect(ast("!a.x")).toEqual({ kind: "unary", op: "!", operand: ref("a.x") });
    expect(ast("-a.x")).toEqual({ kind: "unary", op: "-", operand: ref("a.x") });
    expect(ast("!!a.x")).toEqual({
      kind: "unary",
      op: "!",
      operand: { kind: "unary", op: "!", operand: ref("a.x") },
    });
    expect(ast("!-a.x")).toEqual({
      kind: "unary",
      op: "!",
      operand: { kind: "unary", op: "-", operand: ref("a.x") },
    });
  });
  it("parses the ternary", () => {
    expect(ast("a.x ? 1 : 2")).toEqual({
      kind: "ternary",
      test: ref("a.x"),
      then: lit(1),
      else: lit(2),
    });
  });
});

describe("parseExpression: references", () => {
  it.each([
    "start.message",
    "intent.decision.value",
    "judgments.answers.urgency.levelLabel",
    "similar.hits[0].metadata.number",
    "web.body['x-total-count']",
    'web.body["a b"]',
    "n.p['a/b']",
    "n.p['it\\'s']",
    "n.p['']",
    "$vars.threshold",
    "$vars.crmBaseUrl",
    "$scope.item",
    "$scope.index",
    "$scope.iteration",
    "$scope.carry",
    "$scope.item.title",
    "$scope.carry.evidence[2].url",
    "$scope.item['x-y']",
    "$run.id",
    "$run.workflowId",
    "$run.workflowVersionId",
    "$run.environment",
    "$run.startedAt",
    "$run.sessionId",
    "n.p.true",
    "n.p.len",
  ])("parses %s identically to parseRef", (source) => {
    expect(ast(source)).toEqual(ref(source));
  });

  it("keeps dynamic segments as postfix nodes", () => {
    expect(ast("a.b[c.d]")).toEqual({ kind: "index", object: ref("a.b"), index: ref("c.d") });
    expect(ast("a.b[0][c.d].e")).toEqual({
      kind: "member",
      object: { kind: "index", object: ref("a.b[0]"), index: ref("c.d") },
      key: "e",
    });
    expect(ast("a.b[1.5]")).toEqual({ kind: "index", object: ref("a.b"), index: lit(1.5) });
    expect(ast("a.b[1e2]")).toEqual({ kind: "index", object: ref("a.b"), index: lit(100) });
    expect(ast("a.b[-1]")).toEqual({
      kind: "index",
      object: ref("a.b"),
      index: { kind: "unary", op: "-", operand: lit(1) },
    });
    expect(ast("a.b[('k')]")).toEqual({ kind: "member", object: ref("a.b"), key: "k" });
  });

  it("treats members after $vars and $run as postfix access", () => {
    expect(ast("$vars.config.host")).toEqual({
      kind: "member",
      object: ref("$vars.config"),
      key: "host",
    });
    expect(ast("$vars.list[0]")).toEqual({
      kind: "index",
      object: ref("$vars.list"),
      index: lit(0),
    });
    expect(ast("$vars.map['k']")).toEqual({ kind: "member", object: ref("$vars.map"), key: "k" });
    expect(ast("$run.id.x")).toEqual({ kind: "member", object: ref("$run.id"), key: "x" });
  });

  it("normalises bracketed string literals to members and keeps numeric indexes", () => {
    expect(ast("(a.b)['k']")).toEqual({ kind: "member", object: ref("a.b"), key: "k" });
    expect(ast("(a.b)[0]")).toEqual({ kind: "index", object: ref("a.b"), index: lit(0) });
    expect(ast("[1][0]")).toEqual({
      kind: "index",
      object: { kind: "array", items: [lit(1)] },
      index: lit(0),
    });
    expect(ast("{a: 1}['a']")).toEqual({
      kind: "member",
      object: { kind: "object", entries: [{ key: "a", value: lit(1) }] },
      key: "a",
    });
    expect(ast("{a: 1}.a")).toEqual({
      kind: "member",
      object: { kind: "object", entries: [{ key: "a", value: lit(1) }] },
      key: "a",
    });
    expect(ast("len(a.b).x")).toEqual({
      kind: "member",
      object: { kind: "call", fn: "len", args: [ref("a.b")] },
      key: "x",
    });
    expect(ast("true.x")).toEqual({ kind: "member", object: lit(true), key: "x" });
    expect(ast('"s".x')).toEqual({ kind: "member", object: lit("s"), key: "x" });
  });

  it.each<[string, string, number]>([
    ["Foo.bar", "invalid node id", 0],
    ["foo.Bar", "invalid port name", 4],
    ["foo", "unknown identifier", 0],
    ["foo.", "expected port name", 4],
    ["$vars", "expected '.'", 5],
    ["$vars.", "expected field name", 6],
    ["$vars.Bad", "invalid variable name", 6],
    ["$scope.nope", "unknown $scope field", 7],
    ["$run.nope", "unknown $run field", 5],
    ["$other.x", "unknown root", 0],
    ["len.x", "expected '(' after function name", 3],
    ["a.b.", "expected property name", 4],
    ["a.b[", "expected expression", 4],
    ["a.b[0", "expected ']'", 5],
  ])("rejects %s (%s)", (source, message, offset) => {
    const error = fail(source);
    expect(error.message).toContain(message);
    expect(error.offset).toBe(offset);
  });
});

describe("parseExpression: calls and lambdas", () => {
  it("parses calls with every arity form", () => {
    expect(ast("now()")).toEqual({ kind: "call", fn: "now", args: [] });
    expect(ast("len(a.b)")).toEqual({ kind: "call", fn: "len", args: [ref("a.b")] });
    expect(ast('get(a.b, "/x", 1)')).toEqual({
      kind: "call",
      fn: "get",
      args: [ref("a.b"), lit("/x"), lit(1)],
    });
    expect(ast("coalesce(1, 2, 3, 4, 5)")).toEqual({
      kind: "call",
      fn: "coalesce",
      args: [lit(1), lit(2), lit(3), lit(4), lit(5)],
    });
    expect(ast("len( a.b )")).toEqual({ kind: "call", fn: "len", args: [ref("a.b")] });
  });

  it.each(["filter", "map", "any", "all", "sort"] as const)("parses %s with a lambda", (fn) => {
    expect(ast(`${fn}(a.b, x => x)`)).toEqual({
      kind: "call",
      fn,
      args: [ref("a.b"), { kind: "lambda", param: "x", body: { kind: "ident", name: "x" } }],
    });
  });

  it("parses sort without a lambda", () => {
    expect(ast("sort(a.b)")).toEqual({ kind: "call", fn: "sort", args: [ref("a.b")] });
  });

  it("resolves lambda parameters, members on them and nesting", () => {
    expect(ast("map(a.b, x => x.name)")).toEqual({
      kind: "call",
      fn: "map",
      args: [
        ref("a.b"),
        {
          kind: "lambda",
          param: "x",
          body: { kind: "member", object: { kind: "ident", name: "x" }, key: "name" },
        },
      ],
    });
    expect(ast("map(a.b, x => x[0])")).toEqual({
      kind: "call",
      fn: "map",
      args: [
        ref("a.b"),
        {
          kind: "lambda",
          param: "x",
          body: { kind: "index", object: { kind: "ident", name: "x" }, index: lit(0) },
        },
      ],
    });
    expect(ast("map(a.b, x => map(c.d, y => x + y))")).toEqual({
      kind: "call",
      fn: "map",
      args: [
        ref("a.b"),
        {
          kind: "lambda",
          param: "x",
          body: {
            kind: "call",
            fn: "map",
            args: [
              ref("c.d"),
              {
                kind: "lambda",
                param: "y",
                body: bin("+", { kind: "ident", name: "x" }, { kind: "ident", name: "y" }),
              },
            ],
          },
        },
      ],
    });
    expect(ast("map(a.b, x => x > 1 ? x : 0)")).toEqual({
      kind: "call",
      fn: "map",
      args: [
        ref("a.b"),
        {
          kind: "lambda",
          param: "x",
          body: {
            kind: "ternary",
            test: bin(">", { kind: "ident", name: "x" }, lit(1)),
            then: { kind: "ident", name: "x" },
            else: lit(0),
          },
        },
      ],
    });
  });

  it("scopes lambda parameters to their body", () => {
    expect(fail("map(a.b, x => x) + x").message).toContain("unknown identifier 'x'");
    expect(fail("x + map(a.b, x => x)").message).toContain("unknown identifier 'x'");
  });

  it.each<[string, string, number]>([
    ["foo(1)", "unknown function 'foo'", 0],
    ["len()", "len expects 1 argument(s), got 0", 0],
    ["len(1, 2)", "len expects 1 argument(s), got 2", 0],
    ["now(1)", "now expects 0 argument(s), got 1", 0],
    ["get(1)", "get expects 2 to 3 argument(s), got 1", 0],
    ["get(1, 2, 3, 4)", "get expects 2 to 3 argument(s), got 4", 0],
    ["coalesce()", "coalesce expects at least 1 argument(s), got 0", 0],
    ["map(a.b)", "map expects 2 argument(s), got 1", 0],
    ["map(a.b, 1)", "argument 2 of map must be a lambda", 9],
    ["filter(a.b, c.d)", "argument 2 of filter must be a lambda", 12],
    ["sort(a.b, 1)", "argument 2 of sort must be a lambda", 10],
    ["len(x => x)", "lambdas are only allowed", 4],
    ["x => x", "lambdas are only allowed", 0],
    ["[x => x]", "lambdas are only allowed", 1],
    ["map(a.b, x => y)", "unknown identifier 'y'", 14],
    ["map(a.b, x => x => x)", "lambdas are only allowed", 14],
    ["map(a.b, len => len)", "'len' cannot be a lambda parameter", 9],
    ["map(a.b, true => 1)", "'true' cannot be a lambda parameter", 9],
    ["map(a.b, $x => 1)", "'$x' cannot be a lambda parameter", 9],
    ["map(a.b, 1 => 1)", "argument 2 of map must be a lambda", 9],
    ["len(a.b", "expected ','", 7],
    ["len(a.b,)", "expected expression", 8],
  ])("rejects %s", (source, message, offset) => {
    const error = fail(source);
    expect(error.message).toContain(message);
    expect(error.offset).toBe(offset);
  });
});

describe("parseExpression: syntax errors", () => {
  it.each<[string, string, number]>([
    ["", "expected expression, found end of input", 0],
    ["   ", "expected expression, found end of input", 3],
    ["1 +", "expected expression, found end of input", 3],
    ["1 + * 2", "expected expression, found '*'", 4],
    ["(1", "expected ')'", 2],
    ["1)", "unexpected ')' after expression", 1],
    ["1 2", "unexpected number 2 after expression", 2],
    ["[1 2]", "expected ','", 3],
    ["[1,", "expected expression", 3],
    ["{a}", "expected ':'", 2],
    ["{1: 2}", "expected object key", 1],
    ["{a: 1,}", "expected object key", 6],
    ["{a: 1 b: 2}", "expected ','", 6],
    ["{a: 1, a: 2}", 'duplicate key "a" in object literal', 7],
    ["{'a': 1, a: 2}", 'duplicate key "a" in object literal', 9],
    ["{a: 1, b: 2, 'b': 3}", 'duplicate key "b" in object literal', 13],
    ["{a: {b: 1, b: 2}}", 'duplicate key "b" in object literal', 11],
    ["1e999", "number literal out of range", 0],
    ["-1e999", "number literal out of range", 1],
    ["[1, 1e999]", "number literal out of range", 4],
    ["true ? 1", "expected ':'", 8],
    ["true ? : 1", "expected expression", 7],
    ["in", "found keyword 'in'", 0],
    ["1 in", "expected expression", 4],
    ["matches", "found keyword 'matches'", 0],
    ["'unterminated", "unterminated string", 0],
    ["a.b |", "unexpected '|' after expression", 4],
    ["a.b ? 1 : 2 : 3", "unexpected ':' after expression", 12],
    ["!", "expected expression", 1],
    ["-", "expected expression", 1],
    ["a.b..c", "expected property name", 4],
    ["1 === 1", "unexpected character '='", 4],
  ])("rejects %j at %d", (source, message, offset) => {
    const error = fail(source);
    expect(error.message).toContain(message);
    expect(error.offset).toBe(offset);
  });

  it("rejects deeply nested source with the shared depth message", () => {
    expect(fail("(".repeat(200) + "1" + ")".repeat(200)).message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
    expect(fail("!".repeat(200) + "true").message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
    expect(fail("[".repeat(200) + "]".repeat(200)).message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
    expect(fail("a.b" + "[c.d]".repeat(200)).message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
    expect(fail("a.b" + ".c".repeat(200)).message).toContain("reference path longer");
    expect(ast("(".repeat(50) + "1" + ")".repeat(50))).toEqual(lit(1));
  });

  /** Sources whose AST height is exactly `n`, one per operator loop and for the postfix chain. */
  const chains: [string, (n: number) => string][] = [
    ["'+' chain", (n) => Array.from({ length: n }, () => "1").join(" + ")],
    ["'-' chain", (n) => Array.from({ length: n }, () => "1").join(" - ")],
    ["'*' chain", (n) => Array.from({ length: n }, () => "1").join(" * ")],
    ["'/' chain", (n) => Array.from({ length: n }, () => "1").join(" / ")],
    ["'%' chain", (n) => Array.from({ length: n }, () => "1").join(" % ")],
    ["'||' chain", (n) => Array.from({ length: n }, () => "true").join(" || ")],
    ["'&&' chain", (n) => Array.from({ length: n }, () => "true").join(" && ")],
    ["postfix index chain", (n) => "a.b" + "[c.d]".repeat(n - 1)],
    ["postfix member chain", (n) => "(a.b)" + ".c".repeat(n - 1)],
    ["unary chain", (n) => "!".repeat(n - 1) + "true"],
    ["call chain", (n) => "abs(".repeat(n - 1) + "1" + ")".repeat(n - 1)],
  ];
  it.each(chains)(
    "counts AST height in the %s: MAX_EXPR_DEPTH accepted, one more rejected",
    (_name, build) => {
      expect(parseExpression(build(MAX_EXPR_DEPTH - 1)).ok).toBe(true);
      expect(parseExpression(build(MAX_EXPR_DEPTH)).ok).toBe(true);
      expect(fail(build(MAX_EXPR_DEPTH + 1)).message).toBe(EXPRESSION_TOO_DEEP_MESSAGE);
    },
  );

  it("reports a too-deep chain exactly once, at the operator that crossed the limit", () => {
    const source = Array.from({ length: MAX_EXPR_DEPTH + 1 }, () => "1").join(" + ");
    const result = parseExpression(source);
    expect(result).toEqual({
      ok: false,
      message: EXPRESSION_TOO_DEEP_MESSAGE,
      offset: source.lastIndexOf("+"),
    });
  });

  it("reports the offset of a lexical error inside a longer expression", () => {
    expect(fail("a.b + 'x").offset).toBe(6);
    expect(fail("a.b + 1e").offset).toBe(6);
  });
});

describe("parseExpression: whitespace and shape", () => {
  it("ignores surrounding whitespace", () => {
    expect(ast(" \n a.b \t")).toEqual(ref("a.b"));
    expect(ast("len(\n  a.b\n)")).toEqual({ kind: "call", fn: "len", args: [ref("a.b")] });
  });
  it("is idempotent through the printer", () => {
    for (const source of [
      "1 + 2 * 3",
      "map(a.b, x => x.y + 1)",
      "{a: [1, 'x'], 'b-c': null}",
      "$scope.carry.gaps[0]",
      "a.b ? c.d : e.f",
    ]) {
      const first = ast(source);
      expect(ast(printAst(first))).toEqual(first);
    }
  });
});
