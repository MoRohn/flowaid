/**
 * FlowExpr structural typer (ARCHITECTURE.md §2.3).
 *
 * Types are a small JSON-Schema-ish model ({@link ExprType}): the six JSON
 * kinds, arrays with an item type, objects with property types, unions and
 * `unknown`. Reference schemas come from a {@link TypeEnv}; `undefined` means
 * untyped and yields `unknown`. Inference is total: it never throws, and it
 * reports four kinds of issues the compiler maps to diagnostics —
 * `type` (a contradiction, `E_EXPR_TYPE`), `untyped` (an operand whose
 * type could not be determined, `W_EXPR_UNTYPED`), `regex_dynamic` (the
 * pattern or flags of `matches`/`regex_test`/`regex_match` is not a string
 * literal, `E_EXPR_REGEX_DYNAMIC`) and `regex_unsafe` (a literal pattern
 * `recheck` could not prove linear, `E_EXPR_REGEX_UNSAFE`; an unparseable
 * literal is a `type` contradiction). Whether the final type is boolean
 * (`E_EXPR_NOT_BOOLEAN` for `when`/`exitWhen`) is the caller's check on
 * `result.type`.
 *
 * Nullable receivers: optional properties, `first`/`last`, `arr[i]` and
 * `sort(…)[0]` all yield `T | null`. A member or index access on such a
 * union is not a contradiction: the `null` members are skipped (the result
 * gains `| null`, mirroring the runtime's "member of null is a failure, like
 * division by zero") and a contradiction is reported only when *no* member
 * supports the access.
 *
 * Equality: `==` / `!=` on two typed operands whose kind sets are disjoint
 * (after `integer ⊆ number`), or whose literal value sets (literals, `enum`,
 * `const`) are disjoint, is a contradiction — the most common TypeSafe
 * choice-key mistake (`n.category == 'biling'`). A comparison against the
 * `null` literal is exempt: a reference path projects an optional property
 * to its declared schema without `| null`, so the typer cannot tell a
 * never-null value from an optional one, and `x == null` is the idiomatic
 * presence check.
 *
 * Depth: an AST taller than {@link MAX_EXPR_DEPTH} yields exactly one `type`
 * issue carrying {@link EXPRESSION_TOO_DEEP_MESSAGE} (the parser's and the
 * evaluator's message) and the `unknown` type; nothing else is reported for
 * that expression, so ancestors do not cascade `untyped` warnings.
 */
import type { ExprAst, Ref } from "../bindings.js";
import type { JsonPrimitive, JsonSchema } from "../json.js";
import {
  EXPRESSION_TOO_DEEP_MESSAGE,
  FUNCTION_SIGNATURES,
  MAX_EXPR_DEPTH,
  REGEX_FUNCTIONS,
  isExpressionFunction,
  type ExpressionFunctionName,
} from "./functions.js";
import { checkRegexLiteral, literalString } from "./regex.js";

/** Static typing environment: the schema of each reference (`undefined` = untyped). */
export interface TypeEnv {
  schemaOf(ref: Ref): JsonSchema | undefined;
}

/** The typer's type model. Unions are flat, contain at least two members and never contain `unknown`. */
export type ExprType =
  | { kind: "unknown" }
  | { kind: "null" }
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean }
  | { kind: "string" }
  | { kind: "array"; items: ExprType }
  | {
      kind: "object";
      properties: Record<string, ExprType>;
      required: string[];
      additional: ExprType | null;
    }
  | { kind: "union"; members: ExprType[] };

/**
 * An inference issue: `type` is a contradiction (`E_EXPR_TYPE`), `untyped` an
 * operand of unknown type (`W_EXPR_UNTYPED`), `regex_dynamic` a regex pattern
 * or flags operand that is not a string literal (`E_EXPR_REGEX_DYNAMIC`),
 * `regex_unsafe` a literal pattern that may backtrack in super-linear time
 * (`E_EXPR_REGEX_UNSAFE`).
 */
export interface TypeIssue {
  code: "type" | "untyped" | "regex_dynamic" | "regex_unsafe";
  message: string;
  /** JSON-Pointer-like path of the offending node inside the AST (`""` = root, `"/args/1/body"` …). */
  path: string;
}

/** Result of {@link inferExprType}. */
export interface TypeResult {
  type: ExprType;
  /** `type` rendered as JSON Schema (for `CompiledBinding.schema`). */
  schema: JsonSchema;
  issues: TypeIssue[];
}

/** Result of {@link inferExprType} in the contract's coarse form: a schema, or `unknown` when it could not be determined. */
export type InferredType = { kind: "schema"; schema: JsonSchema } | { kind: "unknown" };

export const UNKNOWN: ExprType = { kind: "unknown" };
export const NULL: ExprType = { kind: "null" };
export const BOOLEAN: ExprType = { kind: "boolean" };
export const NUMBER: ExprType = { kind: "number", integer: false };
export const INTEGER: ExprType = { kind: "number", integer: true };
export const STRING: ExprType = { kind: "string" };

