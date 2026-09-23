import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { JsonPrimitive, JsonSchema, JsonSchemaType } from "../json.js";
import { isSubschema, MAX_DEPTH, type SubsetResult } from "./subset.js";

type Expected = "ok" | "unverified" | "fail";

interface Row {
  name: string;
  s: JsonSchema;
  t: JsonSchema;
  expect: Expected;
  /** Expected failure path (value-space JSON Pointer). */
  path?: string;
}

function outcome(r: SubsetResult): Expected {
  if (!r.ok) return "fail";
  return r.verified ? "ok" : "unverified";
}

const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const int: JsonSchema = { type: "integer" };
const bool: JsonSchema = { type: "boolean" };
const nul: JsonSchema = { type: "null" };
const obj: JsonSchema = { type: "object" };
const arr: JsonSchema = { type: "array" };

/**
 * Builds a schema the way one arrives from a stored document or an importer:
 * keyword values are whatever the JSON held, not what the TypeScript shape declares.
 */
function rawSchema(raw: Record<string, unknown>): JsonSchema {
  const schema: JsonSchema = {};
  for (const [keyword, value] of Object.entries(raw)) schema[keyword] = value;
  return schema;
}

const kindA: JsonSchema = {
  type: "object",
  properties: { kind: { const: "a" }, x: num },
  required: ["kind"],
};
const kindB: JsonSchema = {
  type: "object",
  properties: { kind: { const: "b" }, y: str },
  required: ["kind"],
};

