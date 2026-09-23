import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatRef, parseRef, type ExprAst, type Ref } from "../bindings.js";
import { EXPRESSION_FUNCTION_NAMES, FUNCTION_SIGNATURES } from "./functions.js";
import { parseExpression } from "./parser.js";
import { printAst } from "./printer.js";

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.message} at ${r.offset}`);
  return r.ast;
}

describe("printAst", () => {
  it.each<[string, string]>([
    ["1 + 2 * 3", "1 + 2 * 3"],
    ["(1 + 2) * 3", "(1 + 2) * 3"],
    ["1 - (2 - 3)", "1 - (2 - 3)"],
    ["1 - 2 - 3", "1 - 2 - 3"],
    ["-(1 + 2)", "-(1 + 2)"],
    ["- - 1", "--1"],
    ["!(a.b && c.d)", "!(a.b && c.d)"],
    ["a.b ? c.d : e.f", "a.b ? c.d : e.f"],
    ["(a.b ? 1 : 2) + 3", "(a.b ? 1 : 2) + 3"],
    ["(a.b ? 1 : 2).x", "(a.b ? 1 : 2).x"],
    ["(a.b || c.d) ? 1 : 2", "a.b || c.d ? 1 : 2"],
    ["(a.b < c.d) < e.f", "(a.b < c.d) < e.f"],
    ["a.b < (c.d < e.f)", "a.b < (c.d < e.f)"],
    ['"it\'s".length', '"it\'s".length'],
    ["'a\\nb'", '"a\\nb"'],
    ["{ 'x-y': 1, b: [1, 2] }", '{"x-y": 1, b: [1, 2]}'],
    ["a.b['x-y'][0].c", "a.b['x-y'][0].c"],
    ["(a.b)['k']", "(a.b).k"],
    ["(a.b)[0]", "(a.b)[0]"],
    ["a.b[c.d]", "a.b[c.d]"],
    ["$vars.config.host", "$vars.config.host"],
    ["$vars.config['x-y']", '$vars.config["x-y"]'],
    ["map(a.b, x => x.y + 1)", "map(a.b, x => x.y + 1)"],
    ["sort(a.b)", "sort(a.b)"],
    ["now()", "now()"],
    ["a.b in c.d", "a.b in c.d"],
    ["a.b matches 'x'", 'a.b matches "x"'],
    ["$scope.carry.gaps[2]", "$scope.carry.gaps[2]"],
    ["1e21", "1e+21"],
    ["1e308", "1e+308"],
    ["1.7976931348623157e308", "1.7976931348623157e+308"],
    ["5e-324", "5e-324"],
    ["0.000001", "0.000001"],
    ["true.x", "true.x"],
    ["5 .x", "5.x"],
  ])("%s prints as %s", (source, printed) => {
    expect(printAst(ast(source))).toBe(printed);
    expect(ast(printed)).toEqual(ast(source));
  });

  it("handles negative literals from foreign ASTs", () => {
    const neg: ExprAst = { kind: "member", object: { kind: "literal", value: -5 }, key: "x" };
    expect(printAst(neg)).toBe("(-5).x");
    expect(
      printAst({
        kind: "binary",
        op: "*",
        left: { kind: "literal", value: -5 },
        right: { kind: "literal", value: 2 },
      }),
    ).toBe("-5 * 2");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Property: parse(print(ast)) ≡ ast for random ASTs the parser can produce.
 * ──────────────────────────────────────────────────────────────────────────── */

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NODE_IDS = ["n1", "node_a", "start", "intent", "x"] as const;
const PORT_NAMES = ["p", "out", "decision", "body"] as const;
const PATH_TOKENS = [
  "a",
  "b_c",
  "0",
  "12",
  "x-y",
  "",
  "it's",
  "a/b",
  "a~b",
  "true",
  "len",
  "007",
  "a b",
  "ünï",
  "\n",
  '"q"',
  "\\",
] as const;
const PARAM_NAMES = ["p0", "p1", "item", "row"] as const;

const escapeToken = (t: string): string => t.replace(/~/g, "~0").replace(/\//g, "~1");

const arbRef: fc.Arbitrary<Ref> = fc.oneof(
  fc
    .record({
      node: fc.constantFrom(...NODE_IDS),
      port: fc.constantFrom(...PORT_NAMES),
      path: fc.array(fc.constantFrom(...PATH_TOKENS), { maxLength: 3 }),
    })
    .map(({ node, port, path }): Ref =>
      path.length === 0
        ? { kind: "port", node, port }
        : { kind: "port", node, port, path: path.map((t) => "/" + escapeToken(t)).join("") },
    ),
  fc.constantFrom("threshold", "crmBaseUrl", "v").map((name): Ref => ({ kind: "var", name })),
  fc
    .record({
      field: fc.constantFrom("item", "index", "iteration", "carry"),
      path: fc.array(fc.constantFrom(...PATH_TOKENS), { maxLength: 2 }),
    })
    .map(({ field, path }): Ref =>
      path.length === 0
        ? { kind: "scope", field }
        : { kind: "scope", field, path: path.map((t) => "/" + escapeToken(t)).join("") },
    ),
  fc
    .constantFrom("id", "workflowId", "workflowVersionId", "environment", "startedAt", "sessionId")
    .map((field): Ref => ({ kind: "run", field })),
);

const arbString = fc.oneof(
  fc.string({ maxLength: 8 }),
  fc.string({ unit: "binary", maxLength: 6 }),
  fc.constantFrom("", "'", '"', "\\", "\n", "{{", "}}", "in", "a b"),
);
const arbNumber = fc
  .oneof(
    fc.nat({ max: 1000 }),
    fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    fc.constantFrom(0, 1, 1e21, 0.5, 1e-7, 123456789012345680),
  )
  .filter((n) => !Object.is(n, -0));
const arbLiteral: fc.Arbitrary<ExprAst> = fc.oneof(
  arbNumber.map((value): ExprAst => ({ kind: "literal", value })),
  arbString.map((value): ExprAst => ({ kind: "literal", value })),
  fc.boolean().map((value): ExprAst => ({ kind: "literal", value })),
  fc.constant<ExprAst>({ kind: "literal", value: null }),
);
const arbKey = fc.oneof(fc.constantFrom("a", "b_1", "Zz", "true", "len"), arbString);
const BINARY_OPS = [
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
] as const;

function arbExpr(depth: number, bound: readonly string[]): fc.Arbitrary<ExprAst> {
  const leaf: fc.Arbitrary<ExprAst>[] = [
    arbLiteral,
    arbRef.map((ref): ExprAst => ({ kind: "ref", ref })),
  ];
  if (bound.length > 0)
    leaf.push(fc.constantFrom(...bound).map((name): ExprAst => ({ kind: "ident", name })));
  if (depth <= 0) return fc.oneof(...leaf);
  const sub = (): fc.Arbitrary<ExprAst> => arbExpr(depth - 1, bound);
  const nonStringIndex = sub().filter(
    (e) => !(e.kind === "literal" && typeof e.value === "string"),
  );
  const composite: fc.Arbitrary<ExprAst>[] = [
    fc
      .record({ op: fc.constantFrom("!", "-"), operand: sub() })
      .map(({ op, operand }): ExprAst => ({ kind: "unary", op, operand })),
    fc
      .record({ op: fc.constantFrom(...BINARY_OPS), left: sub(), right: sub() })
      .map(({ op, left, right }): ExprAst => ({ kind: "binary", op, left, right })),
    fc
      .record({ test: sub(), then: sub(), else: sub() })
      .map((t): ExprAst => ({ kind: "ternary", test: t.test, then: t.then, else: t.else })),
    fc
      .record({ object: sub(), key: arbKey })
      .map(({ object, key }): ExprAst => ({ kind: "member", object, key })),
    fc
      .record({ object: sub(), index: nonStringIndex })
      .map(({ object, index }): ExprAst => ({ kind: "index", object, index })),
    fc.array(sub(), { maxLength: 3 }).map((items): ExprAst => ({ kind: "array", items })),
    fc
      .uniqueArray(fc.record({ key: arbKey, value: sub() }), {
        maxLength: 3,
        selector: (entry) => entry.key,
      })
      .map((entries): ExprAst => ({ kind: "object", entries })),
    fc.constantFrom(...EXPRESSION_FUNCTION_NAMES).chain((fn) => {
      const sig = FUNCTION_SIGNATURES[fn];
      const max = Math.min(sig.maxArgs, sig.minArgs + 2);
      return fc.integer({ min: sig.minArgs, max }).chain((count) => {
        const args = Array.from({ length: count }, (_, i) => {
          if (sig.lambdaArg === i) {
            return fc.constantFrom(...PARAM_NAMES).chain((param) =>
              arbExpr(depth - 1, [...bound, param]).map((body): ExprAst => ({
                kind: "lambda",
                param,
                body,
              })),
            );
          }
          return sub();
        });
        return fc.tuple(...args).map((list): ExprAst => ({ kind: "call", fn, args: list }));
      });
    }),
  ];
  return fc.oneof({ depthSize: "small" }, ...leaf, ...composite);
}

describe("printAst round-trip property", () => {
  it("parse(print(ast)) equals ast for random ASTs", () => {
    fc.assert(
      fc.property(arbExpr(4, []), (tree) => {
        const printed = printAst(tree);
        const parsed = parseExpression(printed);
        if (!parsed.ok) throw new Error(`${parsed.message} at ${parsed.offset} in ${printed}`);
        expect(parsed.ast).toEqual(tree);
        expect(printAst(parsed.ast)).toBe(printed);
      }),
      { numRuns: 500 },
    );
  });

  it("formatRef/parseRef agree with the expression parser for random refs", () => {
    fc.assert(
      fc.property(arbRef, (ref) => {
        const text = formatRef(ref);
        const viaRef = parseRef(text);
        expect(viaRef).toEqual({ ok: true, ref });
        expect(ast(text)).toEqual({ kind: "ref", ref });
      }),
      { numRuns: 300 },
    );
  });

  it("never prints an identifier-looking key with quotes", () => {
    fc.assert(
      fc.property(arbKey, (key) => {
        const printed = printAst({ kind: "member", object: { kind: "ident", name: "p0" }, key });
        expect(printed.includes('"')).toBe(!IDENT_RE.test(key));
      }),
    );
  });
});
