/**
 * Conservative JSON Schema subset check — `isSubschema(S, T)`
 * (ARCHITECTURE.md §4.5, CONTRACTS.ts §13).
 *
 * "Is every value valid under `S` also valid under `T`?" answered over
 * normalised schemas (see `./normalize.ts`). The check is sound where it is
 * decidable and never blocks an author on what it cannot decide:
 *
 * - `T` unconstrained ⇒ ok. `S` unconstrained into a constrained `T` ⇒ ok
 *   with `verified: false` (`W_TYPE_UNVERIFIED`; the runtime validates on
 *   delivery).
 * - type sets (`integer ⊆ number`), literal sets, numeric intervals and
 *   `multipleOf`, string length bounds, arrays (`items`, positional
 *   `prefixItems`, bounds, `uniqueItems`), objects (`required`,
 *   `properties`, `additionalProperties`) and `anyOf`/`oneOf` on either side
 *   are checked structurally. A flat source into a disjunction target is
 *   sliced by literal (or by effective type) and every slice must fit some
 *   alternative (`oneOf`: and be disjoint from the others).
 * - A handled keyword whose value has an unexpected shape (draft-4 boolean
 *   `exclusiveMinimum`, draft-7 array `items`, a string `minimum`, …) ⇒
 *   unverified.
 * - `pattern`/`format` must be equal or absent on `T`; differing ⇒ unverified.
 * - `not`, `if`/`then`/`else`, `patternProperties`, `dependentSchemas`,
 *   unknown keywords, recursive or unresolvable `$ref`s and nesting deeper
 *   than {@link MAX_DEPTH} ⇒ unverified.
 *
 * A failure carries a human-readable `reason` and a `path`: a JSON Pointer in
 * *value space* naming where the incompatible value would sit (`""` for the
 * whole value, `/name` for a property, `/0` for a positional item, `/*` for
 * "any item" or "any additional property").
 */
import { deepEqual } from "@flowaid/shared";
import type { JsonPrimitive, JsonSchema, JsonSchemaType } from "../json.js";
import {
  childContext,
  effectiveTypes,
  expandDisjunctions,
  isUnconstrained,
  literalType,
  normalize,
  rootContext,
  typeSetIncludes,
  type Bound,
  type NormalSchema,
  type SchemaContext,
} from "./normalize.js";
import { appendPointerToken } from "./pointer.js";

/** Result of {@link isSubschema}. `verified: false` means an undecidable keyword was ignored (`W_TYPE_UNVERIFIED`). */
export type SubsetResult =
  { ok: true; verified: boolean } | { ok: false; reason: string; path: string };

/** Nesting depth beyond which the check stops and reports unverified. */
export const MAX_DEPTH = 32;

/** Token used in failure paths for "any array item" / "any additional property". */
export const WILDCARD_TOKEN = "*";

const ALL_TYPES: readonly JsonSchemaType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

/** Is every value valid under `source` also valid under `target`? Undecidable keywords ⇒ ok with verified=false (W_TYPE_UNVERIFIED). */
export function isSubschema(source: JsonSchema, target: JsonSchema): SubsetResult {
  return checkRaw(source, rootContext(source), target, rootContext(target), "", 0);
}

const OK: SubsetResult = { ok: true, verified: true };
const UNVERIFIED: SubsetResult = { ok: true, verified: false };

function fail(reason: string, path: string): SubsetResult {
  return { ok: false, reason, path };
}

/** Sequences two results: a failure wins, otherwise `verified` is the conjunction. */
function both(a: SubsetResult, b: SubsetResult): SubsetResult {
  if (!a.ok) return a;
  if (!b.ok) return b;
  return a.verified && b.verified ? OK : UNVERIFIED;
}

/** Runs `check` for every element, stopping at the first failure. */
function every<T>(items: readonly T[], check: (item: T) => SubsetResult): SubsetResult {
  let acc = OK;
  for (const item of items) {
    acc = both(acc, check(item));
    if (!acc.ok) return acc;
  }
  return acc;
}