const rows: Row[] = [
  // ── unconstrained targets and sources ──────────────────────────────────
  { name: "empty into empty", s: {}, t: {}, expect: "ok" },
  { name: "typed into empty", s: str, t: {}, expect: "ok" },
  {
    name: "typed into true-like annotations only",
    s: str,
    t: { title: "T", description: "d", default: "x", examples: ["y"], $comment: "c" },
    expect: "ok",
  },
  { name: "empty into typed", s: {}, t: str, expect: "unverified" },
  { name: "empty into undecidable-only target", s: {}, t: { not: str }, expect: "unverified" },
  { name: "undecidable-only source into typed", s: { not: num }, t: str, expect: "unverified" },
  {
    name: "flowaid extension keywords do not constrain",
    s: str,
    t: { type: "string", "x-ui": { widget: "text" }, "x-dataClass": "pii", "x-secret": true },
    expect: "ok",
  },

  // ── type sets ──────────────────────────────────────────────────────────
  { name: "string ⊆ string", s: str, t: str, expect: "ok" },
  { name: "string ⊄ number", s: str, t: num, expect: "fail", path: "" },
  { name: "integer ⊆ number", s: int, t: num, expect: "ok" },
  { name: "number ⊄ integer", s: num, t: int, expect: "fail", path: "" },
  {
    name: "number multipleOf 1 ⊆ integer",
    s: { type: "number", multipleOf: 1 },
    t: int,
    expect: "ok",
  },
  {
    name: "number multipleOf 2 ⊆ integer",
    s: { type: "number", multipleOf: 2 },
    t: int,
    expect: "ok",
  },
  {
    name: "number multipleOf 0.5 ⊄ integer",
    s: { type: "number", multipleOf: 0.5 },
    t: int,
    expect: "fail",
  },
  { name: "boolean ⊆ boolean", s: bool, t: bool, expect: "ok" },
  { name: "null ⊆ null", s: nul, t: nul, expect: "ok" },
  { name: "boolean ⊄ null", s: bool, t: nul, expect: "fail" },
  {
    name: "type list subset",
    s: { type: ["string", "null"] },
    t: { type: ["string", "null", "number"] },
    expect: "ok",
  },
  { name: "type list not subset", s: { type: ["string", "number"] }, t: str, expect: "fail" },
  {
    name: "integer|string ⊆ number|string",
    s: { type: ["integer", "string"] },
    t: { type: ["number", "string"] },
    expect: "ok",
  },
  {
    name: "nullable source into explicit null union",
    s: { type: "string", nullable: true },
    t: { type: ["string", "null"] },
    expect: "ok",
  },
  {
    name: "plain string into nullable target",
    s: str,
    t: { type: "string", nullable: true },
    expect: "ok",
  },
  {
    name: "nullable source into non-null target",
    s: { type: "string", nullable: true },
    t: str,
    expect: "fail",
  },
  {
    name: "untyped constrained source admits every type",
    s: { minLength: 1 },
    t: str,
    expect: "fail",
  },
  { name: "untyped bounds on both sides", s: { minimum: 0 }, t: { minimum: 0 }, expect: "ok" },
  {
    name: "contradictory allOf types is the empty schema",
    s: { allOf: [str, num] },
    t: bool,
    expect: "ok",
  },

  // ── enum / const ───────────────────────────────────────────────────────
  { name: "enum subset", s: { enum: ["a", "b"] }, t: { enum: ["a", "b", "c"] }, expect: "ok" },
  {
    name: "enum superset",
    s: { enum: ["a", "b", "c"] },
    t: { enum: ["a", "b"] },
    expect: "fail",
    path: "",
  },
  { name: "const in enum", s: { const: "a" }, t: { enum: ["a", "b"] }, expect: "ok" },
  { name: "const not in enum", s: { const: "c" }, t: { enum: ["a", "b"] }, expect: "fail" },
  { name: "string enum into string", s: { enum: ["a", "b"] }, t: str, expect: "ok" },
  { name: "mixed enum into string", s: { enum: ["a", 1] }, t: str, expect: "fail" },
  {
    name: "typed source into enum target",
    s: str,
    t: { enum: ["a", "b"] },
    expect: "fail",
    path: "",
  },
  { name: "typed source into const target", s: str, t: { const: "a" }, expect: "fail" },
  {
    name: "enum literals are filtered by the declared type",
    s: { type: "string", enum: ["a", 1] },
    t: str,
    expect: "ok",
  },
  {
    name: "integer enum within bounds",
    s: { enum: [1, 2] },
    t: { type: "integer", minimum: 1, maximum: 2 },
    expect: "ok",
  },
  { name: "non-integer enum member into integer", s: { enum: [1, 2.5] }, t: int, expect: "fail" },
  { name: "const multiple", s: { const: 4 }, t: { type: "number", multipleOf: 2 }, expect: "ok" },
  {
    name: "const not a multiple",
    s: { const: 3 },
    t: { type: "number", multipleOf: 2 },
    expect: "fail",
  },
  {
    name: "const below minimum",
    s: { const: -1 },
    t: { type: "number", minimum: 0 },
    expect: "fail",
  },
  {
    name: "const at exclusive maximum",
    s: { const: 10 },
    t: { type: "number", exclusiveMaximum: 10 },
    expect: "fail",
  },
  {
    name: "const string long enough",
    s: { const: "abc" },
    t: { type: "string", minLength: 3 },
    expect: "ok",
  },
  {
    name: "const string too short",
    s: { const: "ab" },
    t: { type: "string", minLength: 3 },
    expect: "fail",
  },
  {
    name: "const string too long",
    s: { const: "abcd" },
    t: { type: "string", maxLength: 3 },
    expect: "fail",
  },
  {
    name: "const string matches pattern",
    s: { const: "abc" },
    t: { type: "string", pattern: "^a" },
    expect: "ok",
  },
  {
    name: "const string violates pattern",
    s: { const: "xbc" },
    t: { type: "string", pattern: "^a" },
    expect: "fail",
  },
  {
    name: "const string against format is unverified",
    s: { const: "x" },
    t: { type: "string", format: "email" },
    expect: "unverified",
  },
  {
    name: "const string against invalid regex is unverified",
    s: { const: "x" },
    t: { type: "string", pattern: "(" },
    expect: "unverified",
  },
  {
    name: "const null into nullable union",
    s: { const: null },
    t: { type: ["string", "null"] },
    expect: "ok",
  },
  { name: "const null into string", s: { const: null }, t: str, expect: "fail" },
  { name: "const true into boolean", s: { const: true }, t: bool, expect: "ok" },
  {
    name: "const object structurally",
    s: { const: { a: 1 } },
    t: { type: "object", properties: { a: num }, required: ["a"] },
    expect: "ok",
  },
  {
    name: "const object property mismatch",
    s: { const: { a: 1 } },
    t: { type: "object", properties: { a: str } },
    expect: "fail",
    path: "/a",
  },
  {
    name: "const object extra property",
    s: { const: { a: 1, b: 2 } },
    t: { type: "object", properties: { a: {} }, additionalProperties: false },
    expect: "fail",
    path: "/b",
  },
  {
    name: "const object into closed object of same shape",
    s: { const: { a: 1 } },
    t: { type: "object", properties: { a: int }, required: ["a"], additionalProperties: false },
    expect: "ok",
  },
  {
    name: "const array positional",
    s: { const: [1, "a"] },
    t: { type: "array", prefixItems: [num, str] },
    expect: "ok",
  },
  {
    name: "const array item mismatch",
    s: { const: [1, "a"] },
    t: { type: "array", items: num },
    expect: "fail",
    path: "/1",
  },
  {
    name: "const array too short",
    s: { const: [1] },
    t: { type: "array", minItems: 2 },
    expect: "fail",
  },
  {
    name: "empty const array",
    s: { const: [] },
    t: { type: "array", items: str, maxItems: 0 },
    expect: "ok",
  },
  { name: "empty enum is vacuous", s: { enum: [] }, t: str, expect: "ok" },
  {
    name: "const object into anyOf of const objects",
    s: { const: { a: 2 } },
    t: { anyOf: [{ const: { a: 1 } }, { const: { a: 2 } }] },
    expect: "ok",
  },
  {
    name: "const object not among anyOf of const objects",
    s: { const: { a: 3 } },
    t: { anyOf: [{ const: { a: 1 } }, { const: { a: 2 } }] },
    expect: "fail",
  },
  {
    name: "typed object into const object fails",
    s: { type: "object", properties: { a: int }, required: ["a"], additionalProperties: false },
    t: { const: { a: 1 } },
    expect: "fail",
  },
  {
    name: "enum with duplicate-free superset including null",
    s: { enum: ["a", null] },
    t: { enum: [null, "a", "b"] },
    expect: "ok",
  },

  // ── numbers ────────────────────────────────────────────────────────────
  {
    name: "identical interval",
    s: { type: "number", minimum: 0, maximum: 10 },
    t: { type: "number", minimum: 0, maximum: 10 },
    expect: "ok",
  },
  {
    name: "narrower interval",
    s: { type: "number", minimum: 1, maximum: 9 },
    t: { type: "number", minimum: 0, maximum: 10 },
    expect: "ok",
  },
  {
    name: "minimum too low",
    s: { type: "number", minimum: -1 },
    t: { type: "number", minimum: 0 },
    expect: "fail",
    path: "",
  },
  {
    name: "maximum too high",
    s: { type: "number", maximum: 11 },
    t: { type: "number", maximum: 10 },
    expect: "fail",
  },
  {
    name: "unbounded into bounded below",
    s: num,
    t: { type: "number", minimum: 0 },
    expect: "fail",
  },
  {
    name: "unbounded into bounded above",
    s: num,
    t: { type: "number", maximum: 0 },
    expect: "fail",
  },
  { name: "bounded into unbounded", s: { type: "number", minimum: 0 }, t: num, expect: "ok" },
  {
    name: "exclusiveMinimum into minimum",
    s: { type: "number", exclusiveMinimum: 0 },
    t: { type: "number", minimum: 0 },
    expect: "ok",
  },
  {
    name: "minimum into exclusiveMinimum",
    s: { type: "number", minimum: 0 },
    t: { type: "number", exclusiveMinimum: 0 },
    expect: "fail",
  },
  {
    name: "exclusiveMaximum into maximum",
    s: { type: "number", exclusiveMaximum: 10 },
    t: { type: "number", maximum: 10 },
    expect: "ok",
  },
  {
    name: "maximum into exclusiveMaximum",
    s: { type: "number", maximum: 10 },
    t: { type: "number", exclusiveMaximum: 10 },
    expect: "fail",
  },
  {
    name: "integer minimum 4 into exclusiveMinimum 3",
    s: { type: "integer", minimum: 4 },
    t: { type: "integer", exclusiveMinimum: 3 },
    expect: "ok",
  },
  {
    name: "integer maximum 9 into exclusiveMaximum 10",
    s: { type: "integer", maximum: 9 },
    t: { type: "integer", exclusiveMaximum: 10 },
    expect: "ok",
  },
  {
    name: "integer exclusiveMinimum 3.5 into minimum 4",
    s: { type: "integer", exclusiveMinimum: 3.5 },
    t: { type: "integer", minimum: 4 },
    expect: "ok",
  },
  {
    name: "integer minimum 3 into exclusiveMinimum 3",
    s: { type: "integer", minimum: 3 },
    t: { type: "integer", exclusiveMinimum: 3 },
    expect: "fail",
  },
  {
    name: "number minimum 4 into exclusiveMinimum 3 (reals)",
    s: { type: "number", minimum: 4 },
    t: { type: "number", exclusiveMinimum: 3 },
    expect: "ok",
  },
  {
    name: "multipleOf 4 into multipleOf 2",
    s: { type: "number", multipleOf: 4 },
    t: { type: "number", multipleOf: 2 },
    expect: "ok",
  },
  {
    name: "multipleOf 2 into multipleOf 4",
    s: { type: "number", multipleOf: 2 },
    t: { type: "number", multipleOf: 4 },
    expect: "fail",
  },
  {
    name: "multipleOf 3 into multipleOf 2",
    s: { type: "number", multipleOf: 3 },
    t: { type: "number", multipleOf: 2 },
    expect: "fail",
  },
  {
    name: "no multipleOf into multipleOf",
    s: num,
    t: { type: "number", multipleOf: 2 },
    expect: "fail",
  },
  {
    name: "integer into multipleOf 0.5",
    s: int,
    t: { type: "number", multipleOf: 0.5 },
    expect: "ok",
  },
  {
    name: "integer into multipleOf 2",
    s: int,
    t: { type: "integer", multipleOf: 2 },
    expect: "fail",
  },
  {
    name: "integer multipleOf 6 into number multipleOf 3",
    s: { type: "integer", multipleOf: 6 },
    t: { type: "number", multipleOf: 3 },
    expect: "ok",
  },
  {
    name: "multipleOf 0.3 into multipleOf 0.1 (float tolerance)",
    s: { type: "number", multipleOf: 0.3 },
    t: { type: "number", multipleOf: 0.1 },
    expect: "ok",
  },
  {
    name: "integer-valued number gets integer bound refinement",
    s: { type: "number", exclusiveMinimum: -1, multipleOf: 1 },
    t: { type: "number", minimum: 0 },
    expect: "ok",
  },
  {
    name: "empty interval is vacuous",
    s: { type: "number", minimum: 5, maximum: 3 },
    t: { type: "number", minimum: 10 },
    expect: "ok",
  },
  {
    name: "allOf multipleOf both kept",
    s: { type: "number", allOf: [{ multipleOf: 2 }, { multipleOf: 3 }] },
    t: { type: "number", multipleOf: 3 },
    expect: "ok",
  },

  // ── strings ────────────────────────────────────────────────────────────
  {
    name: "minLength narrower",
    s: { type: "string", minLength: 2 },
    t: { type: "string", minLength: 1 },
    expect: "ok",
  },
  {
    name: "minLength wider",
    s: { type: "string", minLength: 1 },
    t: { type: "string", minLength: 2 },
    expect: "fail",
    path: "",
  },
  {
    name: "no minLength into minLength",
    s: str,
    t: { type: "string", minLength: 1 },
    expect: "fail",
  },
  {
    name: "maxLength narrower",
    s: { type: "string", maxLength: 5 },
    t: { type: "string", maxLength: 10 },
    expect: "ok",
  },
  {
    name: "maxLength wider",
    s: { type: "string", maxLength: 11 },
    t: { type: "string", maxLength: 10 },
    expect: "fail",
  },
  {
    name: "no maxLength into maxLength",
    s: str,
    t: { type: "string", maxLength: 10 },
    expect: "fail",
  },
  {
    name: "equal pattern",
    s: { type: "string", pattern: "^a" },
    t: { type: "string", pattern: "^a" },
    expect: "ok",
  },
  {
    name: "different pattern",
    s: { type: "string", pattern: "^a" },
    t: { type: "string", pattern: "^b" },
    expect: "unverified",
  },
  {
    name: "no pattern into pattern",
    s: str,
    t: { type: "string", pattern: "^a" },
    expect: "unverified",
  },
  { name: "pattern into no pattern", s: { type: "string", pattern: "^a" }, t: str, expect: "ok" },
  {
    name: "equal format",
    s: { type: "string", format: "email" },
    t: { type: "string", format: "email" },
    expect: "ok",
  },
  {
    name: "different format",
    s: { type: "string", format: "uri" },
    t: { type: "string", format: "email" },
    expect: "unverified",
  },
  {
    name: "no format into format",
    s: str,
    t: { type: "string", format: "email" },
    expect: "unverified",
  },
  { name: "format into no format", s: { type: "string", format: "email" }, t: str, expect: "ok" },
  {
    name: "failure wins over unverified pattern",
    s: { type: "string", pattern: "^a", minLength: 1 },
    t: { type: "string", pattern: "^b", minLength: 2 },
    expect: "fail",
  },
  {
    name: "string constraints ignored for non-string source",
    s: num,
    t: { type: ["number", "string"], minLength: 3 },
    expect: "ok",
  },

  // ── arrays ─────────────────────────────────────────────────────────────
  {
    name: "items equal",
    s: { type: "array", items: str },
    t: { type: "array", items: str },
    expect: "ok",
  },
  {
    name: "items mismatch",
    s: { type: "array", items: str },
    t: { type: "array", items: num },
    expect: "fail",
    path: "/*",
  },
  {
    name: "typed items into untyped array",
    s: { type: "array", items: str },
    t: arr,
    expect: "ok",
  },
  {
    name: "untyped array into typed items",
    s: arr,
    t: { type: "array", items: str },
    expect: "unverified",
  },
  {
    name: "integer items into number items",
    s: { type: "array", items: int },
    t: { type: "array", items: num },
    expect: "ok",
  },
  {
    name: "minItems narrower",
    s: { type: "array", minItems: 2 },
    t: { type: "array", minItems: 1 },
    expect: "ok",
  },
  {
    name: "minItems wider",
    s: { type: "array", minItems: 0 },
    t: { type: "array", minItems: 1 },
    expect: "fail",
  },
  { name: "no minItems into minItems", s: arr, t: { type: "array", minItems: 1 }, expect: "fail" },
  {
    name: "maxItems narrower",
    s: { type: "array", maxItems: 3 },
    t: { type: "array", maxItems: 5 },
    expect: "ok",
  },
  {
    name: "maxItems wider",
    s: { type: "array", maxItems: 6 },
    t: { type: "array", maxItems: 5 },
    expect: "fail",
  },
  { name: "no maxItems into maxItems", s: arr, t: { type: "array", maxItems: 5 }, expect: "fail" },
  {
    name: "closed tuple length counts as maxItems",
    s: { type: "array", prefixItems: [str, str], items: false },
    t: { type: "array", maxItems: 2 },
    expect: "ok",
  },
  {
    name: "closed tuple longer than maxItems",
    s: { type: "array", prefixItems: [str, str], items: false },
    t: { type: "array", maxItems: 1 },
    expect: "fail",
  },
  {
    name: "uniqueItems both",
    s: { type: "array", uniqueItems: true },
    t: { type: "array", uniqueItems: true },
    expect: "ok",
  },
  {
    name: "uniqueItems required by target only",
    s: arr,
    t: { type: "array", uniqueItems: true },
    expect: "fail",
  },
  {
    name: "uniqueItems on source only",
    s: { type: "array", uniqueItems: true },
    t: arr,
    expect: "ok",
  },
  {
    name: "uniqueItems trivial for maxItems 1",
    s: { type: "array", maxItems: 1 },
    t: { type: "array", uniqueItems: true },
    expect: "ok",
  },
  {
    name: "prefixItems equal",
    s: { type: "array", prefixItems: [str, num] },
    t: { type: "array", prefixItems: [str, num] },
    expect: "ok",
  },
  {
    name: "prefixItems positional mismatch",
    s: { type: "array", prefixItems: [str, num] },
    t: { type: "array", prefixItems: [str, str] },
    expect: "fail",
    path: "/1",
  },
  {
    name: "closed tuple into open tuple",
    s: { type: "array", prefixItems: [str], items: false },
    t: { type: "array", prefixItems: [str] },
    expect: "ok",
  },
  {
    name: "closed tuple into homogeneous items",
    s: { type: "array", prefixItems: [str], items: false },
    t: { type: "array", items: str },
    expect: "ok",
  },
  {
    name: "open tuple into homogeneous items",
    s: { type: "array", prefixItems: [str] },
    t: { type: "array", items: str },
    expect: "unverified",
  },
  {
    name: "tuple with typed rest into homogeneous items",
    s: { type: "array", prefixItems: [str], items: str },
    t: { type: "array", items: str },
    expect: "ok",
  },
  {
    name: "homogeneous items into open tuple",
    s: { type: "array", items: str },
    t: { type: "array", prefixItems: [str] },
    expect: "ok",
  },
  {
    name: "homogeneous items into mismatching tuple",
    s: { type: "array", items: str },
    t: { type: "array", prefixItems: [num] },
    expect: "fail",
    path: "/0",
  },
  {
    name: "homogeneous items into closed tuple",
    s: { type: "array", items: str },
    t: { type: "array", prefixItems: [str], items: false },
    expect: "fail",
    path: "/*",
  },
  {
    name: "bounded homogeneous items into closed tuple",
    s: { type: "array", items: str, maxItems: 1 },
    t: { type: "array", prefixItems: [str], items: false },
    expect: "ok",
  },
  {
    name: "untyped single item into closed tuple",
    s: { type: "array", maxItems: 1 },
    t: { type: "array", prefixItems: [str], items: false },
    expect: "unverified",
  },
  {
    name: "nested items mismatch",
    s: { type: "array", items: { type: "array", items: str } },
    t: { type: "array", items: { type: "array", items: num } },
    expect: "fail",
    path: "/*/*",
  },
  {
    name: "items false into anything",
    s: { type: "array", items: false },
    t: { type: "array", items: num, maxItems: 0 },
    expect: "ok",
  },
  {
    name: "array constraints ignored for non-array source",
    s: str,
    t: { type: ["string", "array"], minItems: 3 },
    expect: "ok",
  },

  // ── objects ────────────────────────────────────────────────────────────
  {
    name: "properties equal",
    s: { type: "object", properties: { a: str } },
    t: { type: "object", properties: { a: str } },
    expect: "ok",
  },
  {
    name: "property mismatch",
    s: { type: "object", properties: { a: str } },
    t: { type: "object", properties: { a: num } },
    expect: "fail",
    path: "/a",
  },
  {
    name: "required satisfied",
    s: { type: "object", properties: { a: str }, required: ["a"] },
    t: { type: "object", properties: { a: str }, required: ["a"] },
    expect: "ok",
  },
  {
    name: "required missing on source",
    s: { type: "object", properties: { a: str } },
    t: { type: "object", properties: { a: str }, required: ["a"] },
    expect: "fail",
    path: "/a",
  },
  {
    name: "required superset on source",
    s: { type: "object", required: ["a", "b"], properties: { a: str, b: str } },
    t: { type: "object", required: ["a"], properties: { a: str } },
    expect: "ok",
  },
  {
    name: "required property the source forbids",
    s: {
      type: "object",
      properties: { a: str },
      required: ["a", "b"],
      additionalProperties: false,
    },
    t: { type: "object", properties: { b: str }, required: ["b"] },
    expect: "fail",
    path: "/b",
  },
  {
    name: "extra declared property into closed target",
    s: { type: "object", properties: { a: str, b: str } },
    t: { type: "object", properties: { a: str }, additionalProperties: false },
    expect: "fail",
    path: "/b",
  },
  {
    name: "extra declared property into open target",
    s: { type: "object", properties: { a: str, b: str } },
    t: { type: "object", properties: { a: str } },
    expect: "ok",
  },
  {
    name: "extra declared property matches additionalProperties schema",
    s: { type: "object", properties: { a: str, b: str }, additionalProperties: false },
    t: { type: "object", properties: { a: str }, additionalProperties: str },
    expect: "ok",
  },
  {
    name: "open source with typed extras into typed additionalProperties",
    s: { type: "object", properties: { a: str, b: str } },
    t: { type: "object", properties: { a: str }, additionalProperties: str },
    expect: "unverified",
  },
  {
    name: "extra declared property violates additionalProperties schema",
    s: { type: "object", properties: { a: str, b: num } },
    t: { type: "object", properties: { a: str }, additionalProperties: str },
    expect: "fail",
    path: "/b",
  },
  {
    name: "open object into closed object is unverified",
    s: obj,
    t: { type: "object", additionalProperties: false },
    expect: "unverified",
  },
  {
    name: "closed into closed",
    s: { type: "object", additionalProperties: false },
    t: { type: "object", additionalProperties: false },
    expect: "ok",
  },
  {
    name: "typed additionalProperties into closed object",
    s: { type: "object", additionalProperties: str },
    t: { type: "object", additionalProperties: false },
    expect: "fail",
    path: "/*",
  },
  {
    name: "additionalProperties schemas equal",
    s: { type: "object", additionalProperties: str },
    t: { type: "object", additionalProperties: str },
    expect: "ok",
  },
  {
    name: "additionalProperties schemas mismatch",
    s: { type: "object", additionalProperties: str },
    t: { type: "object", additionalProperties: num },
    expect: "fail",
    path: "/*",
  },
  {
    name: "open object into typed additionalProperties",
    s: obj,
    t: { type: "object", additionalProperties: str },
    expect: "unverified",
  },
  {
    name: "typed additionalProperties into open object",
    s: { type: "object", additionalProperties: str },
    t: obj,
    expect: "ok",
  },
  {
    name: "closed source lacking optional target property",
    s: { type: "object", properties: { a: str }, additionalProperties: false },
    t: { type: "object", properties: { a: str, b: num } },
    expect: "ok",
  },
  {
    name: "typed property into untyped property",
    s: { type: "object", properties: { a: str } },
    t: { type: "object", properties: { a: {} } },
    expect: "ok",
  },
  {
    name: "open source lacking typed target property",
    s: obj,
    t: { type: "object", properties: { a: str } },
    expect: "unverified",
  },
  {
    name: "additionalProperties schema covers target property",
    s: { type: "object", additionalProperties: str },
    t: { type: "object", properties: { a: str } },
    expect: "ok",
  },
  {
    name: "additionalProperties schema violates target property",
    s: { type: "object", additionalProperties: str },
    t: { type: "object", properties: { a: num } },
    expect: "fail",
    path: "/a",
  },
  {
    name: "nested property mismatch",
    s: { type: "object", properties: { a: { type: "object", properties: { b: str } } } },
    t: { type: "object", properties: { a: { type: "object", properties: { b: num } } } },
    expect: "fail",
    path: "/a/b",
  },
  {
    name: "object constraints ignored for non-object source",
    s: str,
    t: { type: ["string", "object"], required: ["a"] },
    expect: "ok",
  },
  {
    name: "property name needing pointer escaping",
    s: { type: "object", properties: { "a/b": str } },
    t: { type: "object", properties: { "a/b": num } },
    expect: "fail",
    path: "/a~1b",
  },
  {
    name: "zod-style object output into zod-style input",
    s: {
      type: "object",
      properties: { id: str, n: int },
      required: ["id", "n"],
      additionalProperties: false,
    },
    t: { type: "object", properties: { id: str, n: num }, required: ["id"] },
    expect: "ok",
  },

  // ── anyOf / oneOf ──────────────────────────────────────────────────────
  {
    name: "anyOf source every alternative fits",
    s: { anyOf: [str, num] },
    t: { type: ["string", "number"] },
    expect: "ok",
  },
  {
    name: "anyOf source one alternative does not fit",
    s: { anyOf: [str, num] },
    t: str,
    expect: "fail",
  },
  { name: "source fits one anyOf alternative", s: str, t: { anyOf: [str, num] }, expect: "ok" },
  {
    name: "source fits no anyOf alternative",
    s: bool,
    t: { anyOf: [str, num] },
    expect: "fail",
    path: "",
  },
  { name: "anyOf into anyOf", s: { anyOf: [str, int] }, t: { anyOf: [num, str] }, expect: "ok" },
  {
    name: "discriminated union into itself",
    s: { oneOf: [kindA, kindB] },
    t: { oneOf: [kindA, kindB] },
    expect: "ok",
  },
  {
    name: "one variant into discriminated union",
    s: kindA,
    t: { oneOf: [kindA, kindB] },
    expect: "ok",
  },
  {
    name: "overlapping oneOf target is unverified",
    s: str,
    t: { oneOf: [str, { type: "string", minLength: 1 }] },
    expect: "unverified",
  },
  { name: "disjoint oneOf target by type", s: str, t: { oneOf: [str, num] }, expect: "ok" },
  {
    name: "disjoint oneOf target by literal",
    s: { const: "a" },
    t: { oneOf: [{ const: "a" }, { const: "b" }] },
    expect: "ok",
  },
  {
    name: "anyOf into oneOf with disjoint alternatives",
    s: { anyOf: [str, num] },
    t: { oneOf: [str, num] },
    expect: "ok",
  },
  { name: "empty anyOf source is vacuous", s: { anyOf: [] }, t: str, expect: "ok" },
  { name: "empty anyOf target accepts nothing", s: str, t: { anyOf: [] }, expect: "fail" },
  {
    name: "anyOf combined with siblings",
    s: { type: "string", anyOf: [{ minLength: 1 }, { maxLength: 0 }] },
    t: str,
    expect: "ok",
  },
  {
    name: "anyOf alternative combined with sibling type",
    s: { type: "string", anyOf: [{ minLength: 1 }, { maxLength: 0 }] },
    t: num,
    expect: "fail",
  },
  {
    name: "anyOf with an unconstrained alternative",
    s: { anyOf: [str, {}] },
    t: str,
    expect: "unverified",
  },
  {
    name: "target anyOf with an unconstrained alternative",
    s: bool,
    t: { anyOf: [str, {}] },
    expect: "ok",
  },
  {
    name: "nested anyOf property",
    s: { type: "object", properties: { a: { anyOf: [str, num] } } },
    t: { type: "object", properties: { a: num } },
    expect: "fail",
    path: "/a",
  },
  {
    name: "nested anyOf property fits",
    s: { type: "object", properties: { a: { anyOf: [int, num] } } },
    t: { type: "object", properties: { a: num } },
    expect: "ok",
  },
  {
    name: "anyOf on both sides distributes then matches",
    s: { anyOf: [kindA, kindB] },
    t: { anyOf: [kindB, kindA] },
    expect: "ok",
  },
  {
    name: "oneOf source alternative fails",
    s: { oneOf: [kindA, { type: "string" }] },
    t: obj,
    expect: "fail",
  },

  // ── flat sources sliced into anyOf / oneOf targets ─────────────────────
  {
    name: "type list into anyOf of its members",
    s: { type: ["string", "null"] },
    t: { anyOf: [str, nul] },
    expect: "ok",
  },
  {
    name: "nullable source into anyOf of string and null",
    s: { type: "string", nullable: true },
    t: { anyOf: [str, nul] },
    expect: "ok",
  },
  {
    name: "enum into anyOf of consts",
    s: { enum: ["a", "b"] },
    t: { anyOf: [{ const: "a" }, { const: "b" }] },
    expect: "ok",
  },
  {
    name: "integer|string into oneOf number|string",
    s: { type: ["integer", "string"] },
    t: { oneOf: [num, str] },
    expect: "ok",
  },
  {
    name: "enum into oneOf of disjoint consts",
    s: { enum: ["a", "b"] },
    t: { oneOf: [{ const: "a" }, { const: "b" }] },
    expect: "ok",
  },
  {
    name: "enum member missing from anyOf of consts",
    s: { enum: ["a", "b", "c"] },
    t: { anyOf: [{ const: "a" }, { const: "b" }] },
    expect: "fail",
    path: "",
  },
  {
    name: "type list member missing from anyOf",
    s: { type: ["string", "null", "number"] },
    t: { anyOf: [str, nul] },
    expect: "fail",
    path: "",
  },
  {
    name: "slices keep the source constraints (fit)",
    s: { type: ["string", "number"], minLength: 2, minimum: 0 },
    t: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "number", minimum: 0 },
      ],
    },
    expect: "ok",
  },
  {
    name: "slices keep the source constraints (too loose)",
    s: { type: ["string", "number"], minLength: 2, minimum: -1 },
    t: {
      anyOf: [
        { type: "string", minLength: 1 },
        { type: "number", minimum: 0 },
      ],
    },
    expect: "fail",
  },
  {
    name: "slice into overlapping oneOf alternatives is unverified",
    s: { type: ["string", "null"] },
    t: { oneOf: [str, { type: "string", minLength: 1 }, nul] },
    expect: "unverified",
  },
  {
    name: "literal slice overlapping a oneOf alternative is unverified",
    s: { enum: ["a", "b"] },
    t: { oneOf: [{ const: "a" }, str] },
    expect: "unverified",
  },
  {
    name: "mixed enum into anyOf of types",
    s: { enum: ["a", 1, null] },
    t: { anyOf: [str, int, nul] },
    expect: "ok",
  },
  {
    name: "mixed enum member outside an alternative bound",
    s: { enum: ["a", 1] },
    t: { anyOf: [str, { type: "integer", minimum: 2 }] },
    expect: "fail",
  },
  {
    name: "enum literals outside the declared type are not sliced",
    s: { type: "string", enum: ["a", 1] },
    t: { anyOf: [str, nul] },
    expect: "ok",
  },
  {
    name: "unconstrained source into anyOf stays unverified",
    s: {},
    t: { anyOf: [str, num] },
    expect: "unverified",
  },
  {
    name: "untyped constrained source into anyOf admits every type",
    s: { minLength: 1 },
    t: { anyOf: [str, num] },
    expect: "fail",
  },
  {
    name: "nested nullable property into anyOf property",
    s: { type: "object", properties: { a: { type: ["string", "null"] } } },
    t: { type: "object", properties: { a: { anyOf: [str, nul] } } },
    expect: "ok",
  },
  {
    name: "anyOf source with a multi-type alternative into anyOf target",
    s: { anyOf: [{ type: ["string", "null"] }, num] },
    t: { anyOf: [str, nul, num] },
    expect: "ok",
  },
  {
    name: "number slice with integral multipleOf into integer alternative",
    s: { type: ["number", "boolean"], multipleOf: 1 },
    t: { anyOf: [int, bool] },
    expect: "ok",
  },
  {
    name: "type list into anyOf of const objects fails",
    s: { type: ["object", "null"] },
    t: { anyOf: [{ const: { a: 1 } }, nul] },
    expect: "fail",
  },
  {
    name: "empty enum into empty anyOf is vacuous",
    s: { enum: [] },
    t: { anyOf: [] },
    expect: "ok",
  },
  {
    name: "type list into empty anyOf",
    s: { type: ["string", "null"] },
    t: { anyOf: [] },
    expect: "fail",
  },

  // ── allOf / $ref ───────────────────────────────────────────────────────
  {
    name: "allOf collapses",
    s: { allOf: [str, { minLength: 1 }] },
    t: { type: "string", minLength: 1 },
    expect: "ok",
  },
  {
    name: "allOf target collapses",
    s: { type: "string", minLength: 1 },
    t: { allOf: [str, { minLength: 2 }] },
    expect: "fail",
  },
  {
    name: "allOf merges properties",
    s: {
      allOf: [
        { type: "object", properties: { a: str } },
        { properties: { b: num }, required: ["b"] },
      ],
    },
    t: { type: "object", properties: { a: str, b: num }, required: ["b"] },
    expect: "ok",
  },
  {
    name: "untyped allOf admits non-objects",
    s: { allOf: [{ properties: { a: int } }, { properties: { a: { minimum: 0 } } }] },
    t: { type: "object", properties: { a: { type: "integer", minimum: 0 } } },
    expect: "fail",
  },
  {
    name: "typed allOf same property intersected",
    s: {
      type: "object",
      allOf: [{ properties: { a: int } }, { properties: { a: { minimum: 0 } } }],
    },
    t: { type: "object", properties: { a: { type: "integer", minimum: 0 } } },
    expect: "ok",
  },
  {
    name: "$ref source resolves",
    s: { $ref: "#/$defs/s", $defs: { s: str } },
    t: str,
    expect: "ok",
  },
  {
    name: "$ref target resolves",
    s: str,
    t: { $ref: "#/$defs/t", $defs: { t: str } },
    expect: "ok",
  },
  {
    name: "$ref with sibling keywords",
    s: { $ref: "#/$defs/s", minLength: 2, $defs: { s: str } },
    t: { type: "string", minLength: 1 },
    expect: "ok",
  },
  {
    name: "$ref inside properties",
    s: { type: "object", properties: { a: { $ref: "#/$defs/x" } }, $defs: { x: int } },
    t: { type: "object", properties: { a: num } },
    expect: "ok",
  },
  {
    name: "$ref inside properties mismatch",
    s: { type: "object", properties: { a: { $ref: "#/$defs/x" } }, $defs: { x: str } },
    t: { type: "object", properties: { a: num } },
    expect: "fail",
    path: "/a",
  },
  {
    name: "definitions keyword resolves",
    s: { $ref: "#/definitions/s", definitions: { s: str } },
    t: str,
    expect: "ok",
  },
  {
    name: "ref into properties of root",
    s: { type: "object", properties: { a: str, b: { $ref: "#/properties/a" } } },
    t: { type: "object", properties: { b: str } },
    expect: "ok",
  },
  { name: "unresolvable $ref", s: { $ref: "#/$defs/missing" }, t: str, expect: "unverified" },
  {
    name: "external $ref",
    s: { $ref: "https://example.com/schema.json" },
    t: str,
    expect: "unverified",
  },
  {
    name: "percent-encoded $ref token",
    s: { $ref: "#/$defs/a%20b", $defs: { "a b": str } },
    t: str,
    expect: "ok",
  },
  {
    name: "recursive $ref is unverified",
    s: {
      $ref: "#/$defs/node",
      $defs: { node: { type: "object", properties: { next: { $ref: "#/$defs/node" } } } },
    },
    t: {
      $ref: "#/$defs/node",
      $defs: { node: { type: "object", properties: { next: { $ref: "#/$defs/node" } } } },
    },
    expect: "unverified",
  },
  {
    name: "root self-reference is unverified",
    s: { type: "object", properties: { next: { $ref: "#" } } },
    t: { type: "object", properties: { next: { type: "object" } } },
    expect: "unverified",
  },
  {
    name: "recursion not reached stays verified",
    s: { type: "object", properties: { next: { $ref: "#" } } },
    t: obj,
    expect: "ok",
  },
  {
    name: "same $ref reused by siblings is not recursion",
    s: {
      type: "object",
      properties: { a: { $ref: "#/$defs/x" }, b: { $ref: "#/$defs/x" } },
      $defs: { x: str },
    },
    t: { type: "object", properties: { a: str, b: str } },
    expect: "ok",
  },
  {
    name: "directly self-referential $ref is unverified",
    s: { $ref: "#" },
    t: str,
    expect: "unverified",
  },

  // ── undecidable keywords ───────────────────────────────────────────────
  {
    name: "not on source",
    s: { type: "string", not: { const: "a" } },
    t: str,
    expect: "unverified",
  },
  {
    name: "not on target",
    s: str,
    t: { type: "string", not: { const: "a" } },
    expect: "unverified",
  },
  {
    name: "if/then on target",
    s: obj,
    t: { type: "object", if: { required: ["a"] }, then: { required: ["b"] } },
    expect: "unverified",
  },
  {
    name: "patternProperties on source",
    s: { type: "object", patternProperties: { "^x": str } },
    t: obj,
    expect: "unverified",
  },
  {
    name: "dependentSchemas on target",
    s: obj,
    t: { type: "object", dependentSchemas: { a: { required: ["b"] } } },
    expect: "unverified",
  },
  { name: "unknown keyword", s: { type: "string", foo: 1 }, t: str, expect: "unverified" },
  { name: "contains on target", s: arr, t: { type: "array", contains: str }, expect: "unverified" },
  {
    name: "failure wins over undecidable",
    s: { type: "string", not: { const: "a" } },
    t: num,
    expect: "fail",
  },
  {
    name: "annotations never make a schema unverified",
    s: { type: "string", title: "t", deprecated: true, readOnly: true },
    t: str,
    expect: "ok",
  },

  // ── ill-typed values of handled keywords ───────────────────────────────
  {
    name: "draft-4 boolean exclusiveMinimum on target",
    s: { type: "number", minimum: 0 },
    t: rawSchema({ type: "number", minimum: 0, exclusiveMinimum: true }),
    expect: "unverified",
  },
  {
    name: "draft-4 boolean exclusiveMaximum on source",
    s: rawSchema({ type: "number", maximum: 10, exclusiveMaximum: true }),
    t: { type: "number", maximum: 10 },
    expect: "unverified",
  },
  {
    name: "draft-7 array items on target",
    s: { type: "array", items: str },
    t: rawSchema({ type: "array", items: [str, num] }),
    expect: "unverified",
  },
  {
    name: "draft-7 array items on source",
    s: rawSchema({ type: "array", items: [str] }),
    t: arr,
    expect: "unverified",
  },
  {
    name: "string minimum",
    s: num,
    t: rawSchema({ type: "number", minimum: "0" }),
    expect: "unverified",
  },
  {
    name: "string minLength",
    s: rawSchema({ type: "string", minLength: "1" }),
    t: str,
    expect: "unverified",
  },
  {
    name: "NaN maximum",
    s: num,
    t: rawSchema({ type: "number", maximum: Number.NaN }),
    expect: "unverified",
  },
  {
    name: "non-positive multipleOf",
    s: num,
    t: rawSchema({ type: "number", multipleOf: 0 }),
    expect: "unverified",
  },
  {
    name: "non-string pattern",
    s: str,
    t: rawSchema({ type: "string", pattern: 1 }),
    expect: "unverified",
  },
  {
    name: "non-string format",
    s: str,
    t: rawSchema({ type: "string", format: ["email"] }),
    expect: "unverified",
  },
  { name: "unknown type name", s: str, t: rawSchema({ type: "any" }), expect: "unverified" },
  {
    name: "unknown type name beside known ones",
    s: str,
    t: rawSchema({ type: ["string", "date"] }),
    expect: "unverified",
  },
  {
    name: "unknown type name beside known ones still fails on a real mismatch",
    s: num,
    t: rawSchema({ type: ["string", "date"] }),
    expect: "fail",
  },
  {
    name: "non-boolean nullable",
    s: str,
    t: rawSchema({ type: "string", nullable: "yes" }),
    expect: "unverified",
  },
  { name: "non-array enum", s: str, t: rawSchema({ enum: "a" }), expect: "unverified" },
  {
    name: "non-object properties",
    s: obj,
    t: rawSchema({ type: "object", properties: ["a"] }),
    expect: "unverified",
  },
  {
    name: "non-schema property value",
    s: { type: "object", properties: { a: str } },
    t: rawSchema({ type: "object", properties: { a: "string" } }),
    expect: "unverified",
  },
  {
    name: "non-array required",
    s: obj,
    t: rawSchema({ type: "object", required: "a" }),
    expect: "unverified",
  },
  {
    name: "non-string required member",
    s: { type: "object", properties: { a: str }, required: ["a"] },
    t: rawSchema({ type: "object", required: ["a", 1] }),
    expect: "unverified",
  },
  {
    name: "non-schema additionalProperties",
    s: obj,
    t: rawSchema({ type: "object", additionalProperties: "no" }),
    expect: "unverified",
  },
  {
    name: "non-array prefixItems",
    s: arr,
    t: rawSchema({ type: "array", prefixItems: str }),
    expect: "unverified",
  },
  {
    name: "non-boolean uniqueItems",
    s: { type: "array", uniqueItems: true },
    t: rawSchema({ type: "array", uniqueItems: 1 }),
    expect: "unverified",
  },
  { name: "non-array anyOf", s: str, t: rawSchema({ anyOf: str }), expect: "unverified" },
  {
    name: "non-schema oneOf member",
    s: str,
    t: rawSchema({ oneOf: [str, "number"] }),
    expect: "unverified",
  },
  {
    name: "non-array allOf",
    s: str,
    t: rawSchema({ type: "string", allOf: str }),
    expect: "unverified",
  },
  {
    name: "non-string $ref",
    s: str,
    t: rawSchema({ type: "string", $ref: 1 }),
    expect: "unverified",
  },
  {
    name: "failure wins over an ill-typed keyword",
    s: rawSchema({ type: "string", minLength: "1" }),
    t: num,
    expect: "fail",
  },
  {
    name: "ill-typed keyword beside a decidable mismatch still fails",
    s: { type: "number", minimum: -1 },
    t: rawSchema({ type: "number", minimum: 0, exclusiveMinimum: true }),
    expect: "fail",
  },
  {
    name: "enum with object members is structural",
    s: rawSchema({ enum: [{ a: 1 }, "x"] }),
    t: { anyOf: [{ type: "object", properties: { a: int }, required: ["a"] }, str] },
    expect: "ok",
  },
  {
    name: "enum with object members not accepted by a string target",
    s: rawSchema({ enum: [{ a: 1 }, "x"] }),
    t: str,
    expect: "fail",
  },
  {
    name: "const object into enum with object members",
    s: { const: { a: 1 } },
    t: rawSchema({ enum: [{ a: 1 }, { a: 2 }] }),
    expect: "ok",
  },
];

