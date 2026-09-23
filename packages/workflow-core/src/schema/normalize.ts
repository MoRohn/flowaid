/**
 * Schema normalisation for the subset checker and the projector
 * (ARCHITECTURE.md §4.5).
 *
 * A raw {@link JsonSchema} is turned into a flat {@link NormalSchema}: local
 * `$ref`s are resolved against the document root, `allOf` is collapsed by
 * intersection, a missing `type` means "any type", `enum`/`const` become a
 * literal set (object and array constants become structural schemas), OpenAPI
 * `nullable` becomes a `null` member of the type set, and `anyOf`/`oneOf`
 * are kept as a list of disjunctions to be distributed by the caller.
 *
 * Keywords the checker cannot decide (`not`, `if`/`then`/`else`,
 * `patternProperties`, `dependentSchemas`, … and anything unknown) are not
 * dropped silently: each is recorded in `unverified` so the checker can
 * answer `ok` with `verified: false`.
 *
 * @internal
 */
import { deepEqual, isPlainObject } from "@flowaid/shared";
import type { JsonPrimitive, JsonSchema, JsonSchemaType, JsonValue } from "../json.js";
import { isArrayIndexToken, parsePointer } from "./pointer.js";

/** Resolution context of one side of a check: the document `$ref`s resolve against and the refs currently being expanded. */
export interface SchemaContext {
  /** The document local `$ref`s (`#/$defs/x`) resolve against. */
  readonly root: JsonSchema;
  /** `$ref` targets already expanded on the current path (a repeat is a recursive `$ref`). */
  readonly active: ReadonlySet<string>;
}

/** Creates the context for a document root. */
export function rootContext(root: JsonSchema): SchemaContext {
  return { root, active: new Set() };
}

/** Context for the children of a schema whose normalisation followed `refs`. */
export function childContext(ctx: SchemaContext, refs: readonly string[]): SchemaContext {
  if (refs.length === 0) return ctx;
  const active = new Set(ctx.active);
  for (const ref of refs) active.add(ref);
  return { root: ctx.root, active };
}

/** A numeric interval end. */
export interface Bound {
  value: number;
  exclusive: boolean;
}

/** One `anyOf`/`oneOf` keyword kept for distribution. */
export interface Disjunction {
  kind: "anyOf" | "oneOf";
  alternatives: JsonSchema[];
}

/** The flat, intersected form of a schema. `null`/`undefined` fields mean "unconstrained". */
export interface NormalSchema {
  /** Allowed JSON types; `null` = every type. `number` includes `integer`. */
  types: ReadonlySet<JsonSchemaType> | null;
  /** Allowed literal values (from `enum`/`const`); `null` = unconstrained. Always primitives: object/array constants become structure. */
  literals: JsonPrimitive[] | null;
  lo: Bound | undefined;
  hi: Bound | undefined;
  /** Every `multipleOf` in effect (intersection keeps them all). */
  multipleOfs: number[];
  minLength: number | undefined;
  maxLength: number | undefined;
  patterns: string[];
  formats: string[];
  properties: Record<string, JsonSchema>;
  required: ReadonlySet<string>;
  /** `undefined`/`true` = any extra property; `false` = none; a schema constrains them. */
  additionalProperties: JsonSchema | boolean | undefined;
  /** Items beyond `prefixItems`: `undefined`/`true` = anything; `false` = none. */
  items: JsonSchema | boolean | undefined;
  prefixItems: JsonSchema[];
  minItems: number | undefined;
  maxItems: number | undefined;
  uniqueItems: boolean;
  disjunctions: Disjunction[];
  /** Reasons the schema cannot be fully decided (`keyword 'not'`, `recursive $ref '#/$defs/x'`, …). */
  unverified: string[];
  /** `$ref` targets followed while normalising this level (become `active` for children). */
  refs: string[];
}