function checkRaw(
  source: JsonSchema,
  sctx: SchemaContext,
  target: JsonSchema,
  tctx: SchemaContext,
  path: string,
  depth: number,
): SubsetResult {
  if (depth > MAX_DEPTH) return UNVERIFIED;
  const s = normalize(source, sctx);
  const t = normalize(target, tctx);
  return checkNormal(s, childContext(sctx, s.refs), t, childContext(tctx, t.refs), path, depth);
}

function checkNormal(
  s: NormalSchema,
  sctx: SchemaContext,
  t: NormalSchema,
  tctx: SchemaContext,
  path: string,
  depth: number,
): SubsetResult {
  const undecidable = s.unverified.length > 0 || t.unverified.length > 0 ? UNVERIFIED : OK;

  if (isUnconstrained(t)) return undecidable;

  if (s.disjunctions.length > 0) {
    const expanded = expandDisjunctions(s, sctx);
    if (expanded === null) return UNVERIFIED;
    return both(
      undecidable,
      every(expanded.alternatives, (alt) =>
        checkNormal(alt, childContext(sctx, alt.refs), t, tctx, path, depth),
      ),
    );
  }

  if (t.disjunctions.length > 0) {
    const expanded = expandDisjunctions(t, tctx);
    if (expanded === null) return UNVERIFIED;
    // A flat source spanning several types or literals (`type: ['string', 'null']`, `enum: ['a', 'b']`) rarely
    // fits one alternative as a whole; each slice of it only has to fit some alternative.
    const slices = sliceSource(s);
    const labelled = slices.length > 1;
    return both(
      undecidable,
      every(slices, (slice) =>
        checkAgainstAlternatives(
          slice,
          sctx,
          expanded,
          tctx,
          path,
          depth,
          labelled ? describeSlice(slice) : undefined,
        ),
      ),
    );
  }

  if (isUnconstrained(s)) return UNVERIFIED;
  return both(undecidable, checkFlat(s, sctx, t, tctx, path, depth));
}

/**
 * Splits a flat source into the pieces that must each fit some target alternative:
 * one per admitted literal when the source is a literal set, otherwise one per
 * effective type. An unconstrained or single-type source is its own only slice.
 */
function sliceSource(s: NormalSchema): NormalSchema[] {
  if (isUnconstrained(s)) return [s];
  if (s.literals !== null) {
    const admitted = s.literals.filter((v) => typeSetIncludes(s.types, literalType(v)));
    return admitted.map((v) => ({ ...s, literals: [v] }));
  }
  const types = s.types === null ? ALL_TYPES : [...s.types];
  if (types.length <= 1) return [s];
  return types.map((type) => ({ ...s, types: new Set([type]) }));
}

/** How a slice is named in a failure reason (`literal "a"`, `type null`). */
function describeSlice(slice: NormalSchema): string {
  if (slice.literals !== null) return `literal ${describeLiterals(slice.literals)}`;
  return `type ${describeTypes(slice.types)}`;
}

/**
 * Is the flat source `s` a subset of some alternative of the expanded target?
 * A verified match wins; under `oneOf` the match must also be provably disjoint
 * from every other alternative, else the answer degrades to unverified.
 */
function checkAgainstAlternatives(
  s: NormalSchema,
  sctx: SchemaContext,
  expanded: { kind: "anyOf" | "oneOf"; alternatives: NormalSchema[] },
  tctx: SchemaContext,
  path: string,
  depth: number,
  label: string | undefined,
): SubsetResult {
  let bestFailure: SubsetResult | undefined;
  let unverifiedMatch = false;
  for (let i = 0; i < expanded.alternatives.length; i++) {
    const alt = expanded.alternatives[i];
    if (alt === undefined) continue;
    const result = checkNormal(s, sctx, alt, childContext(tctx, alt.refs), path, depth);
    if (!result.ok) {
      bestFailure ??= result;
      continue;
    }
    if (expanded.kind === "oneOf") {
      const others = expanded.alternatives.filter((_, j) => j !== i);
      if (!others.every((other) => isDisjoint(s, sctx, other, tctx))) {
        unverifiedMatch = true;
        continue;
      }
    }
    if (result.verified) return OK;
    unverifiedMatch = true;
  }
  if (unverifiedMatch) return UNVERIFIED;
  if (expanded.alternatives.length === 0)
    return fail("target accepts no value (empty anyOf/oneOf)", path);
  const subject = label === undefined ? "the source" : `source ${label}`;
  return fail(
    `no alternative of the target accepts ${subject} (${bestFailure !== undefined && !bestFailure.ok ? bestFailure.reason : "no alternatives"})`,
    path,
  );
}