/** An array type. */
export function arrayOf(items: ExprType): ExprType {
  return { kind: "array", items };
}

/** A closed object type whose properties are all required. */
export function objectOf(
  properties: Record<string, ExprType>,
  options?: { required?: string[]; additional?: ExprType | null },
): ExprType {
  return {
    kind: "object",
    properties,
    required: options?.required ?? Object.keys(properties),
    additional: options?.additional === undefined ? null : options.additional,
  };
}

/** Structural type equality. */
export function sameType(a: ExprType, b: ExprType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "unknown":
    case "null":
    case "boolean":
    case "string":
      return true;
    case "number":
      return b.kind === "number" && a.integer === b.integer;
    case "array":
      return b.kind === "array" && sameType(a.items, b.items);
    case "object": {
      if (b.kind !== "object") return false;
      const ka = Object.keys(a.properties).sort();
      const kb = Object.keys(b.properties).sort();
      if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
      for (const k of ka) {
        const pa = a.properties[k];
        const pb = b.properties[k];
        if (pa === undefined || pb === undefined || !sameType(pa, pb)) return false;
      }
      if ([...a.required].sort().join("\0") !== [...b.required].sort().join("\0")) return false;
      if (a.additional === null || b.additional === null) return a.additional === b.additional;
      return sameType(a.additional, b.additional);
    }
    case "union":
      return (
        b.kind === "union" &&
        a.members.length === b.members.length &&
        a.members.every((m) => b.members.some((n) => sameType(m, n)))
      );
  }
}

/** Union of types: flattens nested unions, absorbs into `unknown`, merges `integer` into `number`, drops duplicates. */
export function unionOf(...types: ExprType[]): ExprType {
  const members: ExprType[] = [];
  const add = (t: ExprType): boolean => {
    if (t.kind === "unknown") return false;
    if (t.kind === "union") return t.members.every(add);
    if (!members.some((m) => sameType(m, t))) members.push(t);
    return true;
  };
  for (const t of types) if (!add(t)) return UNKNOWN;
  if (members.some((m) => m.kind === "number" && !m.integer)) {
    const filtered = members.filter((m) => !(m.kind === "number" && m.integer));
    members.length = 0;
    members.push(...filtered);
  }
  const first = members[0];
  if (first === undefined) return UNKNOWN;
  return members.length === 1 ? first : { kind: "union", members };
}

/** The members of `t` (itself when not a union). */
export function membersOf(t: ExprType): ExprType[] {
  return t.kind === "union" ? t.members : [t];
}

/** Human-readable rendering of a type. */
export function formatType(t: ExprType): string {
  switch (t.kind) {
    case "unknown":
    case "null":
    case "boolean":
    case "string":
      return t.kind;
    case "number":
      return t.integer ? "integer" : "number";
    case "array":
      return `array<${formatType(t.items)}>`;
    case "object": {
      const props = Object.entries(t.properties).map(
        ([k, v]) => `${k}${t.required.includes(k) ? "" : "?"}: ${formatType(v)}`,
      );
      if (t.additional !== null) props.push(`...: ${formatType(t.additional)}`);
      return `{${props.join(", ")}}`;
    }
    case "union":
      return t.members.map(formatType).join(" | ");
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * JSON Schema ⇄ ExprType
 * ──────────────────────────────────────────────────────────────────────────── */

function typeOfPrimitive(value: JsonPrimitive): ExprType {
  if (value === null) return NULL;
  if (typeof value === "boolean") return BOOLEAN;
  if (typeof value === "number") return Number.isInteger(value) ? INTEGER : NUMBER;
  return STRING;
}

function typeOfJsonValue(value: unknown): ExprType {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return typeOfPrimitive(value);
  if (Array.isArray(value)) return arrayOf(unionOf(...value.map(typeOfJsonValue)));
  if (typeof value === "object") {
    const properties: Record<string, ExprType> = {};
    for (const [k, v] of Object.entries(value)) properties[k] = typeOfJsonValue(v);
    return objectOf(properties);
  }
  return UNKNOWN;
}

function typeOfKeyword(
  schema: JsonSchema,
  keyword: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null",
  depth: number,
): ExprType {
  switch (keyword) {
    case "null":
      return NULL;
    case "boolean":
      return BOOLEAN;
    case "number":
      return NUMBER;
    case "integer":
      return INTEGER;
    case "string":
      return STRING;
    case "array": {
      if (schema.items === false)
        return arrayOf(
          schema.prefixItems === undefined
            ? UNKNOWN
            : unionOf(...schema.prefixItems.map((s) => convert(s, depth + 1))),
        );
      const items =
        schema.items === undefined || schema.items === true
          ? UNKNOWN
          : convert(schema.items, depth + 1);
      if (schema.prefixItems === undefined) return arrayOf(items);
      return arrayOf(unionOf(items, ...schema.prefixItems.map((s) => convert(s, depth + 1))));
    }
    case "object": {
      const properties: Record<string, ExprType> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {}))
        properties[k] = convert(v, depth + 1);
      const required = (schema.required ?? []).filter((k) => k in properties);
      const additional =
        schema.additionalProperties === false
          ? null
          : schema.additionalProperties === undefined || schema.additionalProperties === true
            ? UNKNOWN
            : convert(schema.additionalProperties, depth + 1);
      return { kind: "object", properties, required, additional };
    }
  }
}