/** The unconstrained schema. */
export function anySchema(): NormalSchema {
  return {
    types: null,
    literals: null,
    lo: undefined,
    hi: undefined,
    multipleOfs: [],
    minLength: undefined,
    maxLength: undefined,
    patterns: [],
    formats: [],
    properties: {},
    required: new Set(),
    additionalProperties: undefined,
    items: undefined,
    prefixItems: [],
    minItems: undefined,
    maxItems: undefined,
    uniqueItems: false,
    disjunctions: [],
    unverified: [],
    refs: [],
  };
}

/** Does the normalised schema constrain anything at all (ignoring undecidable keywords)? */
export function isUnconstrained(n: NormalSchema): boolean {
  return (
    n.types === null &&
    n.literals === null &&
    n.lo === undefined &&
    n.hi === undefined &&
    n.multipleOfs.length === 0 &&
    n.minLength === undefined &&
    n.maxLength === undefined &&
    n.patterns.length === 0 &&
    n.formats.length === 0 &&
    Object.keys(n.properties).length === 0 &&
    n.required.size === 0 &&
    (n.additionalProperties === undefined || n.additionalProperties === true) &&
    (n.items === undefined || n.items === true) &&
    n.prefixItems.length === 0 &&
    n.minItems === undefined &&
    n.maxItems === undefined &&
    !n.uniqueItems &&
    n.disjunctions.length === 0
  );
}

const ALL_TYPES: readonly JsonSchemaType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

/** Does the type set admit `t`? (`number` admits `integer`; `null` = everything.) */
export function typeSetIncludes(
  types: ReadonlySet<JsonSchemaType> | null,
  t: JsonSchemaType,
): boolean {
  if (types === null) return true;
  return types.has(t) || (t === "integer" && types.has("number"));
}

/** Intersection of two type sets (`null` = all). `{number} ∩ {integer}` = `{integer}`. */
export function intersectTypes(
  a: ReadonlySet<JsonSchemaType> | null,
  b: ReadonlySet<JsonSchemaType> | null,
): ReadonlySet<JsonSchemaType> | null {
  if (a === null) return b;
  if (b === null) return a;
  const out = new Set<JsonSchemaType>();
  for (const t of ALL_TYPES) if (typeSetIncludes(a, t) && typeSetIncludes(b, t)) out.add(t);
  if (out.has("number")) out.delete("integer");
  return out;
}

/** The JSON Schema type of a primitive literal (`integer` for integral numbers). */
export function literalType(v: JsonPrimitive): JsonSchemaType {
  if (v === null) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  return Number.isInteger(v) ? "integer" : "number";
}

/** Types a value of the schema can actually take: the declared set narrowed by the literal set. */
export function effectiveTypes(n: NormalSchema): ReadonlySet<JsonSchemaType> | null {
  if (n.literals === null) return n.types;
  const out = new Set<JsonSchemaType>();
  for (const v of n.literals) {
    const t = literalType(v);
    if (typeSetIncludes(n.types, t)) out.add(t);
  }
  return out;
}

function tighterLo(a: Bound | undefined, b: Bound | undefined): Bound | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.value === b.value) return { value: a.value, exclusive: a.exclusive || b.exclusive };
  return a.value > b.value ? a : b;
}

function tighterHi(a: Bound | undefined, b: Bound | undefined): Bound | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a.value === b.value) return { value: a.value, exclusive: a.exclusive || b.exclusive };
  return a.value < b.value ? a : b;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function unionStrings(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a];
  for (const s of b) if (!out.includes(s)) out.push(s);
  return out;
}

function unionNumbers(a: readonly number[], b: readonly number[]): number[] {
  const out = [...a];
  for (const n of b) if (!out.includes(n)) out.push(n);
  return out;
}