/** Both sides flat (no disjunctions). */
function checkFlat(
  s: NormalSchema,
  sctx: SchemaContext,
  t: NormalSchema,
  tctx: SchemaContext,
  path: string,
  depth: number,
): SubsetResult {
  const sTypes = effectiveTypes(s);
  const tTypes = effectiveTypes(t);

  if (s.literals !== null) {
    const admitted = s.literals.filter((v) => typeSetIncludes(s.types, literalType(v)));
    return every(admitted, (v) => literalSatisfies(v, t, path));
  }
  if (t.literals !== null) {
    return fail(`target accepts only the literal values ${describeLiterals(t.literals)}`, path);
  }

  const sourceTypes = sTypes === null ? ALL_TYPES : [...sTypes];
  for (const type of sourceTypes) {
    if (typeSetIncludes(tTypes, type)) continue;
    if (
      type === "number" &&
      typeSetIncludes(tTypes, "integer") &&
      s.multipleOfs.some((m) => Number.isInteger(m))
    )
      continue;
    return fail(`type ${type} is not accepted by the target (${describeTypes(tTypes)})`, path);
  }

  let acc = OK;
  const has = (type: JsonSchemaType): boolean => sTypes === null || sTypes.has(type);

  if (has("number") || has("integer")) {
    const integerValued = !has("number") || s.multipleOfs.some((m) => Number.isInteger(m));
    acc = both(acc, checkNumeric(s, t, !integerValued, path));
    if (!acc.ok) return acc;
  }
  if (has("string")) {
    acc = both(acc, checkString(s, t, path));
    if (!acc.ok) return acc;
  }
  if (has("array")) {
    acc = both(acc, checkArray(s, sctx, t, tctx, path, depth));
    if (!acc.ok) return acc;
  }
  if (has("object")) {
    acc = both(acc, checkObject(s, sctx, t, tctx, path, depth));
  }
  return acc;
}

/* ── numbers ─────────────────────────────────────────────────────────────── */

/** For integer-only sources, exclusive bounds become the next inclusive integer. */
function integerLo(b: Bound | undefined): Bound | undefined {
  if (b === undefined) return undefined;
  const value = b.exclusive ? Math.floor(b.value) + 1 : Math.ceil(b.value);
  return { value, exclusive: false };
}

function integerHi(b: Bound | undefined): Bound | undefined {
  if (b === undefined) return undefined;
  const value = b.exclusive ? Math.ceil(b.value) - 1 : Math.floor(b.value);
  return { value, exclusive: false };
}

function loWithin(s: Bound | undefined, t: Bound | undefined): boolean {
  if (t === undefined) return true;
  if (s === undefined) return false;
  if (s.value > t.value) return true;
  if (s.value < t.value) return false;
  return s.exclusive || !t.exclusive;
}

function hiWithin(s: Bound | undefined, t: Bound | undefined): boolean {
  if (t === undefined) return true;
  if (s === undefined) return false;
  if (s.value < t.value) return true;
  if (s.value > t.value) return false;
  return s.exclusive || !t.exclusive;
}

function describeBound(b: Bound, kind: "minimum" | "maximum"): string {
  return `${b.exclusive ? "exclusive " : ""}${kind} ${b.value}`;
}

