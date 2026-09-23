/**
 * JSON Pointer projection — `projectSchema` (compile time) and its runtime
 * twin `projectValue` (ARCHITECTURE.md §4.5, §5.4; CONTRACTS.ts §13).
 *
 * `projectSchema(S, "/a/0/b")` answers "what schema does the value at
 * `a[0].b` of a value valid under `S` have?" by walking `properties`, `items`,
 * `prefixItems` and `additionalProperties` (local `$ref`s and `allOf` are
 * resolved on the way; `anyOf`/`oneOf` levels project every alternative and
 * return their union). A missing property under `additionalProperties: false`
 * (or an item the array cannot have) is an `ok: false` result the compiler
 * reports as `E_REF_PATH_INVALID`; a step through an unconstrained level
 * yields `{}` with `typed: false` (`W_REF_PATH_UNTYPED`).
 *
 * `projectValue(value, "/a/0/b")` walks a runtime value the same way: a
 * missing property or index yields `undefined` (so a binding `default` can
 * apply) while indexing into a scalar is an error. A `null` level counts as
 * absent, not as a scalar, because `projectSchema` admits a pointer through a
 * nullable level (`type: ['object', 'null']`); such a walk reports
 * `nullable: true` so the compiler can warn that the binding needs a
 * `default`.
 */
import type { JsonSchema, JsonValue } from "../json.js";
import {
  effectiveTypes,
  expandDisjunctions,
  isUnconstrained,
  normalize,
  rootContext,
  typeSetIncludes,
  type NormalSchema,
  type SchemaContext,
} from "./normalize.js";
import { isArrayIndexToken, parsePointer } from "./pointer.js";

/**
 * Result of {@link projectSchema}. `typed: false` means the walk passed through
 * an untyped keyword; `nullable: true` means a level the pointer steps
 * *through* (root to the penultimate token) admits `null`, so at runtime the
 * value may be absent where the schema promised structure and the compiler
 * should advise a binding `default`. The empty pointer steps through nothing
 * and is never nullable; the projected value itself being nullable is visible
 * in `schema`, not here.
 */
export type ProjectSchemaResult =
  | { ok: true; schema: JsonSchema; typed: boolean; nullable: boolean }
  | { ok: false; reason: string };

/** Result of {@link projectValue}. `value` is `undefined` when a property or index along the pointer is absent. */
export type ProjectValueResult =
  { ok: true; value: JsonValue | undefined } | { ok: false; reason: string };