/** Intersection of two child schemas (`undefined`/`true` = any, `false` = none). */
function meetChild(
  a: JsonSchema | boolean | undefined,
  b: JsonSchema | boolean | undefined,
): JsonSchema | boolean | undefined {
  if (a === false || b === false) return false;
  if (a === undefined || a === true) return b;
  if (b === undefined || b === true) return a;
  return { allOf: [a, b] };
}

/**
 * The intersection of two normalised schemas: a value is valid under the result
 * iff it is valid under both. Used to collapse `allOf` and to combine a
 * disjunction alternative with the rest of its schema.
 */
export function meet(a: NormalSchema, b: NormalSchema): NormalSchema {
  let literals: JsonPrimitive[] | null;
  if (a.literals === null) literals = b.literals;
  else if (b.literals === null) literals = a.literals;
  else literals = a.literals.filter((x) => (b.literals ?? []).some((y) => deepEqual(x, y)));

  const properties: Record<string, JsonSchema> = { ...a.properties };
  for (const [key, schema] of Object.entries(b.properties)) {
    const existing = properties[key];
    properties[key] = existing === undefined ? schema : { allOf: [existing, schema] };
  }
  const required = new Set(a.required);
  for (const r of b.required) required.add(r);

  let maxItems = minDefined(a.maxItems, b.maxItems);
  const prefixItems: JsonSchema[] = [];
  const prefixLen = Math.max(a.prefixItems.length, b.prefixItems.length);
  for (let i = 0; i < prefixLen; i++) {
    const ai = i < a.prefixItems.length ? a.prefixItems[i] : a.items;
    const bi = i < b.prefixItems.length ? b.prefixItems[i] : b.items;
    const merged = meetChild(ai, bi);
    if (merged === false) {
      maxItems = minDefined(maxItems, i);
      break;
    }
    prefixItems.push(merged === undefined || merged === true ? {} : merged);
  }

  return {
    types: intersectTypes(a.types, b.types),
    literals,
    lo: tighterLo(a.lo, b.lo),
    hi: tighterHi(a.hi, b.hi),
    multipleOfs: unionNumbers(a.multipleOfs, b.multipleOfs),
    minLength: maxDefined(a.minLength, b.minLength),
    maxLength: minDefined(a.maxLength, b.maxLength),
    patterns: unionStrings(a.patterns, b.patterns),
    formats: unionStrings(a.formats, b.formats),
    properties,
    required,
    additionalProperties: meetChild(a.additionalProperties, b.additionalProperties),
    items: meetChild(a.items, b.items),
    prefixItems,
    minItems: maxDefined(a.minItems, b.minItems),
    maxItems,
    uniqueItems: a.uniqueItems || b.uniqueItems,
    disjunctions: [...a.disjunctions, ...b.disjunctions],
    unverified: unionStrings(a.unverified, b.unverified),
    refs: unionStrings(a.refs, b.refs),
  };
}

/** Keywords that only annotate and never constrain. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$comment",
  "$anchor",
  "$defs",
  "definitions",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "example",
  "x-ui",
  "x-dataClass",
  "x-secret",
]);

/** Keywords normalisation handles itself. */
const HANDLED_KEYWORDS: ReadonlySet<string> = new Set([
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "type",
  "nullable",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

function isSchemaObject(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isJsonSchemaType(v: unknown): v is JsonSchemaType {
  return typeof v === "string" && ALL_TYPES.some((t) => t === v);
}

function isPrimitive(v: unknown): v is JsonPrimitive {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && !Number.isNaN(v))
  );
}

/** Is `v` a JSON value (primitives, arrays and plain objects of JSON values)? */
function isJsonValue(v: unknown): v is JsonValue {
  if (isPrimitive(v)) return true;
  if (Array.isArray(v)) return v.every(isJsonValue);
  return isPlainObject(v) && Object.values(v).every(isJsonValue);
}

/** Turns a constant value into a schema accepting exactly that value (structural for objects and arrays). */
export function constSchema(value: JsonValue): JsonSchema {
  if (Array.isArray(value)) {
    return {
      type: "array",
      prefixItems: value.map(constSchema),
      items: false,
      minItems: value.length,
      maxItems: value.length,
    };
  }
  if (isPrimitive(value)) return { const: value };
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(value)) properties[k] = constSchema(v);
  return { type: "object", properties, required: Object.keys(value), additionalProperties: false };
}