describe("isSubschema table", () => {
  it("has at least 260 rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(260);
  });

  it.each(rows.map((r) => [r.name, r] as const))("%s", (_name, row) => {
    const result = isSubschema(row.s, row.t);
    expect(outcome(result), JSON.stringify(result)).toBe(row.expect);
    if (row.path !== undefined && !result.ok) expect(result.path).toBe(row.path);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe("isSubschema depth limit", () => {
  function nest(depth: number, leaf: JsonSchema): JsonSchema {
    let schema = leaf;
    for (let i = 0; i < depth; i++) schema = { type: "object", properties: { p: schema } };
    return schema;
  }

  it("reports a mismatch inside the limit", () => {
    const r = isSubschema(nest(10, str), nest(10, num));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe("/p/p/p/p/p/p/p/p/p/p");
  });

  it("gives up with unverified beyond MAX_DEPTH", () => {
    const r = isSubschema(nest(MAX_DEPTH + 5, str), nest(MAX_DEPTH + 5, num));
    expect(r).toEqual({ ok: true, verified: false });
  });

  it("still verifies an identical deep schema", () => {
    expect(isSubschema(nest(MAX_DEPTH + 5, str), nest(MAX_DEPTH + 5, str)).ok).toBe(true);
  });
});

/* ── generators ──────────────────────────────────────────────────────────── */

const arbPrimitiveLiteral: fc.Arbitrary<JsonPrimitive> = fc.oneof(
  fc.constantFrom("a", "b", "c", ""),
  fc.integer({ min: -3, max: 3 }),
  fc.constantFrom(0.5, 1.5),
  fc.boolean(),
  fc.constant(null),
);

const arbStringSchema: fc.Arbitrary<JsonSchema> = fc
  .record(
    {
      minLength: fc.integer({ min: 0, max: 3 }),
      maxLength: fc.integer({ min: 3, max: 8 }),
      pattern: fc.constantFrom("^a", "^b", "[0-9]+"),
      format: fc.constantFrom("email", "uri"),
    },
    { requiredKeys: [] },
  )
  .map((c) => ({ type: "string", ...c }));

const arbNumericSchema: fc.Arbitrary<JsonSchema> = fc
  .tuple(
    fc.constantFrom<"number" | "integer">("number", "integer"),
    fc.record(
      {
        minimum: fc.integer({ min: -5, max: 0 }),
        exclusiveMinimum: fc.integer({ min: -5, max: 0 }),
        maximum: fc.integer({ min: 1, max: 6 }),
        exclusiveMaximum: fc.integer({ min: 1, max: 6 }),
        multipleOf: fc.constantFrom(1, 2, 0.5, 3),
      },
      { requiredKeys: [] },
    ),
  )
  .map(([type, c]) => ({ type, ...c }));

const arbEnumSchema: fc.Arbitrary<JsonSchema> = fc
  .uniqueArray(arbPrimitiveLiteral, { minLength: 1, maxLength: 4 })
  .map((values) => ({ enum: values }));

const arbConstSchema: fc.Arbitrary<JsonSchema> = arbPrimitiveLiteral.map((value) => ({
  const: value,
}));

const arbSimpleSchema: fc.Arbitrary<JsonSchema> = fc.oneof(
  arbStringSchema,
  arbNumericSchema,
  arbEnumSchema,
  arbConstSchema,
  fc.constant<JsonSchema>({ type: "boolean" }),
  fc.constant<JsonSchema>({ type: "null" }),
  fc.constant<JsonSchema>({}),
);

const keys = ["a", "b", "c"] as const;

const { schema: arbSchema } = fc.letrec<{ schema: JsonSchema }>((tie) => ({
  schema: fc.oneof(
    { depthSize: "small", maxDepth: 3, withCrossShrink: true },
    arbSimpleSchema,
    fc
      .record(
        {
          items: tie("schema"),
          prefixItems: fc.array(tie("schema"), { minLength: 1, maxLength: 2 }),
          minItems: fc.integer({ min: 0, max: 2 }),
          maxItems: fc.integer({ min: 2, max: 4 }),
          uniqueItems: fc.constant(true),
        },
        { requiredKeys: [] },
      )
      .map((c): JsonSchema => ({ type: "array", ...c })),
    fc
      .tuple(
        fc.dictionary(fc.constantFrom(...keys), tie("schema"), { maxKeys: 3 }),
        fc.subarray([...keys]),
        fc.oneof(fc.constant(undefined), fc.constant(false), fc.constant(true), tie("schema")),
      )
      .map(([properties, required, additionalProperties]): JsonSchema => {
        const schema: JsonSchema = {
          type: "object",
          properties,
          required: required.filter((k) => k in properties),
        };
        if (additionalProperties !== undefined) schema.additionalProperties = additionalProperties;
        return schema;
      }),
    fc.array(tie("schema"), { minLength: 1, maxLength: 3 }).map((anyOf): JsonSchema => ({ anyOf })),
  ),
}));

const ALL_TYPE_NAMES: readonly JsonSchemaType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

/** A flat schema declaring at least two types, with constraints for several of them (or a mixed enum). */
const arbMultiTypeSchema: fc.Arbitrary<{ types: JsonSchemaType[]; schema: JsonSchema }> = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom(...ALL_TYPE_NAMES), { minLength: 2, maxLength: 4 }),
    fc.oneof(
      fc.record(
        {
          minimum: fc.integer({ min: -5, max: 0 }),
          exclusiveMaximum: fc.integer({ min: 1, max: 6 }),
          multipleOf: fc.constantFrom(1, 2, 0.5),
          minLength: fc.integer({ min: 0, max: 3 }),
          maxLength: fc.integer({ min: 3, max: 8 }),
          pattern: fc.constantFrom("^a", "[0-9]+"),
          format: fc.constantFrom("email", "uri"),
          minItems: fc.integer({ min: 0, max: 2 }),
          maxItems: fc.integer({ min: 2, max: 4 }),
          uniqueItems: fc.constant(true),
          items: arbSimpleSchema,
          properties: fc.dictionary(fc.constantFrom(...keys), arbSimpleSchema, { maxKeys: 2 }),
          required: fc.subarray([...keys], { maxLength: 1 }),
          additionalProperties: fc.oneof(fc.constant(false), arbSimpleSchema),
        },
        { requiredKeys: [] },
      ),
      fc
        .uniqueArray(arbPrimitiveLiteral, { minLength: 1, maxLength: 5 })
        .map((values): JsonSchema => ({ enum: values })),
    ),
  )
  .map(([types, constraints]) => {
    const schema: JsonSchema = { type: [...types], ...constraints };
    // Like `arbSchema`: only declared properties are required (a required property that
    // `additionalProperties: false` forbids is a contradiction the checker reports as a failure).
    if (schema.required !== undefined)
      schema.required = schema.required.filter((k) => k in (schema.properties ?? {}));
    return { types, schema };
  });

/* ── properties ──────────────────────────────────────────────────────────── */

describe("isSubschema properties", () => {
  it("is reflexive and verified on generated schemas", () => {
    fc.assert(
      fc.property(arbSchema, (s) => {
        expect(isSubschema(s, s)).toEqual({ ok: true, verified: true });
      }),
      { numRuns: 400 },
    );
  });

  it("is transitive on simple schemas", () => {
    fc.assert(
      fc.property(arbSimpleSchema, arbSimpleSchema, arbSimpleSchema, (s, t, u) => {
        const st = isSubschema(s, t);
        const tu = isSubschema(t, u);
        fc.pre(st.ok && st.verified && tu.ok && tu.verified);
        expect(isSubschema(s, u)).toEqual({ ok: true, verified: true });
      }),
      { numRuns: 1000 },
    );
  });

  it("accepts integer into number under identical numeric constraints", () => {
    fc.assert(
      fc.property(arbNumericSchema, (schema) => {
        expect(isSubschema({ ...schema, type: "integer" }, { ...schema, type: "number" })).toEqual({
          ok: true,
          verified: true,
        });
      }),
    );
  });

  it("decides enum inclusion exactly", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbPrimitiveLiteral, { minLength: 1, maxLength: 5 }),
        fc.uniqueArray(arbPrimitiveLiteral, { minLength: 1, maxLength: 5 }),
        (a, b) => {
          const subset = a.every((x) => b.some((y) => Object.is(x, y)));
          const result = isSubschema({ enum: a }, { enum: b });
          expect(result.ok).toBe(subset);
          if (result.ok) expect(result.verified).toBe(true);
        },
      ),
    );
  });

  it("accepts every schema into the unconstrained schema, verified", () => {
    fc.assert(
      fc.property(arbSchema, (s) => {
        expect(isSubschema(s, {})).toEqual({ ok: true, verified: true });
      }),
    );
  });

  it("never fails the unconstrained source, and only verifies it against an unconstrained target", () => {
    fc.assert(
      fc.property(arbSchema, (t) => {
        const r = isSubschema({}, t);
        expect(r.ok).toBe(true);
        if (r.ok && r.verified) expect(isSubschema(t, {})).toEqual({ ok: true, verified: true });
      }),
    );
  });

  it("fits a multi-type source into the anyOf of its per-type restrictions", () => {
    fc.assert(
      fc.property(arbMultiTypeSchema, ({ types, schema }) => {
        const restrictions = types.map((type): JsonSchema => ({ ...schema, type }));
        expect(isSubschema(schema, { anyOf: restrictions })).toEqual({ ok: true, verified: true });
        // The restrictions are pairwise disjoint by type unless both `number` and `integer` are named.
        if (!(types.includes("number") && types.includes("integer"))) {
          expect(isSubschema(schema, { oneOf: restrictions })).toEqual({
            ok: true,
            verified: true,
          });
        }
      }),
      { numRuns: 400 },
    );
  });

  it("agrees with anyOf on the source side: S ⊆ T for every alternative", () => {
    fc.assert(
      fc.property(
        fc.array(arbSimpleSchema, { minLength: 1, maxLength: 3 }),
        arbSimpleSchema,
        (alts, t) => {
          const combined = isSubschema({ anyOf: alts }, t);
          const each = alts.map((s) => isSubschema(s, t));
          expect(combined.ok).toBe(each.every((r) => r.ok));
        },
      ),
      { numRuns: 400 },
    );
  });
});