/** Walks a JSON pointer through properties/items/prefixItems/additionalProperties/$defs. */
export function projectSchema(schema: JsonSchema, pointer: string): ProjectSchemaResult {
  const parsed = parsePointer(pointer);
  if (!parsed.ok) return { ok: false, reason: parsed.message };
  if (parsed.tokens.length === 0) return { ok: true, schema, typed: true, nullable: false };

  const ctx = rootContext(schema);
  let current: Step[] = [{ schema, ctx, typed: true, nullable: false }];
  let consumed = "";
  for (const token of parsed.tokens) {
    const next: Step[] = [];
    const reasons: string[] = [];
    for (const step of current) {
      const outcome = projectStep(step, token, consumed);
      for (const r of outcome) {
        if (r.ok) next.push(r.step);
        else reasons.push(r.reason);
      }
    }
    if (next.length === 0) {
      return { ok: false, reason: reasons[0] ?? `cannot project '${token}'` };
    }
    current = dedupe(next);
    consumed = consumed + "/" + token.replace(/~/g, "~0").replace(/\//g, "~1");
  }

  const typed = current.every((s) => s.typed);
  const nullable = current.some((s) => s.nullable);
  if (current.length === 1) {
    const only = current[0];
    if (only === undefined) return { ok: false, reason: "projection produced no schema" };
    return { ok: true, schema: withDefs(schema, only.schema), typed, nullable };
  }
  return {
    ok: true,
    schema: withDefs(schema, { anyOf: current.map((s) => s.schema) }),
    typed,
    nullable,
  };
}

/** One live branch of the walk. */
interface Step {
  schema: JsonSchema;
  ctx: SchemaContext;
  typed: boolean;
  /** A level already stepped through on this branch admitted `null`. */
  nullable: boolean;
}

type StepOutcome = { ok: true; step: Step } | { ok: false; reason: string };

/** Projects one token through one branch. Returns one outcome per resulting alternative. */
function projectStep(step: Step, token: string, consumed: string): StepOutcome[] {
  // A pointer is finite, so recursive `$ref`s are followed here (the root
  // context is kept for every level) instead of being reported unverified.
  const ctx = step.ctx;
  const n = normalize(step.schema, ctx);
  if (n.disjunctions.length > 0) {
    const expanded = expandDisjunctions(n, ctx);
    if (expanded === null)
      return [{ ok: true, step: { schema: {}, ctx, typed: false, nullable: step.nullable } }];
    // A `null` alternative admits no path at all: it is dropped here (the
    // remaining alternatives decide) but remembered as a nullable level.
    const nullable = step.nullable || expanded.alternatives.some((alt) => admitsNull(alt));
    const outcomes: StepOutcome[] = [];
    for (const alt of expanded.alternatives)
      outcomes.push(...projectFlat(alt, ctx, step.typed, nullable, token, consumed));
    return outcomes;
  }
  return projectFlat(n, ctx, step.typed, step.nullable || admitsNull(n), token, consumed);
}

/** True when a value of the (flat) schema may be `null` and the schema says so explicitly. */
function admitsNull(n: NormalSchema): boolean {
  const types = effectiveTypes(n);
  return types !== null && types.has("null");
}

function projectFlat(
  n: NormalSchema,
  ctx: SchemaContext,
  typed: boolean,
  nullable: boolean,
  token: string,
  consumed: string,
): StepOutcome[] {
  const stillTyped = typed && n.unverified.length === 0;
  if (isUnconstrained(n)) return [{ ok: true, step: { schema: {}, ctx, typed: false, nullable } }];

  const outcomes: StepOutcome[] = [];
  const types = effectiveTypes(n);
  const canBeObject = typeSetIncludes(types, "object");
  const canBeArray = typeSetIncludes(types, "array") && isArrayIndexToken(token);

  if (types !== null && !canBeObject && !canBeArray) {
    const kinds = types.size === 0 ? "a value with no possible type" : [...types].join(" | ");
    return [{ ok: false, reason: `cannot index '${token}' into ${kinds} at '${consumed || "/"}'` }];
  }

  if (canBeObject) {
    const declared = n.properties[token];
    if (declared !== undefined) {
      outcomes.push({ ok: true, step: { schema: declared, ctx, typed: stillTyped, nullable } });
    } else if (n.additionalProperties === false) {
      outcomes.push({
        ok: false,
        reason: `property '${token}' does not exist at '${consumed || "/"}' (additionalProperties: false)`,
      });
    } else if (n.additionalProperties === undefined || n.additionalProperties === true) {
      outcomes.push({ ok: true, step: { schema: {}, ctx, typed: false, nullable } });
    } else {
      outcomes.push({
        ok: true,
        step: { schema: n.additionalProperties, ctx, typed: stillTyped, nullable },
      });
    }
  }

  if (canBeArray) {
    const index = Number(token);
    const prefix = n.prefixItems[index];
    if (n.maxItems !== undefined && index >= n.maxItems) {
      outcomes.push({
        ok: false,
        reason: `index ${index} exceeds maxItems ${n.maxItems} at '${consumed || "/"}'`,
      });
    } else if (prefix !== undefined) {
      outcomes.push({ ok: true, step: { schema: prefix, ctx, typed: stillTyped, nullable } });
    } else if (n.items === false) {
      outcomes.push({
        ok: false,
        reason: `index ${index} is beyond the ${n.prefixItems.length} allowed items at '${consumed || "/"}'`,
      });
    } else if (n.items === undefined || n.items === true) {
      outcomes.push({ ok: true, step: { schema: {}, ctx, typed: false, nullable } });
    } else {
      outcomes.push({ ok: true, step: { schema: n.items, ctx, typed: stillTyped, nullable } });
    }
  }

  if (outcomes.length === 0) {
    // Untyped level that is neither object nor array: the pointer may still be valid at runtime.
    outcomes.push({ ok: true, step: { schema: {}, ctx, typed: false, nullable } });
  }
  return outcomes;
}

function dedupe(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    if (!out.some((o) => o.schema === s.schema && o.typed === s.typed && o.nullable === s.nullable))
      out.push(s);
  }
  return out;
}

const ROOT_DEF = "__root__";

/**
 * Makes a projected sub-schema self-contained: when it (transitively) uses
 * local `$ref`s, the root's `$defs`/`definitions` are attached and refs that
 * point elsewhere into the root are redirected to a copy of the root stored
 * under `$defs/__root__`.
 */