/** Resolves a local `$ref` against the document root. `undefined` when it is not local or does not point at a schema. */
export function resolveLocalRef(root: JsonSchema, ref: string): JsonSchema | undefined {
  if (!ref.startsWith("#")) return undefined;
  const fragment = decodeFragment(ref.slice(1));
  if (fragment === undefined) return undefined;
  const parsed = parsePointer(fragment);
  if (!parsed.ok) return undefined;
  let current: unknown = root;
  for (const token of parsed.tokens) {
    if (typeof current !== "object" || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!isArrayIndexToken(token) || index >= current.length) return undefined;
      current = current[index];
    } else if (isPlainObject(current)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return isSchemaObject(current) ? current : undefined;
}

function decodeFragment(fragment: string): string | undefined {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return undefined;
  }
}

/**
 * Normalises one schema level. Children (`properties`, `items`, …) stay raw and
 * are normalised when the caller recurses into them with {@link childContext}.
 */
export function normalize(schema: JsonSchema, ctx: SchemaContext): NormalSchema {
  return normalizeWith(schema, ctx, new Set());
}

function normalizeWith(
  schema: JsonSchema,
  ctx: SchemaContext,
  expanding: ReadonlySet<string>,
): NormalSchema {
  let n = ownConstraints(schema);

  const raw: Record<string, unknown> = schema;
  const ref = raw["$ref"];
  if (typeof ref === "string") {
    if (ctx.active.has(ref) || expanding.has(ref)) {
      n.unverified.push(`recursive $ref '${ref}'`);
    } else {
      const target = resolveLocalRef(ctx.root, ref);
      if (target === undefined) {
        n.unverified.push(`unresolvable $ref '${ref}'`);
      } else {
        const inner = new Set(expanding);
        inner.add(ref);
        n = meet(n, normalizeWith(target, ctx, inner));
        n.refs = unionStrings(n.refs, [ref]);
      }
    }
  }

  for (const sub of allOfList(schema)) n = meet(n, normalizeWith(sub, ctx, expanding));
  return n;
}

/** Records that a handled keyword carries a value of a shape the checker does not understand. */
function unexpected(n: NormalSchema, keyword: string): void {
  n.unverified.push(`keyword '${keyword}' has an unexpected value`);
}

/** Reads a numeric keyword; a non-number (draft-4 boolean `exclusiveMinimum`, a string, …) is recorded as unexpected. */
function numberKeyword(
  n: NormalSchema,
  raw: Record<string, unknown>,
  keyword: string,
): number | undefined {
  const value = raw[keyword];
  if (value === undefined) return undefined;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  unexpected(n, keyword);
  return undefined;
}

/** Reads a string keyword (`pattern`, `format`, `$ref`). */
function stringKeyword(
  n: NormalSchema,
  raw: Record<string, unknown>,
  keyword: string,
): string | undefined {
  const value = raw[keyword];
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  unexpected(n, keyword);
  return undefined;
}

/** Reads a boolean keyword (`nullable`, `uniqueItems`). */
function booleanKeyword(
  n: NormalSchema,
  raw: Record<string, unknown>,
  keyword: string,
): boolean | undefined {
  const value = raw[keyword];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  unexpected(n, keyword);
  return undefined;
}

/** Reads a keyword holding a list of schemas (`allOf`, `anyOf`, `oneOf`, `prefixItems`). */
function schemaListKeyword(
  n: NormalSchema,
  raw: Record<string, unknown>,
  keyword: string,
): JsonSchema[] | undefined {
  const value = raw[keyword];
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every(isSchemaObject)) return [...value];
  unexpected(n, keyword);
  return undefined;
}