function convert(schema: JsonSchema | boolean, depth: number): ExprType {
  if (typeof schema === "boolean" || depth > MAX_EXPR_DEPTH) return UNKNOWN;
  if (schema.const !== undefined) return typeOfJsonValue(schema.const);
  if (schema.enum !== undefined) return unionOf(...schema.enum.map(typeOfPrimitive));
  if (schema.anyOf !== undefined) return unionOf(...schema.anyOf.map((s) => convert(s, depth + 1)));
  if (schema.oneOf !== undefined) return unionOf(...schema.oneOf.map((s) => convert(s, depth + 1)));
  if (schema.$ref !== undefined || schema.allOf !== undefined || schema.not !== undefined)
    return UNKNOWN;
  const type = schema.type;
  if (type === undefined) {
    if (
      schema.properties !== undefined ||
      schema.additionalProperties !== undefined ||
      schema.required !== undefined
    )
      return typeOfKeyword(schema, "object", depth);
    if (schema.items !== undefined || schema.prefixItems !== undefined)
      return typeOfKeyword(schema, "array", depth);
    return UNKNOWN;
  }
  if (Array.isArray(type)) return unionOf(...type.map((t) => typeOfKeyword(schema, t, depth)));
  return typeOfKeyword(schema, type, depth);
}

/** Converts a JSON Schema to the typer's model. Undecidable keywords (`$ref`, `allOf`, `not`, boolean schemas) yield `unknown`. */
export function typeFromSchema(schema: JsonSchema): ExprType {
  return convert(schema, 0);
}