function withDefs(root: JsonSchema, projected: JsonSchema): JsonSchema {
  if (projected === root) return root;
  const refs = collectRefs(projected, []);
  if (refs.length === 0) return projected;
  const needsRootCopy = refs.some((r) => !isDefsRef(r));
  const out: JsonSchema = needsRootCopy ? rewriteRefs(projected) : { ...projected };
  const defs: Record<string, JsonSchema> = { ...(root.$defs ?? {}) };
  if (needsRootCopy) {
    for (const [k, v] of Object.entries(defs)) defs[k] = rewriteRefs(v);
    defs[ROOT_DEF] = rewriteRefs(root);
  }
  if (Object.keys(defs).length > 0) out.$defs = defs;
  const definitions = root.definitions;
  if (isSchemaRecord(definitions)) {
    const copy: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(definitions)) copy[k] = needsRootCopy ? rewriteRefs(v) : v;
    out.definitions = copy;
  }
  return out;
}

function isDefsRef(ref: string): boolean {
  return ref.startsWith("#/$defs/") || ref.startsWith("#/definitions/");
}

function isSchemaRecord(v: unknown): v is Record<string, JsonSchema> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSchemaObject(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every `$ref` string reachable from `schema` (through objects and arrays; `$defs` included). */
function collectRefs(node: unknown, acc: string[]): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc);
  } else if (isSchemaObject(node)) {
    if (typeof node.$ref === "string") acc.push(node.$ref);
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "$ref" ||
        key === "enum" ||
        key === "const" ||
        key === "default" ||
        key === "examples"
      )
        continue;
      collectRefs(value, acc);
    }
  }
  return acc;
}

/**
 * Deep copy in which every local non-`$defs` `$ref` (`#`, `#/properties/…`)
 * points into `$defs/__root__`. Only the structural keywords the checker
 * understands are descended into; refs under undecidable keywords stay as they
 * are (those keywords are reported unverified anyway).
 */
function rewriteRefs(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#") && !isDefsRef(schema.$ref)) {
    out.$ref = `#/$defs/${ROOT_DEF}${schema.$ref.slice(1)}`;
  }
  if (schema.$defs !== undefined) out.$defs = mapRecord(schema.$defs, rewriteRefs);
  if (isSchemaRecord(schema.definitions))
    out.definitions = mapRecord(schema.definitions, rewriteRefs);
  if (schema.properties !== undefined) out.properties = mapRecord(schema.properties, rewriteRefs);
  if (typeof schema.additionalProperties === "object")
    out.additionalProperties = rewriteRefs(schema.additionalProperties);
  if (typeof schema.items === "object") out.items = rewriteRefs(schema.items);
  if (schema.prefixItems !== undefined) out.prefixItems = schema.prefixItems.map(rewriteRefs);
  if (schema.anyOf !== undefined) out.anyOf = schema.anyOf.map(rewriteRefs);
  if (schema.oneOf !== undefined) out.oneOf = schema.oneOf.map(rewriteRefs);
  if (schema.allOf !== undefined) out.allOf = schema.allOf.map(rewriteRefs);
  if (schema.not !== undefined) out.not = rewriteRefs(schema.not);
  return out;
}

function mapRecord(
  record: Record<string, JsonSchema>,
  fn: (s: JsonSchema) => JsonSchema,
): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(record)) out[k] = fn(v);
  return out;
}

/* ── runtime twin ────────────────────────────────────────────────────────── */

/**
 * Reads the value a JSON Pointer addresses. Missing properties, out-of-range
 * indexes and a `null` level along the way yield `ok: true` with
 * `value: undefined` (the binding's `default` applies) — `null` is absent
 * structure, not a scalar, because {@link projectSchema} admits a pointer
 * through a nullable level and reports it as `nullable`. A pointer that
 * descends into a string, number or boolean, or a non-index token applied to
 * an array, is an error, matching what `projectSchema` rejects at compile
 * time.
 */
export function projectValue(value: JsonValue, pointer: string): ProjectValueResult {
  const parsed = parsePointer(pointer);
  if (!parsed.ok) return { ok: false, reason: parsed.message };
  let current: JsonValue | undefined = value;
  let consumed = "";
  for (const token of parsed.tokens) {
    if (current === undefined || current === null) return { ok: true, value: undefined };
    if (Array.isArray(current)) {
      if (!isArrayIndexToken(token))
        return { ok: false, reason: `'${token}' is not an array index at '${consumed || "/"}'` };
      current = current[Number(token)];
    } else if (typeof current === "object" && current !== null) {
      current = Object.prototype.hasOwnProperty.call(current, token) ? current[token] : undefined;
    } else {
      return {
        ok: false,
        reason: `cannot index '${token}' into ${typeof current} at '${consumed || "/"}'`,
      };
    }
    consumed = consumed + "/" + token.replace(/~/g, "~0").replace(/\//g, "~1");
  }
  return { ok: true, value: current };
}