/** Reads a keyword holding a schema or a boolean (`additionalProperties`, `items`; a draft-7 tuple `items` array is unexpected). */
function childKeyword(
  n: NormalSchema,
  raw: Record<string, unknown>,
  keyword: string,
): JsonSchema | boolean | undefined {
  const value = raw[keyword];
  if (value === undefined) return undefined;
  if (typeof value === "boolean" || isSchemaObject(value)) return value;
  unexpected(n, keyword);
  return undefined;
}

/** The `allOf` list of a schema, for the `$ref`/`allOf` expansion in {@link normalizeWith}. */
function allOfList(schema: JsonSchema): JsonSchema[] {
  const raw: Record<string, unknown> = schema;
  const value = raw["allOf"];
  return Array.isArray(value) && value.every(isSchemaObject) ? value : [];
}

/** The constraints written directly on this schema object (no `$ref`/`allOf` expansion). */
function ownConstraints(schema: JsonSchema): NormalSchema {
  const n = anySchema();
  // Keyword values are read untyped: `isSubschema` takes raw documents whose values may not match the declared shapes.
  const raw: Record<string, unknown> = schema;

  for (const keyword of Object.keys(schema)) {
    if (HANDLED_KEYWORDS.has(keyword) || ANNOTATION_KEYWORDS.has(keyword)) continue;
    if (keyword.startsWith("x-")) continue;
    if (schema[keyword] === undefined) continue;
    n.unverified.push(`keyword '${keyword}'`);
  }

  // `$ref` and `allOf` are expanded by the caller; only their shape is checked here.
  stringKeyword(n, raw, "$ref");
  schemaListKeyword(n, raw, "allOf");

  const type = raw["type"];
  if (type !== undefined) {
    const names: unknown[] = Array.isArray(type) ? type : [type];
    const types = new Set<JsonSchemaType>();
    for (const t of names) {
      if (isJsonSchemaType(t)) types.add(t);
      else unexpected(n, "type");
    }
    if (types.has("number")) types.delete("integer");
    // A `type` naming no known type at all is left unconstrained (and unverified) rather than read as the empty schema.
    if (types.size > 0 || names.length === 0) n.types = types;
  }
  if (booleanKeyword(n, raw, "nullable") === true && n.types !== null) {
    const withNull = new Set(n.types);
    withNull.add("null");
    n.types = withNull;
  }

  const members = raw["enum"];
  if (members !== undefined) {
    if (!Array.isArray(members)) {
      unexpected(n, "enum");
    } else if (members.every(isPrimitive)) {
      n.literals = [...members];
    } else if (members.every(isJsonValue)) {
      // Object/array members become structure, like a non-primitive `const`.
      n.disjunctions.push({ kind: "anyOf", alternatives: members.map(constSchema) });
    } else {
      unexpected(n, "enum");
    }
  }
  const value = raw["const"];
  if (value !== undefined) {
    if (isPrimitive(value)) {
      n.literals = n.literals === null ? [value] : n.literals.filter((x) => deepEqual(x, value));
    } else if (isJsonValue(value)) {
      n.disjunctions.push({ kind: "anyOf", alternatives: [constSchema(value)] });
    } else {
      unexpected(n, "const");
    }
  }

  const minimum = numberKeyword(n, raw, "minimum");
  if (minimum !== undefined) n.lo = { value: minimum, exclusive: false };
  const exclusiveMinimum = numberKeyword(n, raw, "exclusiveMinimum");
  if (exclusiveMinimum !== undefined)
    n.lo = tighterLo(n.lo, { value: exclusiveMinimum, exclusive: true });
  const maximum = numberKeyword(n, raw, "maximum");
  if (maximum !== undefined) n.hi = { value: maximum, exclusive: false };
  const exclusiveMaximum = numberKeyword(n, raw, "exclusiveMaximum");
  if (exclusiveMaximum !== undefined)
    n.hi = tighterHi(n.hi, { value: exclusiveMaximum, exclusive: true });
  const multipleOf = numberKeyword(n, raw, "multipleOf");
  if (multipleOf !== undefined) {
    if (multipleOf > 0) n.multipleOfs = [multipleOf];
    else unexpected(n, "multipleOf");
  }

  n.minLength = numberKeyword(n, raw, "minLength");
  n.maxLength = numberKeyword(n, raw, "maxLength");
  const pattern = stringKeyword(n, raw, "pattern");
  if (pattern !== undefined) n.patterns = [pattern];
  const format = stringKeyword(n, raw, "format");
  if (format !== undefined) n.formats = [format];

  const declared = raw["properties"];
  if (declared !== undefined) {
    if (isPlainObject(declared)) {
      const properties: Record<string, JsonSchema> = {};
      for (const [name, child] of Object.entries(declared)) {
        if (isSchemaObject(child)) properties[name] = child;
        else unexpected(n, "properties");
      }
      n.properties = properties;
    } else {
      unexpected(n, "properties");
    }
  }
  const requiredNames = raw["required"];
  if (requiredNames !== undefined) {
    if (!Array.isArray(requiredNames)) {
      unexpected(n, "required");
    } else {
      const required = new Set<string>();
      for (const name of requiredNames) {
        if (typeof name === "string") required.add(name);
        else unexpected(n, "required");
      }
      n.required = required;
    }
  }
  n.additionalProperties = childKeyword(n, raw, "additionalProperties");

  n.items = childKeyword(n, raw, "items");
  const prefixItems = schemaListKeyword(n, raw, "prefixItems");
  if (prefixItems !== undefined) n.prefixItems = prefixItems;
  n.minItems = numberKeyword(n, raw, "minItems");
  n.maxItems = numberKeyword(n, raw, "maxItems");
  if (booleanKeyword(n, raw, "uniqueItems") === true) n.uniqueItems = true;

  const anyOf = schemaListKeyword(n, raw, "anyOf");
  if (anyOf !== undefined) n.disjunctions.push({ kind: "anyOf", alternatives: anyOf });
  const oneOf = schemaListKeyword(n, raw, "oneOf");
  if (oneOf !== undefined) n.disjunctions.push({ kind: "oneOf", alternatives: oneOf });

  return n;
}

