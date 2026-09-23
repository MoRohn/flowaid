import { describe, expect, it } from "vitest";
import { formatRef, type ExprAst, type Ref } from "../bindings.js";
import type { JsonSchema } from "../json.js";
import { EXPRESSION_TOO_DEEP_MESSAGE, MAX_EXPR_DEPTH } from "./functions.js";
import { parseExpression } from "./parser.js";
import {
  BOOLEAN,
  INTEGER,
  NULL,
  NUMBER,
  STRING,
  UNKNOWN,
  arrayOf,
  formatType,
  inferExprSchema,
  inferExprType,
  isBooleanType,
  mayBeContainer,
  objectOf,
  sameType,
  schemaFromType,
  typeFromSchema,
  unionOf,
  withoutNull,
  type ExprType,
  type TypeEnv,
  type TypeIssue,
} from "./typer.js";

const schemas: Record<string, JsonSchema> = {
  "a.n": { type: "number" },
  "a.i": { type: "integer" },
  "a.s": { type: "string" },
  "a.b": { type: "boolean" },
  "a.z": { type: "null" },
  "a.arr": { type: "array", items: { type: "number" } },
  "a.strs": { type: "array", items: { type: "string" } },
  "a.anyarr": { type: "array" },
  "a.obj": {
    type: "object",
    properties: { k: { type: "string" }, opt: { type: "number" } },
    required: ["k"],
    additionalProperties: false,
  },
  "a.open": { type: "object", properties: { k: { type: "string" } }, required: ["k"] },
  "a.map": { type: "object", additionalProperties: { type: "integer" } },
  "a.people": {
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, age: { type: "integer" } },
      required: ["name", "age"],
      additionalProperties: false,
    },
  },
  "a.items": {
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  "a.obj_or_str": {
    anyOf: [
      {
        type: "object",
        properties: { k: { type: "string" } },
        required: ["k"],
        additionalProperties: false,
      },
      { type: "string" },
    ],
  },
  "a.arr_or_null": { type: ["array", "null"], items: { type: "integer" } },
  "a.category": { enum: ["billing", "other"] },
  "a.level": { enum: [1, 2, 3] },
  "a.sn": { type: ["string", "null"] },
  "a.enum": { enum: ["x", "y"] },
  "a.mixed_enum": { enum: [1, "a", null] },
  "a.const": { const: 5 },
  "a.anyof": { anyOf: [{ type: "string" }, { type: "number" }] },
  "a.oneof": { oneOf: [{ type: "boolean" }, { type: "null" }] },
  "a.ref": { $ref: "#/$defs/x" },
  "a.allof": { allOf: [{ type: "string" }] },
  "a.empty": {},
  "a.tuple": { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false },
  "a.untyped_props": { properties: { q: { type: "boolean" } } },
  "$vars.t": { type: "number" },
  "$scope.item": {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  "$run.id": { type: "string" },
};
/** A miniature `projectSchema`: walks a ref path through properties/items so `a.obj.k` is typed like the compiler would. */
function project(schema: JsonSchema | undefined, path: string | undefined): JsonSchema | undefined {
  if (schema === undefined || path === undefined || path === "") return schema;
  let current: JsonSchema | undefined = schema;
  for (const token of path.slice(1).split("/")) {
    if (current === undefined) return undefined;
    if (current.type === "object") {
      const prop: JsonSchema | undefined = current.properties?.[token];
      current =
        prop ??
        (typeof current.additionalProperties === "object"
          ? current.additionalProperties
          : undefined);
    } else if (current.type === "array") {
      current = typeof current.items === "object" ? current.items : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}
const env: TypeEnv = {
  schemaOf: (ref: Ref) => {
    const path = ref.kind === "port" || ref.kind === "scope" ? ref.path : undefined;
    const base: Ref =
      ref.kind === "port"
        ? { kind: "port", node: ref.node, port: ref.port }
        : ref.kind === "scope"
          ? { kind: "scope", field: ref.field }
          : ref;
    return project(schemas[formatRef(base)], path);
  },
};

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.message}`);
  return r.ast;
}
function typeOf(source: string): ExprType {
  return inferExprType(ast(source), env).type;
}
function issues(source: string): TypeIssue[] {
  return inferExprType(ast(source), env).issues;
}

describe("type model", () => {
  it("unionOf normalises", () => {
    expect(unionOf(STRING)).toEqual(STRING);
    expect(unionOf(STRING, STRING)).toEqual(STRING);
    expect(unionOf(STRING, NUMBER)).toEqual({ kind: "union", members: [STRING, NUMBER] });
    expect(unionOf(INTEGER, NUMBER)).toEqual(NUMBER);
    expect(unionOf(NUMBER, INTEGER)).toEqual(NUMBER);
    expect(unionOf(STRING, UNKNOWN)).toEqual(UNKNOWN);
    expect(unionOf()).toEqual(UNKNOWN);
    expect(unionOf(unionOf(STRING, NULL), NUMBER)).toEqual({
      kind: "union",
      members: [STRING, NULL, NUMBER],
    });
    expect(unionOf(arrayOf(STRING), arrayOf(STRING))).toEqual(arrayOf(STRING));
  });
  it("sameType is structural", () => {
    expect(sameType(objectOf({ a: STRING }), objectOf({ a: STRING }))).toBe(true);
    expect(sameType(objectOf({ a: STRING }), objectOf({ a: NUMBER }))).toBe(false);
    expect(sameType(objectOf({ a: STRING }), objectOf({ a: STRING }, { required: [] }))).toBe(
      false,
    );
    expect(
      sameType(objectOf({ a: STRING }), objectOf({ a: STRING }, { additional: UNKNOWN })),
    ).toBe(false);
    expect(sameType(unionOf(STRING, NUMBER), unionOf(NUMBER, STRING))).toBe(true);
    expect(sameType(INTEGER, NUMBER)).toBe(false);
    expect(sameType(arrayOf(STRING), arrayOf(NUMBER))).toBe(false);
  });
  it("withoutNull / isBooleanType / mayBeContainer / formatType", () => {
    expect(withoutNull(unionOf(STRING, NULL))).toEqual(STRING);
    expect(withoutNull(NULL)).toEqual(NULL);
    expect(withoutNull(UNKNOWN)).toEqual(UNKNOWN);
    expect(isBooleanType(BOOLEAN)).toBe(true);
    expect(isBooleanType(unionOf(BOOLEAN, NULL))).toBe(false);
    expect(isBooleanType(UNKNOWN)).toBe(false);
    expect(mayBeContainer(arrayOf(STRING))).toBe(true);
    expect(mayBeContainer(unionOf(STRING, objectOf({})))).toBe(true);
    expect(mayBeContainer(STRING)).toBe(false);
    expect(mayBeContainer(UNKNOWN)).toBe(false);
    expect(
      formatType(objectOf({ a: STRING, b: INTEGER }, { required: ["a"], additional: NUMBER })),
    ).toBe("{a: string, b?: integer, ...: number}");
    expect(formatType(unionOf(arrayOf(STRING), NULL))).toBe("array<string> | null");
  });
});

describe("typeFromSchema / schemaFromType", () => {
  it.each<[string, ExprType]>([
    ["a.n", NUMBER],
    ["a.i", INTEGER],
    ["a.s", STRING],
    ["a.b", BOOLEAN],
    ["a.z", NULL],
    ["a.arr", arrayOf(NUMBER)],
    ["a.anyarr", arrayOf(UNKNOWN)],
    ["a.obj", objectOf({ k: STRING, opt: NUMBER }, { required: ["k"] })],
    ["a.open", objectOf({ k: STRING }, { additional: UNKNOWN })],
    ["a.map", objectOf({}, { additional: INTEGER })],
    ["a.sn", unionOf(STRING, NULL)],
    ["a.enum", STRING],
    ["a.mixed_enum", unionOf(INTEGER, STRING, NULL)],
    ["a.const", INTEGER],
    ["a.anyof", unionOf(STRING, NUMBER)],
    ["a.oneof", unionOf(BOOLEAN, NULL)],
    ["a.ref", UNKNOWN],
    ["a.allof", UNKNOWN],
    ["a.empty", UNKNOWN],
    ["a.tuple", arrayOf(unionOf(STRING, NUMBER))],
    ["a.untyped_props", objectOf({ q: BOOLEAN }, { required: [], additional: UNKNOWN })],
    ["a.nope", UNKNOWN],
  ])("%s converts", (source, expected) => {
    expect(typeOf(source)).toEqual(expected);
  });

  it.each<[ExprType, JsonSchema]>([
    [UNKNOWN, {}],
    [NULL, { type: "null" }],
    [BOOLEAN, { type: "boolean" }],
    [NUMBER, { type: "number" }],
    [INTEGER, { type: "integer" }],
    [STRING, { type: "string" }],
    [arrayOf(STRING), { type: "array", items: { type: "string" } }],
    [arrayOf(UNKNOWN), { type: "array" }],
    [
      objectOf({ a: STRING }),
      {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      },
    ],
    [objectOf({}, { additional: UNKNOWN }), { type: "object", properties: {} }],
    [
      objectOf({}, { additional: NUMBER }),
      { type: "object", properties: {}, additionalProperties: { type: "number" } },
    ],
    [unionOf(STRING, NULL), { anyOf: [{ type: "string" }, { type: "null" }] }],
  ])("renders %j", (type, schema) => {
    expect(schemaFromType(type)).toEqual(schema);
    expect(typeFromSchema(schemaFromType(type))).toEqual(type);
  });

  it("exposes the contract-shaped inferExprSchema", () => {
    expect(inferExprSchema(ast("a.n + 1"), env)).toEqual({
      kind: "schema",
      schema: { type: "number" },
    });
    expect(inferExprSchema(ast("a.nope"), env)).toEqual({ kind: "unknown" });
    expect(inferExprType(ast("len(a.s)"), env).schema).toEqual({ type: "integer" });
  });
});

describe("inferExprType: well-typed expressions", () => {
  it.each<[string, ExprType]>([
    ["1", INTEGER],
    ["1.5", NUMBER],
    ["'x'", STRING],
    ["true", BOOLEAN],
    ["null", NULL],
    ["[1, 2]", arrayOf(INTEGER)],
    ["[1, 'a']", arrayOf(unionOf(INTEGER, STRING))],
    ["[]", arrayOf(UNKNOWN)],
    ['{a: 1, b: "x"}', objectOf({ a: INTEGER, b: STRING })],
    ["-a.n", NUMBER],
    ["-a.i", INTEGER],
    ["!a.b", BOOLEAN],
    ["a.i + 1", INTEGER],
    ["a.i + a.n", NUMBER],
    ["a.i * 2 - 1", INTEGER],
    ["a.i % 2", INTEGER],
    ["a.i / 2", NUMBER],
    ["a.s + 'x'", STRING],
    ["a.n < 1", BOOLEAN],
    ["a.s < 'x'", BOOLEAN],
    ["a.n == a.i", BOOLEAN],
    ["a.i == 1.5", BOOLEAN],
    ["a.s != a.sn", BOOLEAN],
    ["a.sn == null", BOOLEAN],
    ["null != a.s", BOOLEAN],
    ["a.obj.opt == null", BOOLEAN],
    ["(a.obj).opt == null", BOOLEAN],
    ["a.mixed_enum == 1", BOOLEAN],
    ['a.anyof == "x"', BOOLEAN],
    ["a.enum == 'x'", BOOLEAN],
    ["'y' == a.enum", BOOLEAN],
    ["a.s == a.enum", BOOLEAN],
    ["a.enum != a.enum", BOOLEAN],
    ["a.category == 'billing'", BOOLEAN],
    ["a.level == 2", BOOLEAN],
    ["a.level == a.i", BOOLEAN],
    ["a.const == 5", BOOLEAN],
    ["a.arr == [1]", BOOLEAN],
    ['a.obj == {k: "v"}', BOOLEAN],
    ["a.b == true", BOOLEAN],
    ["len(a.items) == 3", BOOLEAN],
    ["a.b && a.b", BOOLEAN],
    ["a.b || false", BOOLEAN],
    ["a.n in a.arr", BOOLEAN],
    ["'k' in a.obj", BOOLEAN],
    ["'k' in a.s", BOOLEAN],
    ["a.s matches 'x'", BOOLEAN],
    ["a.b ? 1 : 'x'", unionOf(INTEGER, STRING)],
    ["a.b ? a.n : a.i", NUMBER],
    ["a.obj.k", STRING],
    ["a.obj.opt", NUMBER],
    ["(a.obj).k", STRING],
    ["(a.obj).opt", unionOf(NUMBER, NULL)],
    ["a.open.k", STRING],
    ["a.open.other", UNKNOWN],
    ["(a.open).other", UNKNOWN],
    ["a.map.anything", INTEGER],
    ["(a.map).anything", unionOf(INTEGER, NULL)],
    ["a.arr[0]", NUMBER],
    ["(a.arr)[0]", unionOf(NUMBER, NULL)],
    ["a.arr[a.i]", unionOf(NUMBER, NULL)],
    ["a.people[0].name", STRING],
    ["(a.people)[0]", unionOf(objectOf({ name: STRING, age: INTEGER }), NULL)],
    ["(a.people)[0].name", unionOf(STRING, NULL)],
    ['(a.people)[0]["age"]', unionOf(INTEGER, NULL)],
    ["(a.people)[0][a.s]", unionOf(STRING, INTEGER, NULL)],
    ["first(a.items).name", unionOf(STRING, NULL)],
    ["last(a.items).tags", unionOf(arrayOf(STRING), NULL)],
    ["sort(a.items, x => x.name)[0].name", unionOf(STRING, NULL)],
    ["map(a.items, x => x.tags[0])", arrayOf(unionOf(STRING, NULL))],
    ["(a.arr_or_null)[0]", unionOf(INTEGER, NULL)],
    ["(a.arr_or_null)[a.i]", unionOf(INTEGER, NULL)],
    ['(a.arr_or_null)["0"]', unionOf(INTEGER, NULL)],
    ["(a.obj_or_str).k", STRING],
    ['(a.obj_or_str)["k"]', STRING],
    ['coalesce(first(a.items).name, "none")', STRING],
    ['(a.obj)["k"]', STRING],
    ["a.obj[a.s]", unionOf(STRING, NUMBER, NULL)],
    ["$vars.t * 2", NUMBER],
    ["$scope.item.title", STRING],
    ["$run.id", STRING],
    ["a.sn", unionOf(STRING, NULL)],
    ["len(a.s)", INTEGER],
    ["len(a.arr)", INTEGER],
    ["len(a.obj)", INTEGER],
    ["lower(a.s)", STRING],
    ["upper(a.s)", STRING],
    ["trim(a.s)", STRING],
    ["contains(a.s, 'x')", BOOLEAN],
    ["contains(a.arr, 1)", BOOLEAN],
    ["starts_with(a.s, 'x')", BOOLEAN],
    ["ends_with(a.s, 'x')", BOOLEAN],
    ["split(a.s, ',')", arrayOf(STRING)],
    ["join(a.strs)", STRING],
    ["join(a.arr, ',')", STRING],
    ["json(a.obj)", STRING],
    ["parse_json(a.s)", UNKNOWN],
    ["keys(a.obj)", arrayOf(STRING)],
    ["values(a.obj)", arrayOf(unionOf(STRING, NUMBER, NULL))],
    ["values(a.map)", arrayOf(INTEGER)],
    ["has(a.obj, 'k')", BOOLEAN],
    ["has(a.arr, 0)", BOOLEAN],
    ["get(a.obj, '/k')", UNKNOWN],
    ['coalesce(a.sn, "d")', STRING],
    ["coalesce((a.obj).opt, 0)", NUMBER],
    ["coalesce(a.sn, a.z)", unionOf(STRING, NULL)],
    ["min(a.n, a.i)", NUMBER],
    ["max(1, 2)", INTEGER],
    ["min(a.arr)", unionOf(NUMBER, NULL)],
    ["abs(a.i)", INTEGER],
    ["round(a.n)", INTEGER],
    ["round(a.n, 2)", NUMBER],
    ["floor(a.n)", INTEGER],
    ["ceil(a.n)", INTEGER],
    ["sum(a.arr)", NUMBER],
    ["sum([1, 2])", INTEGER],
    ["avg(a.arr)", unionOf(NUMBER, NULL)],
    ["first(a.strs)", unionOf(STRING, NULL)],
    ["last(a.people)", unionOf(objectOf({ name: STRING, age: INTEGER }), NULL)],
    ["filter(a.arr, x => x > 1)", arrayOf(NUMBER)],
    ["map(a.arr, x => x > 1)", arrayOf(BOOLEAN)],
    ["map(a.people, p => p.name)", arrayOf(STRING)],
    ["map(a.people, p => {n: p.name, a: p.age + 1})", arrayOf(objectOf({ n: STRING, a: INTEGER }))],
    ["any(a.arr, x => x > 1)", BOOLEAN],
    ['all(a.strs, s => s == "x")', BOOLEAN],
    ["sort(a.arr)", arrayOf(NUMBER)],
    ["sort(a.people, p => p.age)", arrayOf(objectOf({ name: STRING, age: INTEGER }))],
    ["map(a.people, p => map(a.arr, x => p.age + x))", arrayOf(arrayOf(NUMBER))],
    ["to_number(a.s)", NUMBER],
    ["to_number(a.b)", NUMBER],
    ["to_string(a.obj)", STRING],
    ["regex_test(a.s, 'x')", BOOLEAN],
    ["regex_match(a.s, 'x', 'i')", unionOf(arrayOf(unionOf(STRING, NULL)), NULL)],
    ["now()", STRING],
    ["format_date(a.s)", STRING],
    ["format_date(a.n, 'YYYY')", STRING],
  ])("%s : %s", (source, expected) => {
    expect(typeOf(source)).toEqual(expected);
    expect(issues(source)).toEqual([]);
  });
});

describe("inferExprType: contradictions (E_EXPR_TYPE)", () => {
  it.each<[string, string, string]>([
    ["a.n + 'x'", "/right", "both be numbers or both be strings"],
    ["'x' + a.n", "/right", "both be numbers or both be strings"],
    ["a.n + a.b", "/right", "expected number or string"],
    ["a.s - 1", "/left", "expected number"],
    ["a.s * a.s", "/left", "expected number"],
    ["1 / a.s", "/right", "expected number"],
    ["a.b % 2", "/left", "expected number"],
    ["-a.s", "/operand", "expected number"],
    ["!a.n", "/operand", "expected boolean"],
    ["a.n && true", "/left", "expected boolean"],
    ["true || a.s", "/right", "expected boolean"],
    ["a.n ? 1 : 2", "/test", "expected boolean"],
    ["a.n < 'x'", "/right", "both be numbers"],
    ["a.b < a.b", "/left", "expected number or string"],
    ["a.arr < a.arr", "/left", "expected number or string"],
    ["1 in a.n", "/right", "expected array or string or object"],
    ["1 in a.obj", "/left", "expected string"],
    ["1 in a.s", "/left", "expected string"],
    ["a.n matches 'x'", "/left", "expected string"],
    ["a.s matches a.n", "/right", "expected string"],
    ["(a.n).x", "", "cannot read property 'x' of number"],
    ["(a.s).length", "", "cannot read property 'length' of string"],
    ["(a.z).x", "", "cannot read property 'x' of null"],
    ["(a.obj).nope", "", "property 'nope' does not exist"],
    ["(a.arr).x", "", "cannot read property 'x' of array<number>"],
    ["(a.obj)[0]", "", "cannot index"],
    ["a.arr[a.b]", "/index", "expected number or string"],
    ["(a.n)[0]", "", "cannot index number"],
    ["(a.sn).length", "", "cannot read property 'length' of null"],
    ["(a.arr_or_null).x", "", "cannot read property 'x' of array<integer>"],
    ["(a.arr_or_null).x", "", "cannot read property 'x' of null"],
    ["(a.arr_or_null)[a.s]", "", "cannot index null with a string"],
    ["(a.obj_or_str)[0]", "", "cannot index string with a number"],
    ["first(a.items).nope", "", "property 'nope' does not exist"],
    [
      "map(a.items, x => x.tags[0].length)",
      "/args/1/body",
      "cannot read property 'length' of string",
    ],
    [
      "map(a.items, x => x.tags[0].length)",
      "/args/1/body",
      "cannot read property 'length' of null",
    ],
    ["a.n == a.s", "/right", "'==' can never be true: number vs string"],
    ["a.s != a.n", "/right", "'!=' is always true: string vs number"],
    ["a.i == a.s", "/right", "'==' can never be true: integer vs string"],
    ["a.sn == 1", "/right", "'==' can never be true: string | null vs integer"],
    [
      "a.arr == a.obj",
      "/right",
      "'==' can never be true: array<number> vs {k: string, opt?: number}",
    ],
    ["a.b == 1", "/right", "'==' can never be true: boolean vs integer"],
    ["a.z == 1", "/right", "'==' can never be true: null vs integer"],
    ['len(a.items) == "3"', "/right", "'==' can never be true: integer vs string"],
    ["a.category == 1", "/right", '1 is not one of ["billing", "other"]'],
    ["a.category == 'biling'", "/right", '"biling" is not one of ["billing", "other"]'],
    ["'biling' == a.category", "/right", '"biling" is not one of ["billing", "other"]'],
    ["a.category != 'biling'", "/right", '"biling" is not one of ["billing", "other"]'],
    ["a.level == 4", "/right", "4 is not one of [1, 2, 3]"],
    ['a.level == "1"', "/right", '"1" is not one of [1, 2, 3]'],
    ["a.const == 6", "/right", "6 is not one of [5]"],
    [
      "a.category == a.enum",
      "/right",
      '\'==\' can never be true: ["billing", "other"] vs ["x", "y"]',
    ],
    [
      "a.level == a.category",
      "/right",
      '\'==\' can never be true: [1, 2, 3] vs ["billing", "other"]',
    ],
    ["[a.n == a.s]", "/items/0/right", "'==' can never be true"],
    [
      "filter(a.items, x => x.name == 1)",
      "/args/1/body/right",
      "'==' can never be true: string vs integer",
    ],
    ["a.s[a.s]", "", "cannot index string"],
    ["len(a.n)", "/args/0", "expected string or array or object"],
    ["len(a.b)", "/args/0", "expected string or array or object"],
    ["lower(a.n)", "/args/0", "expected string"],
    ["upper(a.arr)", "/args/0", "expected string"],
    ["trim(a.z)", "/args/0", "expected string"],
    ["contains(a.n, 1)", "/args/0", "expected string or array"],
    ["contains(a.s, 1)", "/args/1", "expected string"],
    ['starts_with(a.n, "x")', "/args/0", "expected string"],
    ["ends_with(a.s, 1)", "/args/1", "expected string"],
    ['split(a.arr, ",")', "/args/0", "expected string"],
    ["split(a.s, 1)", "/args/1", "expected string"],
    ["join(a.s)", "/args/0", "expected array"],
    ["join(a.arr, 1)", "/args/1", "expected string"],
    ["parse_json(a.n)", "/args/0", "expected string"],
    ["keys(a.arr)", "/args/0", "expected object"],
    ["values(a.s)", "/args/0", "expected object"],
    ['has(a.s, "x")', "/args/0", "expected object or array"],
    ["has(a.obj, 1)", "/args/1", "expected string"],
    ['has(a.arr, "x")', "/args/1", "expected number"],
    ["get(a.obj, 1)", "/args/1", "expected string"],
    ["min(a.s)", "/args/0", "expected number"],
    ["min(a.strs)", "/args/0", "expected number"],
    ["max(1, a.s)", "/args/1", "expected number"],
    ["abs(a.s)", "/args/0", "expected number"],
    ["round(a.s)", "/args/0", "expected number"],
    ["round(a.n, a.s)", "/args/1", "expected number"],
    ["floor(a.b)", "/args/0", "expected number"],
    ["ceil(a.z)", "/args/0", "expected number"],
    ["sum(a.strs)", "/args/0", "expected number"],
    ["sum(a.n)", "/args/0", "expected array"],
    ["avg(a.obj)", "/args/0", "expected array"],
    ["first(a.s)", "/args/0", "expected array"],
    ["last(a.n)", "/args/0", "expected array"],
    ["filter(a.n, x => true)", "/args/0", "expected array"],
    ["filter(a.arr, x => x)", "/args/1/body", "expected boolean"],
    ["map(a.obj, x => x)", "/args/0", "expected array"],
    ["any(a.arr, x => x + 1)", "/args/1/body", "expected boolean"],
    ["all(a.strs, s => s)", "/args/1/body", "expected boolean"],
    ["sort(a.people)", "/args/0", "expected number or string"],
    ["sort(a.people, p => p)", "/args/1/body", "expected number or string"],
    ["sort(a.s)", "/args/0", "expected array"],
    ["map(a.arr, x => x.y)", "/args/1/body", "cannot read property 'y' of number"],
    ["map(a.people, p => p.nope)", "/args/1/body", "property 'nope' does not exist"],
    ["to_number(a.arr)", "/args/0", "expected number or string or boolean"],
    ['regex_test(a.n, "x")', "/args/0", "expected string"],
    ["regex_test(a.s, 1)", "/args/1", "expected string"],
    ['regex_test(a.s, "x", 1)', "/args/2", "expected string"],
    ['regex_match(a.b, "x")', "/args/0", "expected string"],
    ["format_date(a.b)", "/args/0", "expected string or number"],
    ["format_date(a.s, 1)", "/args/1", "expected string"],
    ["a.sn + 1", "/left", "expected number or string"],
    ['a.sn + "x"', "/left", "expected number or string"],
    ['a.b ? 1 : "x" + 1', "/else/right", "both be numbers"],
    ["[a.n + a.s]", "/items/0/right", "both be numbers"],
    ["{k: !a.n}", "/entries/0/value/operand", "expected boolean"],
    ["(a.n + a.s)[0]", "/object/right", "both be numbers"],
  ])("%s → type issue at %j", (source, path, message) => {
    const found = issues(source);
    expect(
      found.some((i) => i.code === "type" && i.path === path && i.message.includes(message)),
    ).toBe(true);
  });

  it.each<[string, TypeIssue["code"], string, string]>([
    [
      "a.s matches a.n",
      "regex_dynamic",
      "/right",
      "pattern of operator 'matches' must be a string literal",
    ],
    ["a.s matches a.s", "regex_dynamic", "/right", "must be a string literal"],
    ["a.s matches ('a' + 'b')", "regex_dynamic", "/right", "must be a string literal"],
    [
      "regex_test(a.s, a.s)",
      "regex_dynamic",
      "/args/1",
      "pattern of regex_test must be a string literal",
    ],
    [
      "regex_match(a.s, a.s)",
      "regex_dynamic",
      "/args/1",
      "pattern of regex_match must be a string literal",
    ],
    [
      "regex_test(a.s, 'x', a.s)",
      "regex_dynamic",
      "/args/2",
      "flags of regex_test must be a string literal",
    ],
    ["a.s matches '(a+)+$'", "regex_unsafe", "/right", "exponential"],
    ["regex_test(a.s, '(\\\\d+)-(\\\\d+)')", "regex_unsafe", "/args/1", "polynomial"],
    ["regex_match(a.s, '(a|a)*b', 'i')", "regex_unsafe", "/args/1", "anchor the pattern"],
    ["a.s matches '('", "type", "/right", "invalid regular expression"],
    ["regex_test(a.s, '[', 'i')", "type", "/args/1", "invalid regular expression"],
    ["regex_test(a.s, 'x', 'g')", "type", "/args/2", "invalid regex flags"],
    ["regex_test(a.s, 'x', 'ii')", "type", "/args/2", "invalid regex flags"],
  ])("%s → %s issue at %j", (source, code, path, message) => {
    const found = issues(source);
    expect(
      found.some((i) => i.code === code && i.path === path && i.message.includes(message)),
    ).toBe(true);
  });

  it("accepts literal, linear-time patterns without regex issues", () => {
    for (const source of [
      "a.s matches '^h.*o$'",
      "regex_test(a.s, '^\\\\d{4}-\\\\d{2}-\\\\d{2}$')",
      "regex_match(a.s, '^(\\\\d+)-(\\\\d+)-(\\\\d+)$', 'i')",
      "a.s matches ''",
      "regex_test(a.s, 'a\\\\+b', 'imsu')",
    ]) {
      expect(
        issues(source).filter((i) => i.code === "regex_dynamic" || i.code === "regex_unsafe"),
      ).toEqual([]);
    }
  });

  it("reports foreign-AST problems as type issues", () => {
    const cases: ExprAst[] = [
      { kind: "call", fn: "nope", args: [] },
      { kind: "call", fn: "len", args: [] },
      { kind: "ident", name: "x" },
      { kind: "lambda", param: "x", body: { kind: "literal", value: 1 } },
      {
        kind: "call",
        fn: "map",
        args: [
          { kind: "array", items: [] },
          { kind: "literal", value: 1 },
        ],
      },
      {
        kind: "call",
        fn: "len",
        args: [{ kind: "lambda", param: "x", body: { kind: "literal", value: 1 } }],
      },
    ];
    for (const node of cases) {
      const result = inferExprType(node, env);
      expect(result.issues.some((i) => i.code === "type")).toBe(true);
    }
  });

  it("reports a never-true equality exactly once, at the right operand", () => {
    expect(issues("a.n == a.s")).toEqual([
      { code: "type", path: "/right", message: "'==' can never be true: number vs string" },
    ]);
    expect(issues("a.category == 'biling'")).toEqual([
      { code: "type", path: "/right", message: '"biling" is not one of ["billing", "other"]' },
    ]);
  });

  it("never throws and bounds depth with one issue and no cascade", () => {
    let deep: ExprAst = { kind: "literal", value: 1 };
    for (let i = 0; i < 100_000; i += 1) deep = { kind: "member", object: deep, key: "x" };
    const result = inferExprType(deep, env);
    expect(result.issues).toEqual([
      {
        code: "type",
        path: "/object".repeat(MAX_EXPR_DEPTH),
        message: EXPRESSION_TOO_DEEP_MESSAGE,
      },
    ]);
    expect(result.type).toEqual(UNKNOWN);
    expect(result.schema).toEqual({});
  });

  it("reports a too-deep operand chain once, without untyped warnings for its ancestors", () => {
    let chain: ExprAst = { kind: "literal", value: 1 };
    for (let i = 1; i <= MAX_EXPR_DEPTH; i += 1)
      chain = { kind: "binary", op: "+", left: chain, right: { kind: "literal", value: 1 } };
    const result = inferExprType(chain, env);
    expect(result.issues).toEqual([
      { code: "type", path: "/left".repeat(MAX_EXPR_DEPTH), message: EXPRESSION_TOO_DEEP_MESSAGE },
    ]);
    expect(result.type).toEqual(UNKNOWN);
    let ok: ExprAst = { kind: "literal", value: 1 };
    for (let i = 1; i < MAX_EXPR_DEPTH; i += 1)
      ok = { kind: "binary", op: "+", left: ok, right: { kind: "literal", value: 1 } };
    expect(inferExprType(ok, env)).toEqual({
      type: INTEGER,
      schema: { type: "integer" },
      issues: [],
    });
  });
});

describe("concat (RFC-0018)", () => {
  it("types the result as an array of the union of the item types", () => {
    expect(typeOf("concat([1, 2], [3])")).toEqual(arrayOf(INTEGER));
    expect(typeOf("concat(['a'], [1.5])")).toEqual(arrayOf(unionOf(STRING, NUMBER)));
    expect(issues("concat([1], ['x'])")).toEqual([]);
  });

  it("reports a non-array argument as a contradiction", () => {
    const found = issues("concat([1], 2)");
    expect(found.map((i) => i.code)).toEqual(["type"]);
    expect(found[0]?.message).toContain("argument 2 of concat");
  });
});

describe("inferExprType: untyped operands (W_EXPR_UNTYPED)", () => {
  it.each<[string, ExprType, string[]]>([
    ["a.nope", UNKNOWN, []],
    ["a.nope.x.y", UNKNOWN, []],
    ["a.nope[0]", UNKNOWN, []],
    ["a.nope + 1", UNKNOWN, ["/left"]],
    ["1 + a.nope", UNKNOWN, ["/right"]],
    ["a.nope * 2", NUMBER, ["/left"]],
    ["-a.nope", NUMBER, ["/operand"]],
    ["!a.nope", BOOLEAN, ["/operand"]],
    ["a.nope && true", BOOLEAN, ["/left"]],
    ["a.nope ? 1 : 2", INTEGER, ["/test"]],
    ["a.nope < 1", BOOLEAN, ["/left"]],
    ["a.nope == 1", BOOLEAN, []],
    ["1 in a.nope", BOOLEAN, ["/right"]],
    ["a.nope matches 'x'", BOOLEAN, ["/left"]],
    ["a.arr[a.nope]", unionOf(NUMBER, NULL), ["/index"]],
    ["len(a.nope)", INTEGER, ["/args/0"]],
    ["lower(a.nope)", STRING, ["/args/0"]],
    ["keys(a.nope)", arrayOf(STRING), ["/args/0"]],
    ["values(a.nope)", arrayOf(UNKNOWN), ["/args/0"]],
    ["first(a.nope)", UNKNOWN, ["/args/0"]],
    ["sum(a.nope)", NUMBER, ["/args/0"]],
    ["sum(a.anyarr)", NUMBER, ["/args/0"]],
    ["map(a.nope, x => x)", arrayOf(UNKNOWN), ["/args/0"]],
    ["map(a.anyarr, x => x + 1)", arrayOf(UNKNOWN), ["/args/1/body/left"]],
    ["filter(a.nope, x => x > 1)", arrayOf(UNKNOWN), ["/args/0", "/args/1/body/left"]],
    ["parse_json(a.s).x", UNKNOWN, []],
    ['get(a.obj, "/k") + 1', UNKNOWN, ["/left"]],
    ["coalesce(a.nope, 1)", UNKNOWN, []],
    ["a.b ? a.nope : 1", UNKNOWN, []],
    ["[a.nope]", arrayOf(UNKNOWN), []],
    ["{k: a.nope}", objectOf({ k: UNKNOWN }), []],
    ["$vars.nope > 1", BOOLEAN, ["/left"]],
    ["a.open.other + 1", UNKNOWN, ["/left"]],
    ["a.nope == a.s", BOOLEAN, []],
    ["a.s == parse_json(a.s)", BOOLEAN, []],
    ["first(a.items).name == a.nope", BOOLEAN, []],
  ])("%s : %s with untyped at %j", (source, expected, paths) => {
    expect(typeOf(source)).toEqual(expected);
    const found = issues(source);
    expect(found.filter((i) => i.code === "type")).toEqual([]);
    expect(found.filter((i) => i.code === "untyped").map((i) => i.path)).toEqual(paths);
  });
});

describe("inferExprType: boolean requirement (E_EXPR_NOT_BOOLEAN)", () => {
  it.each<[string, boolean]>([
    ["a.n > 1", true],
    ["a.b && !a.b", true],
    ["'k' in a.obj", true],
    ["any(a.arr, x => x > 0)", true],
    ["a.b ? true : false", true],
    ["a.n", false],
    ["a.s", false],
    ["a.b ? 1 : 2", false],
    ["a.b ? true : 1", false],
    ["a.nope", false],
    ["coalesce(a.b, null)", false],
  ])("%s boolean? %s", (source, expected) => {
    expect(isBooleanType(typeOf(source))).toBe(expected);
  });
});