/** Is `n` an integral multiple of `m` (with tolerance for binary floating point)? */
function isMultiple(n: number, m: number): boolean {
  if (m === 0) return false;
  const q = n / m;
  return Math.abs(q - Math.round(q)) < 1e-9;
}

function checkNumeric(
  s: NormalSchema,
  t: NormalSchema,
  sourceHasNonIntegers: boolean,
  path: string,
): SubsetResult {
  const sLo = sourceHasNonIntegers ? s.lo : integerLo(s.lo);
  const sHi = sourceHasNonIntegers ? s.hi : integerHi(s.hi);
  const tLo = sourceHasNonIntegers ? t.lo : integerLo(t.lo);
  const tHi = sourceHasNonIntegers ? t.hi : integerHi(t.hi);

  if (
    sLo !== undefined &&
    sHi !== undefined &&
    (sLo.value > sHi.value || (sLo.value === sHi.value && (sLo.exclusive || sHi.exclusive)))
  ) {
    return OK; // empty interval: no source value exists
  }
  if (!loWithin(sLo, tLo) && tLo !== undefined) {
    return fail(
      sLo === undefined
        ? `source has no minimum but the target requires ${describeBound(tLo, "minimum")}`
        : `source ${describeBound(sLo, "minimum")} is below target ${describeBound(tLo, "minimum")}`,
      path,
    );
  }
  if (!hiWithin(sHi, tHi) && tHi !== undefined) {
    return fail(
      sHi === undefined
        ? `source has no maximum but the target requires ${describeBound(tHi, "maximum")}`
        : `source ${describeBound(sHi, "maximum")} is above target ${describeBound(tHi, "maximum")}`,
      path,
    );
  }
  for (const m of t.multipleOfs) {
    const satisfied =
      s.multipleOfs.some((n) => isMultiple(n, m)) || (!sourceHasNonIntegers && isMultiple(1, m));
    if (!satisfied) return fail(`source is not constrained to multiples of ${m}`, path);
  }
  return OK;
}

/* ── strings ─────────────────────────────────────────────────────────────── */

function checkString(s: NormalSchema, t: NormalSchema, path: string): SubsetResult {
  if (t.minLength !== undefined && (s.minLength === undefined || s.minLength < t.minLength)) {
    return fail(
      `source minLength ${s.minLength ?? "unbounded"} is below target minLength ${t.minLength}`,
      path,
    );
  }
  if (t.maxLength !== undefined && (s.maxLength === undefined || s.maxLength > t.maxLength)) {
    return fail(
      `source maxLength ${s.maxLength ?? "unbounded"} is above target maxLength ${t.maxLength}`,
      path,
    );
  }
  const patternsCovered = t.patterns.every((p) => s.patterns.includes(p));
  const formatsCovered = t.formats.every((f) => s.formats.includes(f));
  return patternsCovered && formatsCovered ? OK : UNVERIFIED;
}

/* ── literals ────────────────────────────────────────────────────────────── */

function describeLiterals(values: readonly JsonPrimitive[]): string {
  const shown = values.slice(0, 5).map((v) => JSON.stringify(v));
  return `[${shown.join(", ")}${values.length > 5 ? ", …" : ""}]`;
}

function describeTypes(types: ReadonlySet<JsonSchemaType> | null): string {
  return types === null ? "any" : [...types].join(" | ");
}