/** Renders a type as a JSON Schema (`unknown` ⇒ `{}`, unions ⇒ `anyOf`). */
export function schemaFromType(type: ExprType): JsonSchema {
  switch (type.kind) {
    case "unknown":
      return {};
    case "null":
      return { type: "null" };
    case "boolean":
      return { type: "boolean" };
    case "string":
      return { type: "string" };
    case "number":
      return { type: type.integer ? "integer" : "number" };
    case "array":
      return type.items.kind === "unknown"
        ? { type: "array" }
        : { type: "array", items: schemaFromType(type.items) };
    case "object": {
      const properties: Record<string, JsonSchema> = {};
      for (const [k, v] of Object.entries(type.properties)) properties[k] = schemaFromType(v);
      const schema: JsonSchema = { type: "object", properties };
      if (type.required.length > 0) schema.required = [...type.required];
      if (type.additional === null) schema.additionalProperties = false;
      else if (type.additional.kind !== "unknown")
        schema.additionalProperties = schemaFromType(type.additional);
      return schema;
    }
    case "union":
      return { anyOf: type.members.map(schemaFromType) };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Inference
 * ──────────────────────────────────────────────────────────────────────────── */

interface Env {
  readonly name: string;
  readonly type: ExprType;
  readonly parent: Env | undefined;
}
function lookup(env: Env | undefined, name: string): ExprType | undefined {
  for (let e = env; e !== undefined; e = e.parent) if (e.name === name) return e.type;
  return undefined;
}

type Kind = Exclude<ExprType["kind"], "unknown" | "union">;

/** Does every member of `actual` have one of `kinds`? `unknown` ⇒ `'unknown'`. */
function fits(actual: ExprType, kinds: readonly Kind[]): boolean | "unknown" {
  if (actual.kind === "unknown") return "unknown";
  return membersOf(actual).every(
    (m) => m.kind !== "unknown" && m.kind !== "union" && kinds.includes(m.kind),
  );
}

/** Is the type possibly (some member) one of `kinds`? */
function mayBe(actual: ExprType, kinds: readonly Kind[]): boolean {
  return (
    actual.kind === "unknown" ||
    membersOf(actual).some(
      (m) => m.kind !== "unknown" && m.kind !== "union" && kinds.includes(m.kind),
    )
  );
}

function describeKinds(kinds: readonly Kind[]): string {
  return kinds.join(" or ");
}

class Typer {
  readonly issues: TypeIssue[] = [];
  private depth = 0;
  /** Set once the depth limit has been reported: every later issue would be a consequence of that one cut-off and is dropped. */
  tooDeep = false;

  constructor(private readonly env: TypeEnv) {}

  private issue(code: TypeIssue["code"], path: string, message: string): void {
    if (this.tooDeep) return;
    this.issues.push({ code, message, path });
  }

  /**
   * Checks `actual` against the accepted kinds at `path`. Reports a contradiction
   * when no member fits, an `untyped` warning when the type is unknown, and
   * returns whether the operand is well-typed.
   */
  private expect(actual: ExprType, kinds: readonly Kind[], path: string, what: string): boolean {
    const result = fits(actual, kinds);
    if (result === "unknown") {
      this.issue("untyped", path, `${what} has unknown type`);
      return false;
    }
    if (!result) {
      this.issue(
        "type",
        path,
        `${what}: expected ${describeKinds(kinds)}, got ${formatType(actual)}`,
      );
      return false;
    }
    return true;
  }

  infer(ast: ExprAst, env: Env | undefined, path: string): ExprType {
    if (this.tooDeep) return UNKNOWN;
    this.depth += 1;
    try {
      if (this.depth > MAX_EXPR_DEPTH) {
        this.issue("type", path, EXPRESSION_TOO_DEEP_MESSAGE);
        this.tooDeep = true;
        return UNKNOWN;
      }
      return this.inferNode(ast, env, path);
    } finally {
      this.depth -= 1;
    }
  }

  private inferNode(ast: ExprAst, env: Env | undefined, path: string): ExprType {
    switch (ast.kind) {
      case "literal":
        return typeOfPrimitive(ast.value);
      case "ref": {
        const schema = this.env.schemaOf(ast.ref);
        return schema === undefined ? UNKNOWN : typeFromSchema(schema);
      }
      case "ident": {
        const type = lookup(env, ast.name);
        if (type === undefined) {
          this.issue("type", path, `unknown identifier '${ast.name}'`);
          return UNKNOWN;
        }
        return type;
      }
      case "unary": {
        const operand = this.infer(ast.operand, env, `${path}/operand`);
        if (ast.op === "!") {
          this.expect(operand, ["boolean"], `${path}/operand`, "operand of '!'");
          return BOOLEAN;
        }
        return this.expect(operand, ["number"], `${path}/operand`, "operand of '-'")
          ? operand
          : NUMBER;
      }
      case "binary":
        return this.inferBinary(ast, env, path);
      case "ternary": {
        const test = this.infer(ast.test, env, `${path}/test`);
        this.expect(test, ["boolean"], `${path}/test`, "conditional test");
        return unionOf(
          this.infer(ast.then, env, `${path}/then`),
          this.infer(ast.else, env, `${path}/else`),
        );
      }
      case "member":
        return this.inferMember(this.infer(ast.object, env, `${path}/object`), ast.key, path);
      case "index": {
        const object = this.infer(ast.object, env, `${path}/object`);
        const index = this.infer(ast.index, env, `${path}/index`);
        return this.inferIndex(object, index, path);
      }
      case "call":
        return this.inferCall(ast, env, path);
      case "lambda":
        this.issue("type", path, "a lambda is not a value");
        return UNKNOWN;
      case "array":
        return arrayOf(
          unionOf(...ast.items.map((item, i) => this.infer(item, env, `${path}/items/${i}`))),
        );
      case "object": {
        const properties: Record<string, ExprType> = {};
        ast.entries.forEach((entry, i) => {
          properties[entry.key] = this.infer(entry.value, env, `${path}/entries/${i}/value`);
        });
        return objectOf(properties);
      }
    }
  }

  /**
   * A property or index access over every member of `object`. `resolve`
   * returns the member's result type, or a message when that member cannot
   * be accessed that way. When at least one member supports the access the
   * `null` members are skipped and the result gains `| null`; members that
   * fail at runtime contribute nothing (the access is a runtime failure on
   * them, like division by zero). When no member supports the access every
   * member's message is a contradiction and the result is `unknown`.
   */
  private access(
    object: ExprType,
    path: string,
    resolve: (member: ExprType) => ExprType | string,
  ): ExprType {
    if (object.kind === "unknown") return UNKNOWN;
    const supported: ExprType[] = [];
    const failures: string[] = [];
    let nullable = false;
    for (const m of membersOf(object)) {
      const outcome = resolve(m);
      if (typeof outcome !== "string") {
        supported.push(outcome);
      } else {
        if (m.kind === "null") nullable = true;
        failures.push(outcome);
      }
    }
    if (supported.length === 0) {
      for (const message of failures) this.issue("type", path, message);
      return UNKNOWN;
    }
    return nullable ? unionOf(...supported, NULL) : unionOf(...supported);
  }

  private inferMember(object: ExprType, key: string, path: string): ExprType {
    return this.access(object, path, (m) => {
      if (m.kind === "object") {
        const prop = m.properties[key];
        if (prop !== undefined) return m.required.includes(key) ? prop : unionOf(prop, NULL);
        if (m.additional === null) {
          this.issue("type", path, `property '${key}' does not exist on ${formatType(m)}`);
          return NULL;
        }
        return unionOf(m.additional, NULL);
      }
      if (m.kind === "array" && /^(0|[1-9][0-9]*)$/.test(key)) return unionOf(m.items, NULL);
      return `cannot read property '${key}' of ${formatType(m)}`;
    });
  }

  private inferIndex(object: ExprType, index: ExprType, path: string): ExprType {
    if (index.kind === "string") return this.inferMemberByDynamicKey(object, path);
    if (object.kind === "unknown") {
      this.expect(index, ["number", "string"], `${path}/index`, "index");
      return UNKNOWN;
    }
    if (index.kind === "unknown") {
      this.issue("untyped", `${path}/index`, "index has unknown type");
      return this.indexResult(object, path);
    }
    if (!this.expect(index, ["number", "string"], `${path}/index`, "index")) return UNKNOWN;
    if (fits(index, ["number"]) === true) return this.indexResult(object, path);
    return unionOf(this.indexResult(object, path), this.inferMemberByDynamicKey(object, path));
  }

  private indexResult(object: ExprType, path: string): ExprType {
    return this.access(object, path, (m) =>
      m.kind === "array" ? unionOf(m.items, NULL) : `cannot index ${formatType(m)} with a number`,
    );
  }

  private inferMemberByDynamicKey(object: ExprType, path: string): ExprType {
    return this.access(object, path, (m) =>
      m.kind === "object"
        ? unionOf(...Object.values(m.properties), m.additional ?? NULL, NULL)
        : `cannot index ${formatType(m)} with a string`,
    );
  }

  private inferBinary(
    ast: Extract<ExprAst, { kind: "binary" }>,
    env: Env | undefined,
    path: string,
  ): ExprType {
    const left = this.infer(ast.left, env, `${path}/left`);
    const right = this.infer(ast.right, env, `${path}/right`);
    const lp = `${path}/left`;
    const rp = `${path}/right`;
    const opName = `operand of '${ast.op}'`;
    switch (ast.op) {
      case "&&":
      case "||":
        this.expect(left, ["boolean"], lp, opName);
        this.expect(right, ["boolean"], rp, opName);
        return BOOLEAN;
      case "==":
      case "!=":
        this.checkEquality(ast, left, right, rp);
        return BOOLEAN;
      case "<":
      case "<=":
      case ">":
      case ">=":
        this.expectSameFamily(left, right, lp, rp, ast.op);
        return BOOLEAN;
      case "in": {
        if (right.kind !== "unknown") {
          this.expect(right, ["array", "string", "object"], rp, opName);
          if (fits(right, ["string", "object"]) === true)
            this.expect(left, ["string"], lp, "left operand of 'in' (key or substring)");
        } else {
          this.issue("untyped", rp, `${opName} has unknown type`);
        }
        return BOOLEAN;
      }
      case "matches":
        this.expect(left, ["string"], lp, opName);
        this.expect(right, ["string"], rp, opName);
        this.checkRegexOperands("operator 'matches'", ast.right, rp, undefined, rp);
        return BOOLEAN;
      case "+": {
        const ok = this.expectSameFamily(left, right, lp, rp, "+");
        if (!ok) return UNKNOWN;
        if (fits(left, ["string"]) === true) return STRING;
        return arithmetic(left, right, false);
      }
      case "-":
      case "*":
      case "%": {
        const okL = this.expect(left, ["number"], lp, opName);
        const okR = this.expect(right, ["number"], rp, opName);
        return okL && okR ? arithmetic(left, right, false) : NUMBER;
      }
      case "/":
        this.expect(left, ["number"], lp, opName);
        this.expect(right, ["number"], rp, opName);
        return NUMBER;
    }
  }

  /**
   * Flags an equality that can never hold: both operands typed and their
   * literal value sets (a literal, an `enum` or a `const` reference) or,
   * failing those, their kind sets (`integer ⊆ number`) disjoint. Reported
   * at the right operand. `unknown` on either side stays silent, and so does
   * a comparison against the `null` literal (see the module comment).
   */
  private checkEquality(
    ast: Extract<ExprAst, { kind: "binary" }>,
    left: ExprType,
    right: ExprType,
    rp: string,
  ): void {
    if (left.kind === "unknown" || right.kind === "unknown") return;
    if (isNullLiteral(ast.left) || isNullLiteral(ast.right)) return;
    const never = ast.op === "==" ? "'==' can never be true" : "'!=' is always true";
    const leftValues = this.literalsOf(ast.left);
    const rightValues = this.literalsOf(ast.right);
    if (leftValues !== undefined && rightValues !== undefined) {
      if (leftValues.some((v) => rightValues.includes(v))) return;
      if (ast.left.kind === "literal")
        this.issue(
          "type",
          rp,
          `${showValues(leftValues)} is not one of ${showValues(rightValues, true)}`,
        );
      else if (ast.right.kind === "literal")
        this.issue(
          "type",
          rp,
          `${showValues(rightValues)} is not one of ${showValues(leftValues, true)}`,
        );
      else
        this.issue(
          "type",
          rp,
          `${never}: ${showValues(leftValues, true)} vs ${showValues(rightValues, true)}`,
        );
      return;
    }
    const leftKinds = kindsOf(left);
    if (!kindsOf(right).some((k) => leftKinds.includes(k)))
      this.issue("type", rp, `${never}: ${formatType(left)} vs ${formatType(right)}`);
  }

  /** The values `ast` can evaluate to when they are enumerable: a literal, or a reference whose schema is an `enum` or a primitive `const`. */
  private literalsOf(ast: ExprAst): JsonPrimitive[] | undefined {
    if (ast.kind === "literal") return [ast.value];
    if (ast.kind !== "ref") return undefined;
    const schema = this.env.schemaOf(ast.ref);
    if (schema === undefined) return undefined;
    if (schema.enum !== undefined)
      return schema.enum.every(isJsonPrimitive) ? schema.enum : undefined;
    if (schema.const !== undefined && isJsonPrimitive(schema.const)) return [schema.const];
    return undefined;
  }

  /** Both operands numbers or both strings (for `+` and ordering). Returns whether both were typed and compatible. */
  private expectSameFamily(
    left: ExprType,
    right: ExprType,
    lp: string,
    rp: string,
    op: string,
  ): boolean {
    const what = `operand of '${op}'`;
    const okL = this.expect(left, ["number", "string"], lp, what);
    const okR = this.expect(right, ["number", "string"], rp, what);
    if (!okL || !okR) return false;
    const leftNum = fits(left, ["number"]) === true;
    const leftStr = fits(left, ["string"]) === true;
    const rightNum = fits(right, ["number"]) === true;
    const rightStr = fits(right, ["string"]) === true;
    if (
      (leftNum && rightStr) ||
      (leftStr && rightNum) ||
      (leftNum && !rightNum && !mayBe(right, ["number"])) ||
      (leftStr && !rightStr && !mayBe(right, ["string"]))
    ) {
      this.issue(
        "type",
        rp,
        `'${op}': operands must both be numbers or both be strings, got ${formatType(left)} and ${formatType(right)}`,
      );
      return false;
    }
    return true;
  }

  private inferCall(
    ast: Extract<ExprAst, { kind: "call" }>,
    env: Env | undefined,
    path: string,
  ): ExprType {
    const fn = ast.fn;
    if (!isExpressionFunction(fn)) {
      this.issue("type", path, `unknown function '${fn}'`);
      return UNKNOWN;
    }
    const signature = FUNCTION_SIGNATURES[fn];
    if (ast.args.length < signature.minArgs || ast.args.length > signature.maxArgs) {
      this.issue("type", path, `${fn}: wrong number of arguments (${ast.args.length})`);
      return UNKNOWN;
    }
    const args: ExprType[] = [];
    const paths: string[] = [];
    let lambda: Extract<ExprAst, { kind: "lambda" }> | undefined = undefined;
    let lambdaPath = path;
    if (REGEX_FUNCTIONS.has(fn)) {
      const pattern = ast.args[1];
      if (pattern !== undefined)
        this.checkRegexOperands(fn, pattern, `${path}/args/1`, ast.args[2], `${path}/args/2`);
    }
    for (const [i, arg] of ast.args.entries()) {
      const argPath = `${path}/args/${i}`;
      if (arg.kind === "lambda") {
        if (signature.lambdaArg !== i)
          this.issue("type", argPath, `argument ${i + 1} of ${fn} cannot be a lambda`);
        lambda = arg;
        lambdaPath = argPath;
      } else {
        if (signature.lambdaArg === i)
          this.issue("type", argPath, `argument ${i + 1} of ${fn} must be a lambda`);
        args.push(this.infer(arg, env, argPath));
        paths.push(argPath);
      }
    }
    return this.applyType(fn, args, paths, lambda, lambdaPath, env, path);
  }

  /**
   * The pattern (and flags, when given) of `matches`, `regex_test` and
   * `regex_match` must be string literals so the pattern can be vetted here:
   * a non-literal is `regex_dynamic`, a literal that cannot be proven to match
   * in linear time `regex_unsafe`, an unparseable literal or bad flags `type`.
   */
  private checkRegexOperands(
    what: string,
    pattern: ExprAst,
    patternPath: string,
    flags: ExprAst | undefined,
    flagsPath: string,
  ): void {
    const source = literalString(pattern);
    if (source === undefined) {
      this.issue("regex_dynamic", patternPath, `pattern of ${what} must be a string literal`);
      return;
    }
    let flagsText = "";
    if (flags !== undefined) {
      const text = literalString(flags);
      if (text === undefined) {
        this.issue("regex_dynamic", flagsPath, `flags of ${what} must be a string literal`);
        return;
      }
      flagsText = text;
    }
    const check = checkRegexLiteral(source, flagsText);
    if (check.ok) return;
    if (check.problem === "unsafe")
      this.issue("regex_unsafe", patternPath, `${what}: ${check.message}`);
    else
      this.issue(
        "type",
        check.problem === "flags" ? flagsPath : patternPath,
        `${what}: ${check.message}`,
      );
  }

  private applyType(
    fn: ExpressionFunctionName,
    args: ExprType[],
    paths: string[],
    lambda: Extract<ExprAst, { kind: "lambda" }> | undefined,
    lambdaPath: string,
    env: Env | undefined,
    path: string,
  ): ExprType {
    const a0 = args[0] ?? UNKNOWN;
    const a1 = args[1] ?? UNKNOWN;
    const p0 = paths[0] ?? path;
    const p1 = paths[1] ?? path;
    const check = (t: ExprType, kinds: readonly Kind[], p: string, what: string): boolean =>
      this.expect(t, kinds, p, what);
    switch (fn) {
      case "len":
        check(a0, ["string", "array", "object"], p0, "argument of len");
        return INTEGER;
      case "lower":
      case "upper":
      case "trim":
        check(a0, ["string"], p0, `argument of ${fn}`);
        return STRING;
      case "contains": {
        if (
          check(a0, ["string", "array"], p0, "argument 1 of contains") &&
          fits(a0, ["string"]) === true
        )
          check(a1, ["string"], p1, "argument 2 of contains");
        return BOOLEAN;
      }
      case "starts_with":
      case "ends_with":
        check(a0, ["string"], p0, `argument 1 of ${fn}`);
        check(a1, ["string"], p1, `argument 2 of ${fn}`);
        return BOOLEAN;
      case "split":
        check(a0, ["string"], p0, "argument 1 of split");
        check(a1, ["string"], p1, "argument 2 of split");
        return arrayOf(STRING);
      case "join":
        check(a0, ["array"], p0, "argument 1 of join");
        if (args.length > 1) check(a1, ["string"], p1, "argument 2 of join");
        return STRING;
      case "json":
        return STRING;
      case "parse_json":
        check(a0, ["string"], p0, "argument of parse_json");
        return UNKNOWN;
      case "keys":
        check(a0, ["object"], p0, "argument of keys");
        return arrayOf(STRING);
      case "values": {
        if (!check(a0, ["object"], p0, "argument of values")) return arrayOf(UNKNOWN);
        return arrayOf(
          unionOf(
            ...membersOf(a0).flatMap((m) =>
              m.kind === "object"
                ? [...Object.values(m.properties), m.additional ?? NULL]
                : [UNKNOWN],
            ),
          ),
        );
      }
      case "has": {
        if (check(a0, ["object", "array"], p0, "argument 1 of has")) {
          if (fits(a0, ["object"]) === true) check(a1, ["string"], p1, "argument 2 of has");
          else if (fits(a0, ["array"]) === true) check(a1, ["number"], p1, "argument 2 of has");
        }
        return BOOLEAN;
      }
      case "get":
        check(a1, ["string"], p1, "argument 2 of get (pointer)");
        return UNKNOWN;
      case "coalesce":
        return unionOf(...args.map((t, i) => (i === args.length - 1 ? t : withoutNull(t))));
      case "min":
      case "max": {
        if (args.length === 1 && fits(a0, ["array"]) === true) {
          const items = unionOf(
            ...membersOf(a0).map((m) => (m.kind === "array" ? m.items : UNKNOWN)),
          );
          check(items, ["number"], p0, `elements of ${fn}`);
          return unionOf(items.kind === "unknown" ? NUMBER : items, NULL);
        }
        const ok = args.map((t, i) =>
          check(t, ["number"], paths[i] ?? path, `argument ${i + 1} of ${fn}`),
        );
        return ok.every(Boolean) && args.every((t) => fits(t, ["number"]) === true)
          ? unionOf(...args)
          : NUMBER;
      }
      case "abs":
        return check(a0, ["number"], p0, "argument of abs") ? a0 : NUMBER;
      case "round":
        check(a0, ["number"], p0, "argument 1 of round");
        if (args.length > 1) check(a1, ["number"], p1, "argument 2 of round");
        return args.length > 1 ? NUMBER : INTEGER;
      case "floor":
      case "ceil":
        check(a0, ["number"], p0, `argument of ${fn}`);
        return INTEGER;
      case "sum":
      case "avg": {
        if (check(a0, ["array"], p0, `argument of ${fn}`)) {
          const items = unionOf(
            ...membersOf(a0).map((m) => (m.kind === "array" ? m.items : UNKNOWN)),
          );
          check(items, ["number"], p0, `elements of ${fn}`);
          if (fn === "sum") return fits(items, ["number"]) === true ? items : NUMBER;
        }
        return fn === "sum" ? NUMBER : unionOf(NUMBER, NULL);
      }
      case "concat": {
        const items = args.map((t, i) =>
          check(t, ["array"], paths[i] ?? path, `argument ${i + 1} of concat`)
            ? unionOf(...membersOf(t).map((m) => (m.kind === "array" ? m.items : UNKNOWN)))
            : UNKNOWN,
        );
        return arrayOf(unionOf(...items));
      }
      case "first":
      case "last": {
        if (!check(a0, ["array"], p0, `argument of ${fn}`)) return UNKNOWN;
        return unionOf(...membersOf(a0).map((m) => (m.kind === "array" ? m.items : UNKNOWN)), NULL);
      }
      case "filter":
      case "map":
      case "any":
      case "all":
      case "sort": {
        const okArr = check(a0, ["array"], p0, `argument 1 of ${fn}`);
        const items = okArr
          ? unionOf(...membersOf(a0).map((m) => (m.kind === "array" ? m.items : UNKNOWN)))
          : UNKNOWN;
        let body: ExprType = UNKNOWN;
        if (lambda !== undefined) {
          body = this.infer(
            lambda.body,
            { name: lambda.param, type: items, parent: env },
            `${lambdaPath}/body`,
          );
          if (fn === "filter" || fn === "any" || fn === "all")
            check(body, ["boolean"], `${lambdaPath}/body`, `predicate of ${fn}`);
          if (fn === "sort") check(body, ["number", "string"], `${lambdaPath}/body`, "sort key");
        } else if (fn === "sort") {
          check(items, ["number", "string"], p0, "elements of sort");
        }
        switch (fn) {
          case "map":
            return arrayOf(body);
          case "filter":
          case "sort":
            return arrayOf(items);
          case "any":
          case "all":
            return BOOLEAN;
        }
      }
      case "to_number":
        check(a0, ["number", "string", "boolean"], p0, "argument of to_number");
        return NUMBER;
      case "to_string":
        return STRING;
      case "regex_test":
      case "regex_match": {
        check(a0, ["string"], p0, `argument 1 of ${fn}`);
        check(a1, ["string"], p1, `argument 2 of ${fn}`);
        if (args.length > 2)
          check(args[2] ?? UNKNOWN, ["string"], paths[2] ?? path, `argument 3 of ${fn}`);
        return fn === "regex_test" ? BOOLEAN : unionOf(arrayOf(unionOf(STRING, NULL)), NULL);
      }
      case "now":
        return STRING;
      case "format_date":
        check(a0, ["string", "number"], p0, "argument 1 of format_date");
        if (args.length > 1) check(a1, ["string"], p1, "argument 2 of format_date");
        return STRING;
    }
  }
}

/** The kinds a typed value can have, `integer` folded into `number` (the JSON kinds `==` compares by). */
function kindsOf(t: ExprType): Kind[] {
  const kinds: Kind[] = [];
  for (const m of membersOf(t))
    if (m.kind !== "unknown" && m.kind !== "union" && !kinds.includes(m.kind)) kinds.push(m.kind);
  return kinds;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

function isNullLiteral(ast: ExprAst): boolean {
  return ast.kind === "literal" && ast.value === null;
}

/** Renders literal values as they are written in FlowExpr (`1`, `"billing"`, `null`); `asSet` wraps several in brackets. */
function showValues(values: readonly JsonPrimitive[], asSet = false): string {
  const rendered = values.map((v) => JSON.stringify(v));
  return asSet || rendered.length !== 1 ? `[${rendered.join(", ")}]` : (rendered[0] ?? "[]");
}

/** Numeric result of an arithmetic operator: integer only when both sides are integers. */
function arithmetic(left: ExprType, right: ExprType, division: boolean): ExprType {
  if (division) return NUMBER;
  const ints =
    fits(left, ["number"]) === true &&
    fits(right, ["number"]) === true &&
    membersOf(left).every((m) => m.kind === "number" && m.integer) &&
    membersOf(right).every((m) => m.kind === "number" && m.integer);
  return ints ? INTEGER : NUMBER;
}

/** `t` without its `null` member (`unknown` stays `unknown`). */
export function withoutNull(t: ExprType): ExprType {
  if (t.kind === "unknown") return UNKNOWN;
  const members = membersOf(t).filter((m) => m.kind !== "null");
  if (members.length === 0) return NULL;
  return unionOf(...members);
}

/** True when the type is definitely boolean (the `when` / `exitWhen` requirement). */
export function isBooleanType(t: ExprType): boolean {
  return fits(t, ["boolean"]) === true;
}

/** True when the type may be an object or array (a template hole that needs a `json`/`join_*` filter). */
export function mayBeContainer(t: ExprType): boolean {
  return t.kind !== "unknown" && mayBe(t, ["object", "array"]);
}

/**
 * Infers the static type of `ast` given the schemas of the references it uses.
 * Never throws. `issues` lists contradictions (`type`) and unknown-typed
 * operands (`untyped`); `schema` is `type` rendered as JSON Schema.
 */
export function inferExprType(ast: ExprAst, scopeTypes: TypeEnv): TypeResult {
  const typer = new Typer(scopeTypes);
  const inferred = typer.infer(ast, undefined, "");
  const type = typer.tooDeep ? UNKNOWN : inferred;
  return { type, schema: schemaFromType(type), issues: typer.issues };
}

/** Contract-shaped view of {@link inferExprType}: a schema, or `unknown` when nothing is known. */
export function inferExprSchema(ast: ExprAst, scopeTypes: TypeEnv): InferredType {
  const { type } = inferExprType(ast, scopeTypes);
  return type.kind === "unknown"
    ? { kind: "unknown" }
    : { kind: "schema", schema: schemaFromType(type) };
}