/** Upper bound on the number of alternatives a cross product of disjunctions may expand to. */
export const MAX_ALTERNATIVES = 64;

/**
 * Expands every disjunction of `n` into flat alternatives: the cross product of
 * the alternatives, each intersected with the rest of the schema. `null` when
 * the product exceeds {@link MAX_ALTERNATIVES} (the caller reports unverified).
 */
export function expandDisjunctions(
  n: NormalSchema,
  ctx: SchemaContext,
): { kind: "anyOf" | "oneOf"; alternatives: NormalSchema[] } | null {
  const base: NormalSchema = { ...n, disjunctions: [] };
  let kind: "anyOf" | "oneOf" = "anyOf";
  let current: NormalSchema[] = [base];
  for (const d of n.disjunctions) {
    if (d.kind === "oneOf") kind = "oneOf";
    if (current.length * d.alternatives.length > MAX_ALTERNATIVES) return null;
    const next: NormalSchema[] = [];
    for (const partial of current) {
      for (const alt of d.alternatives) {
        const merged = meet(partial, normalize(alt, ctx));
        if (merged.disjunctions.length > 0) {
          const nested = expandDisjunctions(merged, ctx);
          if (nested === null) return null;
          if (nested.kind === "oneOf") kind = "oneOf";
          next.push(...nested.alternatives);
        } else {
          next.push(merged);
        }
        if (next.length > MAX_ALTERNATIVES) return null;
      }
    }
    current = next;
  }
  return { kind, alternatives: current };
}