/** Is the literal `v` accepted by the flat target `t`? */
function literalSatisfies(v: JsonPrimitive, t: NormalSchema, path: string): SubsetResult {
  if (t.literals !== null && !t.literals.some((x) => deepEqual(x, v))) {
    return fail(
      `literal ${JSON.stringify(v)} is not among the target values ${describeLiterals(t.literals)}`,
      path,
    );
  }
  const type = literalType(v);
  if (!typeSetIncludes(t.types, type)) {
    return fail(
      `literal ${JSON.stringify(v)} (${type}) is not accepted by the target (${describeTypes(t.types)})`,
      path,
    );
  }
  if (typeof v === "number") {
    if (t.lo !== undefined && (v < t.lo.value || (v === t.lo.value && t.lo.exclusive))) {
      return fail(`literal ${v} is below target ${describeBound(t.lo, "minimum")}`, path);
    }
    if (t.hi !== undefined && (v > t.hi.value || (v === t.hi.value && t.hi.exclusive))) {
      return fail(`literal ${v} is above target ${describeBound(t.hi, "maximum")}`, path);
    }
    for (const m of t.multipleOfs) {
      if (!isMultiple(v, m)) return fail(`literal ${v} is not a multiple of ${m}`, path);
    }
    return OK;
  }
  if (typeof v === "string") {
    if (t.minLength !== undefined && v.length < t.minLength)
      return fail(
        `literal ${JSON.stringify(v)} is shorter than target minLength ${t.minLength}`,
        path,
      );
    if (t.maxLength !== undefined && v.length > t.maxLength)
      return fail(
        `literal ${JSON.stringify(v)} is longer than target maxLength ${t.maxLength}`,
        path,
      );
    let acc = t.formats.length === 0 ? OK : UNVERIFIED;
    for (const pattern of t.patterns) {
      const re = compilePattern(pattern);
      if (re === undefined) {
        acc = UNVERIFIED;
        continue;
      }
      if (!re.test(v))
        return fail(`literal ${JSON.stringify(v)} does not match target pattern ${pattern}`, path);
    }
    return acc;
  }
  return OK;
}

function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "u");
  } catch {
    try {
      return new RegExp(pattern);
    } catch {
      return undefined;
    }
  }
}

/* ── arrays ──────────────────────────────────────────────────────────────── */

/** The schema for item `i` of a flat array schema: `undefined` = anything, `false` = no such item. */
function itemAt(n: NormalSchema, i: number): JsonSchema | false | undefined {
  if (n.maxItems !== undefined && i >= n.maxItems) return false;
  const prefix = n.prefixItems[i];
  if (prefix !== undefined) return prefix;
  if (n.items === false) return false;
  if (n.items === true || n.items === undefined) return undefined;
  return n.items;
}

function checkArray(
  s: NormalSchema,
  sctx: SchemaContext,
  t: NormalSchema,
  tctx: SchemaContext,
  path: string,
  depth: number,
): SubsetResult {
  const sMin = s.minItems ?? 0;
  if (t.minItems !== undefined && sMin < t.minItems) {
    return fail(`source minItems ${sMin} is below target minItems ${t.minItems}`, path);
  }
  const sMax =
    s.items === false
      ? Math.min(s.maxItems ?? Infinity, s.prefixItems.length)
      : (s.maxItems ?? Infinity);
  if (t.maxItems !== undefined && sMax > t.maxItems) {
    return fail(
      `source maxItems ${Number.isFinite(sMax) ? sMax : "unbounded"} is above target maxItems ${t.maxItems}`,
      path,
    );
  }
  if (t.uniqueItems && !s.uniqueItems && sMax > 1) {
    return fail("target requires uniqueItems but the source allows duplicates", path);
  }

  let acc = OK;
  const positions = Math.max(s.prefixItems.length, t.prefixItems.length);
  for (let i = 0; i < positions; i++) {
    const si = itemAt(s, i);
    if (si === false) continue;
    const ti = itemAt(t, i);
    const itemPath = appendPointerToken(path, String(i));
    if (ti === false) return fail(`source allows item ${i} but the target does not`, itemPath);
    acc = both(acc, checkRaw(si ?? {}, sctx, ti ?? {}, tctx, itemPath, depth + 1));
    if (!acc.ok) return acc;
  }
  const rest = itemAt(s, positions);
  if (rest === false) return acc;
  const tRest = itemAt(t, positions);
  const restPath = appendPointerToken(path, WILDCARD_TOKEN);
  if (tRest === false)
    return fail(`source allows more than ${positions} items but the target does not`, restPath);
  return both(acc, checkRaw(rest ?? {}, sctx, tRest ?? {}, tctx, restPath, depth + 1));
}

/* ── objects ─────────────────────────────────────────────────────────────── */

