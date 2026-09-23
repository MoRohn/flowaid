import { describe, expect, it } from "vitest";
import type { ExprAst } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import type { JsonValue } from "../json.js";
import type { EvalScope } from "../bindings.js";
import {
  MAX_EVAL_INPUT_BYTES,
  MAX_EVAL_RESULT_BYTES,
  MAX_EVAL_STEPS,
  MAX_VALUE_DEPTH,
  evaluateExpression,
  expressionErrorReason,
  getPointer,
  type ExpressionErrorReason,
} from "./evaluator.js";
import { MAX_EXPR_DEPTH } from "./functions.js";
import {
  LruCache,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_SUBJECT_LENGTH,
  NATIVE_REGEX_ENGINE,
  checkRegexLiteral,
  getDefaultRegexEngine,
  setDefaultRegexEngine,
  type CompiledRegex,
  type RegexEngine,
} from "./regex.js";
import { parseExpression } from "./parser.js";
import { createEvalScope } from "./scope.js";

const scope = createEvalScope({
  ports: {
    a: {
      n: 5,
      s: "hello",
      b: true,
      z: null,
      arr: [1, 2, 3],
      obj: { k: "v", nested: { deep: [10, 20] }, "x-y": 1 },
      f: 2.5,
      neg: -3,
      mixed: [1, "a", null, [2], { b: 3 }],
    },
    b: { n: 2, s: "world", str_arr: ["b", "a", "c"], empty: [], big: 1e308 },
  },
  vars: { threshold: 0.7, name: "flow", list: [1, 2] },
  scope: { item: { title: "T", tags: ["x"] }, index: 3, iteration: 1, carry: { gaps: ["g1"] } },
  run: { id: "run-1", environment: "test" },
  now: () => "2026-01-02T03:04:05.000Z",
});

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.message} at ${r.offset}`);
  return r.ast;
}
function run(source: string): JsonValue {
  return evaluateExpression(ast(source), scope);
}
function reasonOf(fn: () => unknown): ExpressionErrorReason | undefined {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return expressionErrorReason(error);
  }
  throw new Error("expected an ExpressionError");
}

describe("evaluateExpression: literals and refs", () => {
  it.each<[string, JsonValue]>([
    ["1", 1],
    ["1.5", 1.5],
    ["1e3", 1000],
    ["-5", -5],
    ["--5", 5],
    ["'x'", "x"],
    ["true", true],
    ["false", false],
    ["null", null],
    ['[1, "a", null]', [1, "a", null]],
    ["{a: 1, b: [2]}", { a: 1, b: [2] }],
    ["{}", {}],
    ["[]", []],
    ["a.n", 5],
    ["a.s", "hello"],
    ["a.z", null],
    ["a.arr", [1, 2, 3]],
    ["a.arr[1]", 2],
    ["a.obj.k", "v"],
    ["a.obj.nested.deep[1]", 20],
    ["a.obj['x-y']", 1],
    ["$vars.threshold", 0.7],
    ["$vars.list[1]", 2],
    ["$scope.item.title", "T"],
    ["$scope.item.tags[0]", "x"],
    ["$scope.index", 3],
    ["$scope.iteration", 1],
    ["$scope.carry.gaps", ["g1"]],
    ["$run.id", "run-1"],
    ["$run.environment", "test"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["zz.n", "UNKNOWN_REF"],
    ["a.nope", "UNKNOWN_REF"],
    ["$vars.nope", "UNKNOWN_REF"],
    ["$run.sessionId", "UNKNOWN_REF"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });

  it("names the reference in the error", () => {
    expect(() => run("a.nope")).toThrow(/unknown reference 'a.nope'/);
  });
});

describe("evaluateExpression: arithmetic", () => {
  it.each<[string, JsonValue]>([
    ["1 + 2", 3],
    ["a.n + b.n", 7],
    ["a.n - b.n", 3],
    ["a.n * b.n", 10],
    ["a.n / b.n", 2.5],
    ["a.n % b.n", 1],
    ["-a.n", -5],
    ["a.neg * -1", 3],
    ["-a.neg", 3],
    ["0.1 + 0.2", 0.30000000000000004],
    ["7 % 3", 1],
    ["-7 % 3", -1],
    ["7.5 % 2", 1.5],
    ["'a' + 'b'", "ab"],
    ["a.s + ' ' + b.s", "hello world"],
    ["1 + 2 * 3 - 4 / 2", 5],
    ["(1 + 2) * 3", 9],
    ["2 * 3 % 4", 2],
    ["10 - 2 - 3", 5],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["1 / 0", "DIVISION_BY_ZERO"],
    ["0 / 0", "DIVISION_BY_ZERO"],
    ["1 % 0", "DIVISION_BY_ZERO"],
    ["-1 / 0", "DIVISION_BY_ZERO"],
    ["1 + 'a'", "TYPE"],
    ["'a' + 1", "TYPE"],
    ["1 + null", "TYPE"],
    ["null + null", "TYPE"],
    ["[1] + [2]", "TYPE"],
    ["{} + {}", "TYPE"],
    ["true + true", "TYPE"],
    ["'a' - 'b'", "TYPE"],
    ["'a' * 2", "TYPE"],
    ["[] / 1", "TYPE"],
    ["'x' % 2", "TYPE"],
    ["-'a'", "TYPE"],
    ["-null", "TYPE"],
    ["-[1]", "TYPE"],
    ["b.big * 10", "NOT_FINITE"],
    ["b.big + b.big", "NOT_FINITE"],
    ["-b.big - b.big", "NOT_FINITE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });
});

describe("evaluateExpression: comparison and equality", () => {
  it.each<[string, JsonValue]>([
    ["1 == 1", true],
    ["1 == 2", false],
    ["1 != 2", true],
    ["'a' == 'a'", true],
    ["'a' == 'b'", false],
    ["1 == '1'", false],
    ["null == null", true],
    ["null == 0", false],
    ["null == false", false],
    ["true == true", true],
    ["[1, 2] == [1, 2]", true],
    ["[1, 2] == [2, 1]", false],
    ["{a: 1, b: 2} == {b: 2, a: 1}", true],
    ["{a: 1} == {a: 2}", false],
    ["{a: 1} != {a: 2}", true],
    ["a.obj == a.obj", true],
    ["a.obj.nested == {deep: [10, 20]}", true],
    ["1 < 2", true],
    ["2 < 1", false],
    ["1 <= 1", true],
    ["2 > 1", true],
    ["1 >= 2", false],
    ["'a' < 'b'", true],
    ["'b' < 'a'", false],
    ["'abc' <= 'abc'", true],
    ["'B' < 'a'", true],
    ["a.f > $vars.threshold", true],
    ["-1 < 0", true],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["1 < 'a'", "TYPE"],
    ["'a' > 1", "TYPE"],
    ["null < 1", "TYPE"],
    ["[1] < [2]", "TYPE"],
    ["true < false", "TYPE"],
    ["{} >= {}", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });
});

describe("evaluateExpression: boolean logic", () => {
  it.each<[string, JsonValue]>([
    ["true && true", true],
    ["true && false", false],
    ["false && true", false],
    ["false || false", false],
    ["false || true", true],
    ["true || false", true],
    ["!true", false],
    ["!false", true],
    ["!!true", true],
    ["true && false || true", true],
    ["false || true && false", false],
    ["true ? 1 : 2", 1],
    ["false ? 1 : 2", 2],
    ["a.n > 3 ? 'big' : 'small'", "big"],
    ["true ? false ? 1 : 2 : 3", 2],
    ["false ? 1 : true ? 2 : 3", 2],
    ["false && (1 / 0 == 1)", false],
    ["true || (1 / 0 == 1)", true],
    ["true ? 1 : 1 / 0", 1],
    ["false ? 1 / 0 : 2", 2],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["!1", "TYPE"],
    ["!null", "TYPE"],
    ["!'true'", "TYPE"],
    ["![]", "TYPE"],
    ["1 && true", "TYPE"],
    ["true && 1", "TYPE"],
    ["null || true", "TYPE"],
    ["false || null", "TYPE"],
    ["1 ? 1 : 2", "TYPE"],
    ["null ? 1 : 2", "TYPE"],
    ["'true' ? 1 : 2", "TYPE"],
    ["true && (1 / 0 == 1)", "DIVISION_BY_ZERO"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });
});

describe("evaluateExpression: in and matches", () => {
  it.each<[string, JsonValue]>([
    ["1 in [1, 2]", true],
    ["3 in [1, 2]", false],
    ["'a' in ['a']", true],
    ["[1] in [[1]]", true],
    ["{a: 1} in [{a: 1}]", true],
    ["null in [null]", true],
    ["null in []", false],
    ["'ell' in 'hello'", true],
    ["'z' in 'hello'", false],
    ["'' in 'hello'", true],
    ["'k' in a.obj", true],
    ["'missing' in a.obj", false],
    ["'x-y' in a.obj", true],
    ["'hello' matches '^h.*o$'", true],
    ["'hello' matches '^H'", false],
    ["'a+b' matches 'a\\\\+b'", true],
    ["'' matches ''", true],
    ["'line1\\nline2' matches '^line2'", false],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["1 in 1", "TYPE"],
    ["1 in null", "TYPE"],
    ["1 in true", "TYPE"],
    ["1 in 'abc'", "TYPE"],
    ["1 in a.obj", "TYPE"],
    ["null in a.obj", "TYPE"],
    ["1 matches 'a'", "TYPE"],
    ["'a' matches 1", "INVALID_ARGUMENT"],
    ["'a' matches a.s", "INVALID_ARGUMENT"],
    ["'a' matches ('a' + 'b')", "INVALID_ARGUMENT"],
    ["null matches 'a'", "TYPE"],
    ["'a' matches '('", "INVALID_REGEX"],
    ["'a' matches '[z-a]'", "INVALID_REGEX"],
    ["'a' matches '(a+)+$'", "INVALID_REGEX"],
    ["'a' matches '\\\\d+-\\\\d+'", "INVALID_REGEX"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });
});

describe("evaluateExpression: member and index access", () => {
  it.each<[string, JsonValue]>([
    ["a.obj.missing", null],
    ["a.obj.missing.x", null],
    ["a.arr[9]", null],
    ["(a.obj).missing", null],
    ["a.obj.nested.deep", [10, 20]],
    ["a.arr[0]", 1],
    ["a.arr[-1]", 3],
    ["a.arr[-3]", 1],
    ["a.arr[3]", null],
    ["a.arr[-4]", null],
    ["a.arr[a.n - 4]", 2],
    ["a.obj['k']", "v"],
    ["a.obj['nope']", null],
    ["a.obj[a.obj.k]", null],
    ["a.obj['nested']['deep'][0]", 10],
    ["[1, 2][1]", 2],
    ["{a: {b: 1}}.a.b", 1],
    ["{'x-y': 1}['x-y']", 1],
    ["a.mixed[3][0]", 2],
    ["a.mixed[4].b", 3],
    ["a.mixed[2]", null],
    ["(a.arr)['1']", 2],
    ["$vars.list[0]", 1],
    ["$scope.item.tags[5]", null],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["(a.z).x", "TYPE"],
    ["(a.n).x", "TYPE"],
    ["(a.s).length", "TYPE"],
    ["(a.b).x", "TYPE"],
    ["(a.arr).x", "TYPE"],
    ["a.arr[1.5]", "TYPE"],
    ["a.arr[true]", "TYPE"],
    ["a.arr[null]", "TYPE"],
    ["a.arr[[0]]", "TYPE"],
    ["(a.obj)[0]", "TYPE"],
    ["a.obj[null]", "TYPE"],
    ["(a.n)[0]", "TYPE"],
    ["(a.s)[0]", "TYPE"],
    ["(a.z)[0]", "TYPE"],
    ["(a.obj).missing.deeper", "TYPE"],
    ["a.obj[a.s].deeper", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(() => run(source))).toBe(reason);
  });

  it("does not read prototype properties", () => {
    expect(run("{}['constructor']")).toBeNull();
    expect(run("{}['__proto__']")).toBeNull();
    expect(run("'constructor' in {}")).toBe(false);
    expect(run("has({}, 'toString')")).toBe(false);
    expect(run("get({}, '/toString', 'dflt')")).toBe("dflt");
  });
});

describe("evaluateExpression: bounds", () => {
  const bigScope = createEvalScope({
    ports: {
      big: {
        arr: Array.from({ length: 100_000 }, (_, i) => i),
        huge: Array.from({ length: 2_000_000 }, (_, i) => i % 10),
        str: "x".repeat(600_000),
        items: Array.from({ length: 150 }, () => "y".repeat(6_000)),
      },
    },
  });
  const runBig = (source: string): JsonValue => evaluateExpression(ast(source), bigScope);

  it("charges one step per AST node visited, lambda bodies on every invocation", () => {
    expect(MAX_EVAL_STEPS).toBe(1_000_000);
    // all(arr, x => x >= 0): call + ref = 2 steps, then binary + ident + literal = 3 per element.
    const items = (n: number): JsonValue[] => Array.from({ length: n }, () => 1);
    const budgetScope = (n: number): EvalScope =>
      createEvalScope({ ports: { p: { arr: items(n) } } });
    const exact = (MAX_EVAL_STEPS - 2) / 3;
    expect(Number.isInteger(exact)).toBe(false);
    const fits = Math.floor(exact);
    expect(evaluateExpression(ast("all(p.arr, x => x >= 0)"), budgetScope(fits))).toBe(true);
    expect(
      reasonOf(() => evaluateExpression(ast("all(p.arr, x => x >= 0)"), budgetScope(fits + 1))),
    ).toBe("STEP_LIMIT");
  });

  it("lets map, filter, any and all run over 100 000 items", () => {
    expect(runBig("len(map(big.arr, x => x))")).toBe(100_000);
    expect(runBig("len(filter(big.arr, x => x % 2 == 0))")).toBe(50_000);
    expect(runBig("any(big.arr, x => x == 99999)")).toBe(true);
    expect(runBig("all(big.arr, x => x >= 0)")).toBe(true);
    expect(runBig("sum(big.arr)")).toBe(4_999_950_000);
  });

  it("charges the array built-ins per element (sort n·log₂n) before doing the work", () => {
    expect(reasonOf(() => runBig("sort(big.huge)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("sort(big.huge, x => x)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("len(big.huge)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("sum(big.huge)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig('join(big.huge, "")'))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("11 in big.huge"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("contains(big.huge, 11)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("min(big.huge)"))).toBe("STEP_LIMIT");
    expect(reasonOf(() => runBig("map(big.huge, x => x)"))).toBe("STEP_LIMIT");
    expect(runBig("first(big.huge)")).toBe(0);
    expect(runBig("last(big.huge)")).toBe(9);
    expect(runBig("big.huge[1999999]")).toBe(9);
    // 100 000 · log₂(100 000) ≈ 1.7 M for a sort, but len/sum/join/in only cost 100 000.
    expect(reasonOf(() => runBig("sort(big.arr)"))).toBe("STEP_LIMIT");
    expect(runBig("len(big.arr)")).toBe(100_000);
    expect(runBig('len(join(big.arr, ""))')).toBe(488_890);
    expect(runBig("99999 in big.arr")).toBe(true);
    expect(runBig("max(big.arr)")).toBe(99_999);
    expect(runBig("len(split(big.str, 'xxx'))")).toBe(200_001);
    expect(runBig("len(split('a😀b', ''))")).toBe(3);
    expect(runBig("'y' in big.str")).toBe(false);
    expect(runBig("contains(big.str, 'y')")).toBe(false);
    expect(runBig("len(keys({a: 1, b: 2}))")).toBe(2);
    expect(runBig("values({a: 1, b: 2})")).toEqual([1, 2]);
  });

  it("stops when a built value exceeds MAX_EVAL_RESULT_BYTES", () => {
    expect(MAX_EVAL_RESULT_BYTES).toBe(1_048_576);
    expect(reasonOf(() => runBig("big.str + big.str"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runBig("[big.str, big.str]"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runBig("{a: big.str, b: big.str}"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runBig("map(big.items, x => x + x)"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runBig("join(map(big.items, x => x), big.str)"))).toBe(
      "RESULT_TOO_LARGE",
    );
    expect(reasonOf(() => runBig("map([1, 2, 3], x => big.str)"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runBig("json([big.str, big.str])"))).toBe("RESULT_TOO_LARGE");
    expect(runBig('len(big.str + "y")')).toBe(600_001);
    expect(runBig('len(join(big.items, ""))')).toBe(900_000);
    expect(reasonOf(() => runBig('join(big.items, "") + big.str'))).toBe("RESULT_TOO_LARGE");
  });

  it("measures values read through references against the 8 MiB input cap, not the result cap", () => {
    expect(MAX_EVAL_INPUT_BYTES).toBe(8 * 1_048_576);
    const twoMiB = Array.from({ length: 20_000 }, (_, i) => ({ id: i, text: "z".repeat(90) }));
    const nineMiB = Array.from({ length: 90_000 }, (_, i) => ({ id: i, text: "z".repeat(90) }));
    const inputScope = createEvalScope({
      ports: { n: { p: twoMiB, q: nineMiB, s: "w".repeat(2 * 1_048_576), t: "w".repeat(900_000) } },
      vars: { v: twoMiB },
    });
    const runInput = (source: string): JsonValue => evaluateExpression(ast(source), inputScope);
    expect(runInput("len(n.p)")).toBe(20_000);
    expect(runInput("len($vars.v)")).toBe(20_000);
    // Strings are charged per code unit by len/split/contains/in, so a 2 MiB string can be read and sliced but not scanned.
    expect(runInput("len(n.t)")).toBe(900_000);
    expect(runInput("starts_with(n.s, 'w')")).toBe(true);
    expect(reasonOf(() => runInput("len(n.s)"))).toBe("STEP_LIMIT");
    expect(runInput("n.p[19999].id")).toBe(19_999);
    expect(runInput("first(n.p).id")).toBe(0);
    expect(runInput("len(filter(n.p, x => x.id < 10))")).toBe(10);
    expect(runInput("len(n.p)") as number).toBeGreaterThan(0);
    // The value itself is larger than the result cap; reading it is fine, copying it is not.
    expect(Array.isArray(runInput("n.p"))).toBe(true);
    expect(reasonOf(() => runInput("[n.p]"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runInput("map(n.p, x => x)"))).toBe("RESULT_TOO_LARGE");
    expect(reasonOf(() => runInput("n.q"))).toBe("INPUT_TOO_LARGE");
    expect(reasonOf(() => runInput("len(n.q)"))).toBe("INPUT_TOO_LARGE");
    try {
      runInput("n.q");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      if (error instanceof ExpressionError)
        expect(error.details).toMatchObject({
          reason: "INPUT_TOO_LARGE",
          limit: MAX_EVAL_INPUT_BYTES,
          ref: "n.q",
        });
    }
  });

  it("carries limits in the error details", () => {
    try {
      runBig("big.str + big.str");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      if (error instanceof ExpressionError) {
        expect(error.code).toBe("EXPRESSION_ERROR");
        expect(error.retryable).toBe(false);
        expect(error.details).toMatchObject({
          reason: "RESULT_TOO_LARGE",
          limit: MAX_EVAL_RESULT_BYTES,
        });
      }
    }
  });

  it("rejects ASTs nested deeper than MAX_EXPR_DEPTH", () => {
    let deep: ExprAst = { kind: "literal", value: true };
    for (let i = 0; i < MAX_EXPR_DEPTH + 5; i += 1)
      deep = { kind: "unary", op: "!", operand: deep };
    expect(reasonOf(() => evaluateExpression(deep, scope))).toBe("DEPTH_LIMIT");
    let ok: ExprAst = { kind: "literal", value: true };
    for (let i = 0; i < MAX_EXPR_DEPTH - 2; i += 1) ok = { kind: "unary", op: "!", operand: ok };
    expect(typeof evaluateExpression(ok, scope)).toBe("boolean");
  });

  it("does not overflow the stack on hostile AST depth", () => {
    let deep: ExprAst = { kind: "literal", value: 1 };
    for (let i = 0; i < 100_000; i += 1) deep = { kind: "member", object: deep, key: "x" };
    expect(reasonOf(() => evaluateExpression(deep, scope))).toBe("DEPTH_LIMIT");
  });

  it("rejects values nested deeper than MAX_VALUE_DEPTH without overflowing the stack", () => {
    expect(MAX_VALUE_DEPTH).toBe(512);
    const nest = (depth: number, leaf: JsonValue): JsonValue => {
      let value = leaf;
      for (let i = 0; i < depth; i += 1) value = i % 2 === 0 ? [value] : { k: value };
      return value;
    };
    // A value with MAX_VALUE_DEPTH nested containers is at the cap; one more level is over it.
    const deepScope = createEvalScope({
      ports: {
        n: { p: nest(20_000, 1), ok: nest(MAX_VALUE_DEPTH, 1), over: nest(MAX_VALUE_DEPTH + 1, 1) },
      },
    });
    const runDeep = (source: string): JsonValue => evaluateExpression(ast(source), deepScope);
    for (const source of [
      "n.p",
      "n.p == n.p",
      "json(n.p)",
      "len(n.p)",
      "n.p.k",
      "(n.p).k",
      "n.p.k[0].k",
      "to_string(n.p)",
      "[n.p]",
      "n.p in [1]",
      "contains([n.p], 1)",
      "get(n.p, '/k')",
      "keys(n.p)",
    ]) {
      expect(
        reasonOf(() => runDeep(source)),
        source,
      ).toBe("DEPTH_LIMIT");
    }
    expect(runDeep("len(n.ok)")).toBe(1);
    expect(runDeep("n.ok == n.ok")).toBe(true);
    expect(typeof runDeep("json(n.ok)")).toBe("string");
    expect(reasonOf(() => runDeep("n.over"))).toBe("DEPTH_LIMIT");
    // Values an expression builds are measured the same way (the AST depth limit keeps literals shallow; parse_json does not).
    const text = "[".repeat(20_000) + "]".repeat(20_000);
    expect(
      reasonOf(() => evaluateExpression(ast(`parse_json(${JSON.stringify(text)})`), scope)),
    ).toBe("DEPTH_LIMIT");
    expect(
      evaluateExpression(
        ast(
          `len(parse_json(${JSON.stringify("[".repeat(MAX_VALUE_DEPTH) + "]".repeat(MAX_VALUE_DEPTH))}))`,
        ),
        scope,
      ),
    ).toBe(1);
    expect(
      reasonOf(() =>
        evaluateExpression(
          ast(
            `len(parse_json(${JSON.stringify("[".repeat(MAX_VALUE_DEPTH + 1) + "]".repeat(MAX_VALUE_DEPTH + 1))}))`,
          ),
          scope,
        ),
      ),
    ).toBe("DEPTH_LIMIT");
  });
});

describe("evaluateExpression: regular expressions", () => {
  const regexScope = createEvalScope({
    ports: {
      r: {
        subject: "a".repeat(26) + "!",
        long: "ab".repeat(MAX_REGEX_SUBJECT_LENGTH / 2 + 1),
        at_limit: "ab".repeat(MAX_REGEX_SUBJECT_LENGTH / 2),
        names: Array.from({ length: 2_000 }, (_, i) => ({
          name: i % 3 === 0 ? `alpha-${i}` : `beta-${i}`,
        })),
      },
    },
  });
  const runRegex = (source: string): JsonValue => evaluateExpression(ast(source), regexScope);

  it("rejects a catastrophic pattern in under 50 ms instead of backtracking", () => {
    const started = performance.now();
    for (const source of [
      "r.subject matches '(a+)+$'",
      "regex_test(r.subject, '(a+)+$')",
      "regex_match(r.subject, '^(a+)+$')",
      "r.subject matches '(\\\\w+\\\\s?)+$'",
    ]) {
      expect(
        reasonOf(() => runRegex(source)),
        source,
      ).toBe("INVALID_REGEX");
    }
    expect(performance.now() - started).toBeLessThan(50);
    try {
      runRegex("r.subject matches '(a+)+$'");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      if (error instanceof ExpressionError) {
        expect(error.message).toMatch(/exponential/);
        expect(error.details).toMatchObject({
          reason: "INVALID_REGEX",
          problem: "unsafe",
          pattern: "(a+)+$",
        });
      }
    }
  });

  it("caps the pattern at 1 024 and the subject at 65 536 characters", () => {
    expect(MAX_REGEX_PATTERN_LENGTH).toBe(1024);
    expect(MAX_REGEX_SUBJECT_LENGTH).toBe(65_536);
    const atLimit = "a".repeat(MAX_REGEX_PATTERN_LENGTH);
    const over = "a".repeat(MAX_REGEX_PATTERN_LENGTH + 1);
    expect(runRegex(`'x' matches '${atLimit}'`)).toBe(false);
    expect(reasonOf(() => runRegex(`'x' matches '${over}'`))).toBe("INVALID_ARGUMENT");
    expect(reasonOf(() => runRegex(`regex_test('x', '${over}')`))).toBe("INVALID_ARGUMENT");
    expect(reasonOf(() => runRegex(`regex_match('x', '${over}')`))).toBe("INVALID_ARGUMENT");
    expect(runRegex("r.at_limit matches '^(ab)+$'")).toBe(true);
    expect(reasonOf(() => runRegex("r.long matches '^(ab)+$'"))).toBe("INVALID_ARGUMENT");
    expect(reasonOf(() => runRegex("regex_test(r.long, '^ab')"))).toBe("INVALID_ARGUMENT");
    expect(reasonOf(() => runRegex("regex_match(r.long, '^ab')"))).toBe("INVALID_ARGUMENT");
  });

  it("compiles a pattern once per evaluation, even inside a lambda over 2 000 items", () => {
    const compiled: string[] = [];
    const spyEngine: RegexEngine = {
      compile(source: string, flags: string): CompiledRegex {
        compiled.push(`${source}/${flags}`);
        return NATIVE_REGEX_ENGINE.compile(source, flags);
      },
    };
    setDefaultRegexEngine(spyEngine);
    try {
      expect(runRegex("len(filter(r.names, x => x.name matches '^alpha-'))")).toBe(667);
      expect(compiled).toEqual(["^alpha-/"]);
      expect(runRegex("len(filter(r.names, x => regex_test(x.name, '^BETA-', 'i')))")).toBe(1_333);
      expect(compiled).toEqual(["^alpha-/", "^BETA-/i"]);
      expect(
        runRegex("len(filter(r.names, x => regex_match(x.name, '^beta-(\\\\d+)$') != null))"),
      ).toBe(1_333);
      expect(compiled).toHaveLength(3);
      // A pattern the engine cannot compile is INVALID_REGEX, never a raw error.
      setDefaultRegexEngine({
        compile: () => {
          throw new Error("unsupported by this engine");
        },
      });
      expect(reasonOf(() => runRegex("'a' matches 'a'"))).toBe("INVALID_REGEX");
    } finally {
      setDefaultRegexEngine(undefined);
    }
    expect(getDefaultRegexEngine()).toBe(NATIVE_REGEX_ENGINE);
  });

  it("memoises verdicts and evicts the least recently used entry", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
    expect(checkRegexLiteral("^a+$", "")).toEqual({ ok: true });
    expect(checkRegexLiteral("^a+$", "")).toEqual({ ok: true });
    const unsafe = checkRegexLiteral("(a+)+$", "");
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.problem).toBe("unsafe");
    expect(checkRegexLiteral("(", "")).toMatchObject({ ok: false, problem: "syntax" });
    expect(checkRegexLiteral("a", "g")).toMatchObject({ ok: false, problem: "flags" });
    expect(checkRegexLiteral("a".repeat(1025), "")).toMatchObject({ ok: false, problem: "length" });
  });
});

describe("evaluateExpression: foreign ASTs", () => {
  it.each<[ExprAst, ExpressionErrorReason]>([
    [{ kind: "call", fn: "nope", args: [] }, "UNKNOWN_FUNCTION"],
    [{ kind: "call", fn: "len", args: [] }, "ARITY"],
    [{ kind: "call", fn: "now", args: [{ kind: "literal", value: 1 }] }, "ARITY"],
    [{ kind: "ident", name: "x" }, "UNKNOWN_IDENT"],
    [{ kind: "lambda", param: "x", body: { kind: "literal", value: 1 } }, "LAMBDA_MISUSE"],
    [
      {
        kind: "call",
        fn: "map",
        args: [
          { kind: "array", items: [] },
          { kind: "literal", value: 1 },
        ],
      },
      "LAMBDA_MISUSE",
    ],
    [
      {
        kind: "call",
        fn: "len",
        args: [{ kind: "lambda", param: "x", body: { kind: "literal", value: 1 } }],
      },
      "LAMBDA_MISUSE",
    ],
    [
      {
        kind: "array",
        items: [{ kind: "lambda", param: "x", body: { kind: "literal", value: 1 } }],
      },
      "LAMBDA_MISUSE",
    ],
    [
      {
        kind: "object",
        entries: [
          { key: "a", value: { kind: "literal", value: 1 } },
          { key: "a", value: { kind: "literal", value: 2 } },
        ],
      },
      "INVALID_ARGUMENT",
    ],
    [{ kind: "literal", value: Number.POSITIVE_INFINITY }, "NOT_FINITE"],
    [{ kind: "literal", value: Number.NEGATIVE_INFINITY }, "NOT_FINITE"],
    [{ kind: "literal", value: Number.NaN }, "NOT_FINITE"],
    [
      {
        kind: "binary",
        op: "matches",
        left: { kind: "literal", value: "a" },
        right: { kind: "call", fn: "lower", args: [{ kind: "literal", value: "A" }] },
      },
      "INVALID_ARGUMENT",
    ],
    [
      {
        kind: "call",
        fn: "regex_test",
        args: [
          { kind: "literal", value: "a" },
          { kind: "ref", ref: { kind: "port", node: "a", port: "s" } },
        ],
      },
      "INVALID_ARGUMENT",
    ],
    [
      {
        kind: "call",
        fn: "regex_match",
        args: [
          { kind: "literal", value: "a" },
          { kind: "literal", value: "a" },
          { kind: "ref", ref: { kind: "port", node: "a", port: "s" } },
        ],
      },
      "INVALID_ARGUMENT",
    ],
  ])("rejects %j with %s", (node, reason) => {
    expect(reasonOf(() => evaluateExpression(node, scope))).toBe(reason);
  });

  it("never throws a raw TypeError", () => {
    const sources = [
      "(a.z).x",
      "(a.n).x",
      "!null",
      "a.arr[null]",
      "len(null)",
      "1 < 'a'",
      "(a.z)[0]",
      "keys(null)",
      "a.z + 1",
      "first(null)",
      "values(a.arr)",
    ];
    for (const source of sources) {
      try {
        run(source);
        throw new Error(`expected ${source} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError);
      }
    }
  });
});

describe("getPointer", () => {
  const value: JsonValue = { a: [1, { "b/c": 2, "d~e": 3 }], "": 0, arr: [] };
  it.each<[string, JsonValue | undefined]>([
    ["", value],
    ["/a", [1, { "b/c": 2, "d~e": 3 }]],
    ["/a/0", 1],
    ["/a/1/b~1c", 2],
    ["/a/1/d~0e", 3],
    ["/", 0],
    ["/a/2", undefined],
    ["/a/-", undefined],
    ["/a/01", undefined],
    ["/a/x", undefined],
    ["/a/0/x", undefined],
    ["/nope", undefined],
    ["/arr/0", undefined],
  ])("%j → %j", (pointer, expected) => {
    expect(getPointer(value, pointer)).toEqual(expected);
  });
  it("rejects malformed pointers", () => {
    expect(reasonOf(() => getPointer(value, "a"))).toBe("INVALID_POINTER");
    expect(reasonOf(() => getPointer(value, "/a~2"))).toBe("INVALID_POINTER");
  });
});
