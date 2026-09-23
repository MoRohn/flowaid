import { describe, expect, it } from "vitest";
import type { ExprAst } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import type { JsonValue } from "../json.js";
import {
  evaluateExpression,
  expressionErrorReason,
  type ExpressionErrorReason,
} from "./evaluator.js";
import { EXPRESSION_FUNCTION_NAMES, FUNCTION_SIGNATURES, LAMBDA_FUNCTIONS } from "./functions.js";
import { parseExpression } from "./parser.js";
import { createEvalScope } from "./scope.js";

const scope = createEvalScope({
  ports: {
    d: {
      people: [
        { name: "Bo", age: 30 },
        { name: "Al", age: 25 },
        { name: "Cy", age: 35 },
      ],
      nums: [3, 1, 2],
      strs: ["b", "a", "c"],
      empty: [],
      obj: { b: 2, a: 1 },
      text: "  Hello World  ",
      json: '{"a":[1,2,{"b":null}]}',
      iso: "2026-03-04T05:06:07.089Z",
      big: 1e308,
      mixed: [1, "a"],
      nested: [[1, 2], [3]],
      nulls: [null, 1, null],
    },
  },
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
function reasonOf(source: string): ExpressionErrorReason | undefined {
  try {
    run(source);
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return expressionErrorReason(error);
  }
  throw new Error(`expected '${source}' to throw`);
}

describe("function set", () => {
  it("has a signature for every function and lambda functions are marked", () => {
    expect(EXPRESSION_FUNCTION_NAMES).toHaveLength(37);
    for (const name of EXPRESSION_FUNCTION_NAMES) {
      const sig = FUNCTION_SIGNATURES[name];
      expect(sig.minArgs).toBeLessThanOrEqual(sig.maxArgs);
      expect(sig.lambdaArg !== undefined).toBe(LAMBDA_FUNCTIONS.has(name));
    }
  });
});

describe("string functions", () => {
  it.each<[string, JsonValue]>([
    ["len('')", 0],
    ["len('abc')", 3],
    ["len('héllo')", 5],
    ["len('😀')", 1],
    ["len([1, 2, 3])", 3],
    ["len([])", 0],
    ["len({a: 1, b: 2})", 2],
    ["len({})", 0],
    ["lower('AbC')", "abc"],
    ["lower('ÀÉ')", "àé"],
    ["upper('abc')", "ABC"],
    ["trim('  a b  ')", "a b"],
    ["trim(d.text)", "Hello World"],
    ["trim('\\n\\t x \\r')", "x"],
    ["contains('hello', 'ell')", true],
    ["contains('hello', 'xyz')", false],
    ["contains('hello', '')", true],
    ["contains([1, 2], 2)", true],
    ["contains([1, 2], 3)", false],
    ["contains([[1]], [1])", true],
    ["contains([{a: 1}], {a: 1})", true],
    ["contains([null], null)", true],
    ["contains([], 1)", false],
    ["starts_with('hello', 'he')", true],
    ["starts_with('hello', 'lo')", false],
    ["starts_with('hello', '')", true],
    ["ends_with('hello', 'lo')", true],
    ["ends_with('hello', 'he')", false],
    ["split('a,b,c', ',')", ["a", "b", "c"]],
    ["split('abc', '')", ["a", "b", "c"]],
    ["split('a😀b', '')", ["a", "😀", "b"]],
    ["split('', ',')", [""]],
    ["split('a,,b', ',')", ["a", "", "b"]],
    ["split('a.b', '.')", ["a", "b"]],
    ["join(['a', 'b'], '-')", "a-b"],
    ["join(['a', 'b'])", "a,b"],
    ["join([], '-')", ""],
    ["join([1, true, null, 'x'], ' ')", "1 true  x"],
    ["join([[1], {a: 1}], ';')", '[1];{"a":1}'],
    ["join(['x'], '')", "x"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["len(1)", "TYPE"],
    ["len(null)", "TYPE"],
    ["len(true)", "TYPE"],
    ["lower(1)", "TYPE"],
    ["lower(null)", "TYPE"],
    ["upper([])", "TYPE"],
    ["trim({})", "TYPE"],
    ["contains(1, 'a')", "TYPE"],
    ["contains('a', 1)", "TYPE"],
    ["contains(null, 'a')", "TYPE"],
    ["contains({a: 1}, 'a')", "TYPE"],
    ["starts_with(1, 'a')", "TYPE"],
    ["starts_with('a', 1)", "TYPE"],
    ["ends_with(null, 'a')", "TYPE"],
    ["ends_with('a', null)", "TYPE"],
    ["split(1, ',')", "TYPE"],
    ["split('a', 1)", "TYPE"],
    ["join('abc', ',')", "TYPE"],
    ["join([1], 1)", "TYPE"],
    ["join(null)", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(source)).toBe(reason);
  });
});

describe("json functions", () => {
  it.each<[string, JsonValue]>([
    ["json(1)", "1"],
    ["json('a')", '"a"'],
    ["json(null)", "null"],
    ["json(true)", "true"],
    ['json([1, "a"])', '[1,"a"]'],
    ["json({b: 2, a: 1})", '{"b":2,"a":1}'],
    ["json('\\n\"')", '"\\n\\""'],
    ["parse_json(d.json)", { a: [1, 2, { b: null }] }],
    ["parse_json('1')", 1],
    ["parse_json('\"s\"')", "s"],
    ["parse_json('null')", null],
    ["parse_json(' [1] ')", [1]],
    ["parse_json(json({a: [1]}))", { a: [1] }],
    ["keys({b: 2, a: 1})", ["b", "a"]],
    ["keys({})", []],
    ["keys(d.obj)", ["b", "a"]],
    ["values({b: 2, a: 1})", [2, 1]],
    ["values({})", []],
    ["has({a: 1}, 'a')", true],
    ["has({a: null}, 'a')", true],
    ["has({a: 1}, 'b')", false],
    ["has([1, 2], 1)", true],
    ["has([1, 2], 2)", false],
    ["has([1, 2], -1)", false],
    ["has([1, 2], 0.5)", false],
    ["has([1, 2], '0')", true],
    ["has([1, 2], '1')", true],
    ["has([1, 2], '2')", false],
    ["has([], '0')", false],
    ["get({a: {b: [1, 2]}}, '/a/b/1')", 2],
    ["get({a: 1}, '')", { a: 1 }],
    ["get({a: 1}, '/x')", null],
    ["get({a: 1}, '/x', 'dflt')", "dflt"],
    ["get({a: 1}, '/x', null)", null],
    ["get([1, 2], '/1')", 2],
    ["get([1, 2], '/5', 0)", 0],
    ["get({'a/b': 1}, '/a~1b')", 1],
    ["get({'a~b': 1}, '/a~0b')", 1],
    ["get(1, '/a', 'x')", "x"],
    ["get(null, '', 'x')", null],
    ["get({a: null}, '/a', 'x')", null],
    ["coalesce(null, 1)", 1],
    ["coalesce(1, 2)", 1],
    ["coalesce(null, null)", null],
    ["coalesce(null)", null],
    ["coalesce(null, false, 'x')", false],
    ["coalesce(null, null, [], 1)", []],
    ["coalesce(d.obj.zzz, 'dflt')", "dflt"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["parse_json('{')", "INVALID_JSON"],
    ["parse_json('')", "INVALID_JSON"],
    ["parse_json('undefined')", "INVALID_JSON"],
    ["parse_json(1)", "TYPE"],
    ["parse_json(null)", "TYPE"],
    ["keys([1])", "TYPE"],
    ["keys(null)", "TYPE"],
    ["keys('a')", "TYPE"],
    ["values([1])", "TYPE"],
    ["values(1)", "TYPE"],
    ["has({}, 1)", "TYPE"],
    ["has([], 'a')", "TYPE"],
    ["has([1, 2], '01')", "TYPE"],
    ["has([1, 2], '-1')", "TYPE"],
    ["has([1, 2], '1.0')", "TYPE"],
    ["has([1, 2], '')", "TYPE"],
    ["has([1, 2], ' 1')", "TYPE"],
    ["has('abc', 'a')", "TYPE"],
    ["has(null, 'a')", "TYPE"],
    ["get({}, 'a')", "INVALID_POINTER"],
    ["get({}, '/a~2')", "INVALID_POINTER"],
    ["get({}, 1)", "TYPE"],
    ["get({}, null)", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(source)).toBe(reason);
  });
});

describe("number functions", () => {
  it.each<[string, JsonValue]>([
    ["min(3, 1, 2)", 1],
    ["max(3, 1, 2)", 3],
    ["min([3, 1, 2])", 1],
    ["max([3, 1, 2])", 3],
    ["min(5)", 5],
    ["min([])", null],
    ["max([])", null],
    ["min(-1, -2)", -2],
    ["max(1.5, 1.25)", 1.5],
    ["min(d.nums)", 1],
    ["abs(-3)", 3],
    ["abs(3)", 3],
    ["abs(-0.5)", 0.5],
    ["abs(0)", 0],
    ["round(2.5)", 3],
    ["round(-2.5)", -3],
    ["round(2.4)", 2],
    ["round(1.005, 2)", 1.01],
    ["round(1.2345, 2)", 1.23],
    ["round(-1.2345, 3)", -1.235],
    ["round(3, 2)", 3],
    ["round(1e21, 2)", 1e21],
    ["round(0.1 + 0.2, 10)", 0.3],
    ["floor(2.7)", 2],
    ["floor(-2.2)", -3],
    ["ceil(2.1)", 3],
    ["ceil(-2.7)", -2],
    ["sum([1, 2, 3])", 6],
    ["sum([])", 0],
    ["sum([1.5, -0.5])", 1],
    ["sum(d.nums)", 6],
    ["avg([1, 2, 3])", 2],
    ["avg([])", null],
    ["avg([1, 2])", 1.5],
    ["first([1, 2])", 1],
    ["last([1, 2])", 2],
    ["first([])", null],
    ["last([])", null],
    ["first([null])", null],
    ["first(d.nested)", [1, 2]],
    ['to_number("42")', 42],
    ['to_number(" 42 ")', 42],
    ['to_number("-1.5e2")', -150],
    ['to_number("0")', 0],
    ["to_number(7)", 7],
    ["to_number(true)", 1],
    ["to_number(false)", 0],
    ["to_string(1)", "1"],
    ["to_string(1.5)", "1.5"],
    ["to_string(true)", "true"],
    ["to_string(null)", ""],
    ['to_string("s")', "s"],
    ['to_string([1, "a"])', '[1,"a"]'],
    ["to_string({a: 1})", '{"a":1}'],
    ["to_string(1e21)", "1e+21"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["min(1, 'a')", "TYPE"],
    ["min(['a'])", "TYPE"],
    ["min([1, null])", "TYPE"],
    ["max(null)", "TYPE"],
    ["max('a')", "TYPE"],
    ["abs('1')", "TYPE"],
    ["abs(null)", "TYPE"],
    ["round('1')", "TYPE"],
    ["round(1, 1.5)", "INVALID_ARGUMENT"],
    ["round(1, -1)", "INVALID_ARGUMENT"],
    ["round(1, 'a')", "TYPE"],
    ["floor(null)", "TYPE"],
    ["ceil([])", "TYPE"],
    ["sum(1)", "TYPE"],
    ["sum(['a'])", "TYPE"],
    ["sum([1, null])", "TYPE"],
    ["sum([d.big, d.big])", "NOT_FINITE"],
    ["avg(null)", "TYPE"],
    ["avg([true])", "TYPE"],
    ["first('ab')", "TYPE"],
    ["first(null)", "TYPE"],
    ["last({})", "TYPE"],
    ["to_number('abc')", "INVALID_NUMBER"],
    ["to_number('')", "INVALID_NUMBER"],
    ["to_number('1x')", "INVALID_NUMBER"],
    ["to_number('0x10')", "INVALID_NUMBER"],
    ["to_number('Infinity')", "INVALID_NUMBER"],
    ["to_number('NaN')", "INVALID_NUMBER"],
    ["to_number('1e999')", "NOT_FINITE"],
    ["to_number(null)", "TYPE"],
    ["to_number([1])", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(source)).toBe(reason);
  });
});

describe("array functions with lambdas", () => {
  it.each<[string, JsonValue]>([
    ["filter([1, 2, 3], x => x > 1)", [2, 3]],
    ["filter([], x => true)", []],
    [
      "filter(d.people, p => p.age >= 30)",
      [
        { name: "Bo", age: 30 },
        { name: "Cy", age: 35 },
      ],
    ],
    ["map([1, 2], x => x * 2)", [2, 4]],
    ["map(d.people, p => p.name)", ["Bo", "Al", "Cy"]],
    ["map([], x => x)", []],
    ["map(d.nested, x => len(x))", [2, 1]],
    ["map([1, 2], x => {v: x})", [{ v: 1 }, { v: 2 }]],
    ["map([[1, 2], [3]], xs => map(xs, x => x + 1))", [[2, 3], [4]]],
    ["map([1, 2], x => map([10], y => x + y))", [[11], [12]]],
    ["map([1], x => map([2], x => x))", [[2]]],
    ["any([1, 2], x => x > 1)", true],
    ["any([1, 2], x => x > 5)", false],
    ["any([], x => true)", false],
    ["all([1, 2], x => x > 0)", true],
    ["all([1, 2], x => x > 1)", false],
    ["all([], x => false)", true],
    ["sort([3, 1, 2])", [1, 2, 3]],
    ["sort(['b', 'a', 'c'])", ["a", "b", "c"]],
    ["sort([])", []],
    [
      "sort(d.people, p => p.age)",
      [
        { name: "Al", age: 25 },
        { name: "Bo", age: 30 },
        { name: "Cy", age: 35 },
      ],
    ],
    [
      "sort(d.people, p => p.name)",
      [
        { name: "Al", age: 25 },
        { name: "Bo", age: 30 },
        { name: "Cy", age: 35 },
      ],
    ],
    ["sort([3, 1, 2], x => -x)", [3, 2, 1]],
    [
      'sort([{k: 1, v: "a"}, {k: 0, v: "b"}, {k: 1, v: "c"}], x => x.k)',
      [
        { k: 0, v: "b" },
        { k: 1, v: "a" },
        { k: 1, v: "c" },
      ],
    ],
    ["sort(['B', 'a'])", ["B", "a"]],
    ["sort([1.5, 1.25, -1])", [-1, 1.25, 1.5]],
    ['len(filter(d.people, p => contains(p.name, "y")))', 1],
    ["sum(map(d.people, p => p.age))", 90],
    ["first(sort(d.nums))", 1],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it("does not mutate the input array when sorting", () => {
    expect(run("sort(d.nums)")).toEqual([1, 2, 3]);
    expect(run("d.nums")).toEqual([3, 1, 2]);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["filter(1, x => true)", "TYPE"],
    ["filter(null, x => true)", "TYPE"],
    ["filter([1], x => x)", "TYPE"],
    ["filter([1], x => null)", "TYPE"],
    ['map("ab", x => x)', "TYPE"],
    ["map({a: 1}, x => x)", "TYPE"],
    ["any([1], x => 1)", "TYPE"],
    ['all([1], x => "yes")', "TYPE"],
    ["any(null, x => true)", "TYPE"],
    ["sort(d.mixed)", "TYPE"],
    ["sort([1, null])", "TYPE"],
    ["sort([[1], [2]])", "TYPE"],
    ["sort([true, false])", "TYPE"],
    ["sort(d.people)", "TYPE"],
    ["sort(d.people, p => p)", "TYPE"],
    ["sort([1, 2], x => null)", "TYPE"],
    ["sort(1)", "TYPE"],
    ["map([1], x => x / 0)", "DIVISION_BY_ZERO"],
    ["map([1], x => x.y)", "TYPE"],
    ["map([{a: 1}], x => x.a.b)", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(source)).toBe(reason);
  });
});

describe("regex and date functions", () => {
  it.each<[string, JsonValue]>([
    ["regex_test('abc', 'b')", true],
    ["regex_test('abc', '^b')", false],
    ["regex_test('ABC', 'b', 'i')", true],
    ["regex_test('a\\nb', '^b', 'm')", true],
    ["regex_test('a\\nb', 'a.b', 's')", true],
    ["regex_test('a\\nb', 'a.b')", false],
    ["regex_test('😀', '^.$', 'u')", true],
    ["regex_test('', '')", true],
    [
      "regex_match('2026-03-04', '^(\\\\d+)-(\\\\d+)-(\\\\d+)$')",
      ["2026-03-04", "2026", "03", "04"],
    ],
    [
      "regex_match('x=2026-03-04', '(?<=x=)(\\\\d{4})-(\\\\d{2})-(\\\\d{2})$')",
      ["2026-03-04", "2026", "03", "04"],
    ],
    ["regex_match('abc', 'z')", null],
    ["regex_match('abc', 'b')", ["b"]],
    ["regex_match('abc', '(x)?b')", ["b", null]],
    ["regex_match('ABC', 'b', 'i')", ["B"]],
    ["regex_match('aaa', 'a')", ["a"]],
    ["now()", "2026-01-02T03:04:05.000Z"],
    ["format_date(d.iso)", "2026-03-04T05:06:07.089Z"],
    ["format_date(d.iso, 'YYYY-MM-DD')", "2026-03-04"],
    ["format_date(d.iso, 'HH:mm:ss.SSS')", "05:06:07.089"],
    ["format_date(d.iso, 'DD/MM/YYYY [at] HH[h]')", "04/03/2026 at 05h"],
    ["format_date(d.iso, 'literal')", "literal"],
    ["format_date(d.iso, '')", ""],
    ["format_date(0, 'YYYY')", "1970"],
    ["format_date(1000)", "1970-01-01T00:00:01.000Z"],
    ["format_date('2026-03-04')", "2026-03-04T00:00:00.000Z"],
    ["format_date('2026-03-04T05:06:07+02:00', 'HH:mm')", "03:06"],
    ["format_date(now(), 'YYYY')", "2026"],
    ["format_date('0001-01-01T00:00:00Z', 'YYYY')", "0001"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toEqual(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["regex_test(1, 'a')", "TYPE"],
    ["regex_test('a', 1)", "INVALID_ARGUMENT"],
    ["regex_test('a', 'a', 1)", "INVALID_ARGUMENT"],
    ["regex_test('a', d.text)", "INVALID_ARGUMENT"],
    ["regex_test('a', 'a', d.text)", "INVALID_ARGUMENT"],
    ["regex_match('a', 'a' + 'b')", "INVALID_ARGUMENT"],
    ["regex_test('a', '(')", "INVALID_REGEX"],
    ["regex_test('a', '(a+)+$')", "INVALID_REGEX"],
    ["regex_match('2026-03-04', '(\\\\d+)-(\\\\d+)-(\\\\d+)')", "INVALID_REGEX"],
    ["regex_test('a', '(a|a)*b', 'i')", "INVALID_REGEX"],
    ["regex_test('a', 'a', 'g')", "INVALID_ARGUMENT"],
    ["regex_test('a', 'a', 'y')", "INVALID_ARGUMENT"],
    ["regex_test('a', 'a', 'ii')", "INVALID_ARGUMENT"],
    ["regex_test('a', 'a', 'x')", "INVALID_ARGUMENT"],
    ["regex_match(null, 'a')", "TYPE"],
    ["regex_match('a', '[')", "INVALID_REGEX"],
    ["regex_match('a', 'a', 'g')", "INVALID_ARGUMENT"],
    ["format_date('not a date')", "INVALID_DATE"],
    ["format_date('')", "INVALID_DATE"],
    ["format_date(null)", "TYPE"],
    ["format_date(true)", "TYPE"],
    ["format_date([])", "TYPE"],
    ["format_date(d.iso, 1)", "TYPE"],
    ["format_date(1e20)", "INVALID_DATE"],
  ])("%s → %s", (source, reason) => {
    expect(reasonOf(source)).toBe(reason);
  });
});

describe("has: agrees with index access on arrays", () => {
  it.each<[string, string]>([
    ["[1, 2]", "'0'"],
    ["[1, 2]", "'1'"],
    ["[1, 2]", "'2'"],
    ["[1, 2]", "0"],
    ["[1, 2]", "5"],
    ["[]", "'0'"],
  ])("has(%s, %s) is true exactly when the index reads an element", (array, key) => {
    const present = run(`has(${array}, ${key})`);
    expect(present).toBe(run(`len(${array}) > ${key.replace(/'/g, "")}`));
    if (present === true) expect(run(`${array}[${key}]`)).not.toBeNull();
    else expect(run(`${array}[${key}]`)).toBeNull();
  });
});