/** The schema a flat object schema gives property `name`: `undefined` = anything, `false` = property not allowed. */
function propertyAt(n: NormalSchema, name: string): JsonSchema | false | undefined {
  const declared = n.properties[name];
  if (declared !== undefined) return declared;
  if (n.additionalProperties === false) return false;
  if (n.additionalProperties === undefined || n.additionalProperties === true) return undefined;
  return n.additionalProperties;
}

function checkObject(
  s: NormalSchema,
  sctx: SchemaContext,
  t: NormalSchema,
  tctx: SchemaContext,
  path: string,
  depth: number,
): SubsetResult {
  for (const name of t.required) {
    if (!s.required.has(name))
      return fail(
        `required property '${name}' may be missing in the source`,
        appendPointerToken(path, name),
      );
    if (propertyAt(s, name) === false)
      return fail(
        `required property '${name}' is forbidden by the source`,
        appendPointerToken(path, name),
      );
  }

  let acc = OK;
  const names = new Set([...Object.keys(s.properties), ...Object.keys(t.properties)]);
  for (const name of names) {
    const sp = propertyAt(s, name);
    if (sp === false) continue;
    const tp = propertyAt(t, name);
    const propertyPath = appendPointerToken(path, name);
    if (tp === false) {
      if (sp === undefined) {
        acc = UNVERIFIED; // the source only admits it as an undeclared extra; the runtime validates
        continue;
      }
      return fail(
        `property '${name}' is not allowed by the target (additionalProperties: false)`,
        propertyPath,
      );
    }
    acc = both(acc, checkRaw(sp ?? {}, sctx, tp ?? {}, tctx, propertyPath, depth + 1));
    if (!acc.ok) return acc;
  }

  const sExtra = s.additionalProperties;
  const tExtra = t.additionalProperties;
  if (sExtra === false) return acc;
  const extraPath = appendPointerToken(path, WILDCARD_TOKEN);
  if (tExtra === false) {
    if (sExtra === undefined || sExtra === true) return UNVERIFIED;
    return fail("source allows additional properties but the target does not", extraPath);
  }
  if (tExtra === undefined || tExtra === true) return acc;
  return both(
    acc,
    checkRaw(
      sExtra === undefined || sExtra === true ? {} : sExtra,
      sctx,
      tExtra,
      tctx,
      extraPath,
      depth + 1,
    ),
  );
}

/* ── disjointness (for oneOf targets) ────────────────────────────────────── */

/** Can no value satisfy both flat schemas? Conservative: `false` when unsure. */
function isDisjoint(
  a: NormalSchema,
  actx: SchemaContext,
  b: NormalSchema,
  bctx: SchemaContext,
): boolean {
  const aTypes = effectiveTypes(a);
  const bTypes = effectiveTypes(b);
  if (aTypes !== null && bTypes !== null) {
    const shared =
      [...aTypes].some((t) => typeSetIncludes(bTypes, t)) ||
      [...bTypes].some((t) => typeSetIncludes(aTypes, t));
    if (!shared) return true;
  }
  if (a.literals !== null && b.literals !== null) {
    const shared = a.literals.some((x) => (b.literals ?? []).some((y) => deepEqual(x, y)));
    if (!shared) return true;
  }
  for (const name of a.required) {
    if (!b.required.has(name)) continue;
    const ap = a.properties[name];
    const bp = b.properties[name];
    if (ap === undefined || bp === undefined) continue;
    const an = normalize(ap, actx);
    const bn = normalize(bp, bctx);
    if (
      an.literals !== null &&
      bn.literals !== null &&
      !an.literals.some((x) => (bn.literals ?? []).some((y) => deepEqual(x, y)))
    )
      return true;
    const at = effectiveTypes(an);
    const bt = effectiveTypes(bn);
    if (
      at !== null &&
      bt !== null &&
      ![...at].some((t) => typeSetIncludes(bt, t)) &&
      ![...bt].some((t) => typeSetIncludes(at, t))
    )
      return true;
  }
  return false;
}
