/**
 * FlowExpr evaluator (ARCHITECTURE.md §2.3): total and bounded.
 *
 * Budget (RFC-0003): every AST node visited costs one step (lambda bodies on
 * every invocation), and the array built-ins charge one step per element they
 * touch (`sort` n·log₂n; `join`, `in`, `contains`, `sum`, `avg`, `min`, `max`,
 * `keys`, `values`, `split`, `len` n) — {@link MAX_EVAL_STEPS} per evaluation,
 * so the bound measures work rather than AST shape. Every value the expression
 * *builds* is measured against the {@link MAX_EVAL_RESULT_BYTES} result limit
 * with an incremental, identity-cached estimator of its compact JSON length; a
 * value read through a reference is measured against the larger
 * {@link MAX_EVAL_INPUT_BYTES} input limit instead, so a large node output can
 * still be summarised (`len`, `first`, `keys`, …). AST nesting is capped at
 * {@link MAX_EXPR_DEPTH}, value nesting at {@link MAX_VALUE_DEPTH}. Regular
 * expressions are string literals vetted for linear time (`./regex.ts`).
 * Nothing escapes as a raw `TypeError` or `RangeError`: every failure is an
 * {@link ExpressionError} whose `details.reason` is one of
 * {@link EXPRESSION_ERROR_REASONS}.
 *
 * Value semantics are JSON semantics: `==`/`!=` are deep structural equality,
 * `<` … `>=` compare two numbers or two strings, `+` adds numbers or
 * concatenates strings, booleans are never coerced (`!`, `&&`, `||`, `?:`,
 * predicates demand `boolean`), a missing object key or out-of-range index
 * reads as `null`, and reading a member of `null` is an error.
 */
import { deepEqual, isJsonObject, isJsonValue } from "@flowaid/shared";
import type { EvalScope, ExprAst, Ref } from "../bindings.js";
import { formatRef } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";
import {
  EXPRESSION_TOO_DEEP_MESSAGE,
  FUNCTION_SIGNATURES,
  MAX_EXPR_DEPTH,
  REGEX_FUNCTIONS,
  isExpressionFunction,
  type ExpressionFunctionName,
} from "./functions.js";
import {
  LruCache,
  MAX_REGEX_SUBJECT_LENGTH,
  REGEX_CACHE_SIZE,
  checkRegexLiteral,
  getDefaultRegexEngine,
  literalString,
  type CompiledRegex,
  type RegexCheck,
} from "./regex.js";

/** Maximum number of steps one evaluation may take (AST nodes visited plus per-element charges of the array built-ins). */
export const MAX_EVAL_STEPS = 1_000_000;
/** Maximum size of a value an expression builds, measured as UTF-16 code units of its compact JSON encoding. */
export const MAX_EVAL_RESULT_BYTES = 1_048_576;
/** Maximum size of a value read through a reference (node output, variable, scope field), measured like {@link MAX_EVAL_RESULT_BYTES}. */
export const MAX_EVAL_INPUT_BYTES = 8_388_608;
/** Maximum nesting of a value (arrays and objects) an expression reads or builds. */
export const MAX_VALUE_DEPTH = 512;
/** The message every value-depth rejection carries. */
export const VALUE_TOO_DEEP_MESSAGE = `value nested deeper than ${MAX_VALUE_DEPTH} levels`;

/** Machine-readable failure reasons carried in `ExpressionError.details.reason`. */
export const EXPRESSION_ERROR_REASONS = [
  "STEP_LIMIT",
  "RESULT_TOO_LARGE",
  "INPUT_TOO_LARGE",
  "DEPTH_LIMIT",
  "DIVISION_BY_ZERO",
  "NOT_FINITE",
  "TYPE",
  "UNKNOWN_REF",
  "UNKNOWN_IDENT",
  "UNKNOWN_FUNCTION",
  "ARITY",
  "LAMBDA_MISUSE",
  "INVALID_REGEX",
  "INVALID_JSON",
  "INVALID_POINTER",
  "INVALID_NUMBER",
  "INVALID_DATE",
  "INVALID_ARGUMENT",
] as const;
/** One of {@link EXPRESSION_ERROR_REASONS}. */
export type ExpressionErrorReason = (typeof EXPRESSION_ERROR_REASONS)[number];

/** Builds an {@link ExpressionError} whose `details` carry the machine-readable `reason`. */
export function expressionError(
  reason: ExpressionErrorReason,
  message: string,
  extra?: JsonObject,
): ExpressionError {
  return new ExpressionError(message, { ...extra, reason });
}

/** True when `value` is one of {@link EXPRESSION_ERROR_REASONS}. */
export function isExpressionErrorReason(value: string): value is ExpressionErrorReason {
  return (EXPRESSION_ERROR_REASONS as readonly string[]).includes(value);
}

/** The `reason` of an {@link ExpressionError} built by the evaluator, or `undefined` for other errors. */
export function expressionErrorReason(error: unknown): ExpressionErrorReason | undefined {
  if (!(error instanceof ExpressionError) || !isJsonObject(error.details)) return undefined;
  const reason = error.details["reason"];
  return typeof reason === "string" && isExpressionErrorReason(reason) ? reason : undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Value helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const INT_RE = /^(0|[1-9][0-9]*)$/;
const POINTER_RE = /^(\/([^/~]|~0|~1)*)*$/;

/**
 * Shallow object test for values that are already `JsonValue`s: the deep
 * `isJsonObject` guard belongs at trust boundaries, not on every member access
 * (it walks the whole value and recurses, so a hostile input could overflow).
 */
function isObjectValue(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Human-readable JSON type name of a value. */
export function jsonTypeOf(
  value: JsonValue,
): "null" | "boolean" | "number" | "string" | "array" | "object" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

function valueTooDeep(): ExpressionError {
  return expressionError("DEPTH_LIMIT", VALUE_TOO_DEEP_MESSAGE, { limit: MAX_VALUE_DEPTH });
}

/** A `RangeError` from a recursive walk over a value is a nesting failure; everything else is rethrown as is. */
function asDepthError(error: unknown): unknown {
  return error instanceof RangeError ? valueTooDeep() : error;
}

/** `deepEqual` that reports a stack overflow on hostile nesting as `DEPTH_LIMIT`. */
function valuesEqual(a: JsonValue, b: JsonValue): boolean {
  try {
    return deepEqual(a, b);
  } catch (error) {
    throw asDepthError(error);
  }
}

/** The parsed JSON text as a `JsonValue`; a stack overflow while validating hostile nesting is `DEPTH_LIMIT`. */
function checkedJsonValue(parsed: unknown): JsonValue {
  try {
    if (isJsonValue(parsed)) return parsed;
  } catch (error) {
    throw asDepthError(error);
  }
  throw expressionError("INVALID_JSON", "parse_json: text is not a JSON value");
}

/** `JSON.stringify` that reports a stack overflow on hostile nesting as `DEPTH_LIMIT`. */
function stringifyJson(value: JsonValue): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw asDepthError(error);
  }
}

/**
 * Walks an RFC 6901 JSON Pointer through `value`. Returns `undefined` when a
 * token does not exist (missing key, non-integer or out-of-range index, scalar
 * in the middle). Throws for a syntactically invalid pointer.
 */
export function getPointer(value: JsonValue, pointer: string): JsonValue | undefined {
  if (!POINTER_RE.test(pointer))
    throw expressionError("INVALID_POINTER", `invalid JSON pointer ${JSON.stringify(pointer)}`);
  if (pointer === "") return value;
  let current: JsonValue = value;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!INT_RE.test(token)) return undefined;
      const item: JsonValue | undefined = current[Number(token)];
      if (item === undefined) return undefined;
      current = item;
    } else if (isObjectValue(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      const item: JsonValue | undefined = current[token];
      if (item === undefined) return undefined;
      current = item;
    } else {
      return undefined;
    }
  }
  return current;
}

/** Text form of a value: scalars as text (`null` → empty), containers as compact JSON. */
export function jsonToText(value: JsonValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyJson(value);
}

/** Number of Unicode code points in `text` (a surrogate pair counts once), without allocating. */
export function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
    }
    count += 1;
  }
  return count;
}

function scalarSize(value: JsonValue): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return String(value).length;
  if (typeof value === "string") return value.length + 2;
  return 0;
}

/** One open container on the estimator's explicit stack. */
interface MeasureFrame {
  readonly container: JsonValue[] | JsonObject;
  /** The object's own keys; `undefined` for an array. */
  readonly keys: readonly string[] | undefined;
  /** Next child to visit. */
  next: number;
  /** Compact-JSON length accumulated so far (brackets included). */
  total: number;
}

/** Returned by {@link SizeEstimator.nextChild} once a frame has no children left. */
const FRAME_DONE: unique symbol = Symbol("frame done");

function openFrame(container: JsonValue[] | JsonObject): MeasureFrame {
  return {
    container,
    keys: Array.isArray(container) ? undefined : Object.keys(container),
    next: 0,
    total: 2,
  };
}

/**
 * Incremental estimate of the compact-JSON length of a value. Containers are
 * cached by identity, so measuring the result of every step costs amortised
 * O(1) per element created. The walk is iterative with an explicit stack and
 * rejects values nested deeper than {@link MAX_VALUE_DEPTH} (`DEPTH_LIMIT`),
 * so no value — however hostile — can overflow the call stack.
 */
class SizeEstimator {
  private readonly cache = new WeakMap<object, number>();

  measure(value: JsonValue): number {
    if (value === null || typeof value !== "object") return scalarSize(value);
    const cached = this.cache.get(value);
    if (cached !== undefined) return cached;
    const stack: MeasureFrame[] = [openFrame(value)];
    for (;;) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) return 0;
      const child = this.nextChild(frame);
      if (child === FRAME_DONE) {
        stack.pop();
        this.cache.set(frame.container, frame.total);
        const parent = stack[stack.length - 1];
        if (parent === undefined) return frame.total;
        parent.total += frame.total;
        continue;
      }
      if (child === null || typeof child !== "object") {
        frame.total += scalarSize(child);
        continue;
      }
      const known = this.cache.get(child);
      if (known !== undefined) {
        frame.total += known;
        continue;
      }
      if (stack.length >= MAX_VALUE_DEPTH) throw valueTooDeep();
      stack.push(openFrame(child));
    }
  }

  /** Advances `frame` to its next child, adding the separator/key overhead; {@link FRAME_DONE} when exhausted. */
  private nextChild(frame: MeasureFrame): JsonValue | typeof FRAME_DONE {
    const { container } = frame;
    if (Array.isArray(container)) {
      if (frame.next >= container.length) return FRAME_DONE;
      const item: JsonValue | undefined = container[frame.next];
      frame.next += 1;
      frame.total += 1;
      if (item === undefined) {
        frame.total += 4;
        return null;
      }
      return item;
    }
    const keys = frame.keys ?? [];
    const key = keys[frame.next];
    if (key === undefined) return FRAME_DONE;
    frame.next += 1;
    frame.total += key.length + 4;
    const item: JsonValue | undefined = container[key];
    return item === undefined ? null : item;
  }
}

/** Lambda parameter environment: an immutable chain. */
interface Env {
  readonly name: string;
  readonly value: JsonValue;
  readonly parent: Env | undefined;
}

function lookup(env: Env | undefined, name: string): JsonValue | undefined {
  for (let e = env; e !== undefined; e = e.parent) if (e.name === name) return e.value;
  return undefined;
}

function typeError(what: string, value: JsonValue, expected: string): ExpressionError {
  return expressionError("TYPE", `${what}: expected ${expected}, got ${jsonTypeOf(value)}`, {
    expected,
    actual: jsonTypeOf(value),
  });
}

function expectNumber(what: string, value: JsonValue): number {
  if (typeof value !== "number") throw typeError(what, value, "number");
  return value;
}
function expectString(what: string, value: JsonValue): string {
  if (typeof value !== "string") throw typeError(what, value, "string");
  return value;
}
function expectBoolean(what: string, value: JsonValue): boolean {
  if (typeof value !== "boolean") throw typeError(what, value, "boolean");
  return value;
}
function expectArray(what: string, value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) throw typeError(what, value, "array");
  return value;
}
function expectObject(what: string, value: JsonValue): JsonObject {
  if (!isObjectValue(value)) throw typeError(what, value, "object");
  return value;
}
function finite(what: string, n: number): number {
  if (!Number.isFinite(n))
    throw expressionError("NOT_FINITE", `${what}: result is not a finite number`);
  return n;
}

/** Turns a failed {@link RegexCheck} into the runtime error the reason table prescribes. */
function regexCheckError(
  what: string,
  check: Extract<RegexCheck, { ok: false }>,
  source: string,
): ExpressionError {
  const reason: ExpressionErrorReason =
    check.problem === "flags" || check.problem === "length" ? "INVALID_ARGUMENT" : "INVALID_REGEX";
  return expressionError(reason, `${what}: ${check.message}`, {
    pattern: source,
    problem: check.problem,
  });
}

function roundTo(x: number, digits: number): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > 100) {
    throw expressionError("INVALID_ARGUMENT", "round: digits must be an integer between 0 and 100");
  }
  if (Number.isInteger(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  if (digits === 0) return sign * Math.round(abs);
  const shifted = Number(`${abs}e${digits}`);
  const rounded = Number.isFinite(shifted)
    ? Number(`${Math.round(shifted)}e-${digits}`)
    : Math.round(abs * 10 ** digits) / 10 ** digits;
  return sign * rounded;
}

function compareKeys(what: string, a: JsonValue, b: JsonValue): number {
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  throw expressionError(
    "TYPE",
    `${what}: keys must all be numbers or all be strings, got ${jsonTypeOf(a)} and ${jsonTypeOf(b)}`,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dates
 * ──────────────────────────────────────────────────────────────────────────── */

/** The date forms `format_date` accepts, as named in its `INVALID_DATE` message. */
export const ACCEPTED_DATE_FORMS = [
  "epoch milliseconds",
  "YYYY-MM-DD (UTC midnight)",
  "RFC 3339 date-time with Z or ±HH:MM",
] as const;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

function invalidDate(value: JsonValue): ExpressionError {
  return expressionError(
    "INVALID_DATE",
    `format_date: not a valid date: ${JSON.stringify(value)}; accepted forms: ${ACCEPTED_DATE_FORMS.join(", ")}`,
    { accepted: [...ACCEPTED_DATE_FORMS] },
  );
}

/** Builds a UTC instant from calendar fields, `undefined` when any field is out of range (no roll-over). */
function utcInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date | undefined {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const exact =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return exact ? date : undefined;
}

/**
 * Parses the accepted date forms independently of the process time zone:
 * a number is epoch milliseconds, `YYYY-MM-DD` is UTC midnight and an
 * RFC 3339 date-time carries its own offset. Everything else is `INVALID_DATE`.
 */
export function toDate(value: JsonValue): Date {
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw invalidDate(value);
    return date;
  }
  const text = expectString("format_date", value);
  const dateOnly = DATE_ONLY_RE.exec(text);
  if (dateOnly !== null) {
    const date = utcInstant(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      0,
      0,
      0,
      0,
    );
    if (date === undefined) throw invalidDate(value);
    return date;
  }
  const dateTime = DATE_TIME_RE.exec(text);
  if (dateTime === null) throw invalidDate(value);
  const fraction = dateTime[7] ?? "";
  const millisecond = Number(`${fraction}000`.slice(0, 3));
  const date = utcInstant(
    Number(dateTime[1]),
    Number(dateTime[2]),
    Number(dateTime[3]),
    Number(dateTime[4]),
    Number(dateTime[5]),
    Number(dateTime[6]),
    millisecond,
  );
  if (date === undefined) throw invalidDate(value);
  if (dateTime[8] === undefined) {
    const offsetHours = Number(dateTime[10]);
    const offsetMinutes = Number(dateTime[11]);
    if (offsetHours > 23 || offsetMinutes > 59) throw invalidDate(value);
    const sign = dateTime[9] === "-" ? -1 : 1;
    date.setTime(date.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000);
  }
  if (Number.isNaN(date.getTime())) throw invalidDate(value);
  return date;
}

const DATE_TOKEN_RE = /\[([^\]]*)\]|YYYY|MM|DD|HH|mm|ss|SSS/g;
/** Formats a date in UTC. Tokens: `YYYY MM DD HH mm ss SSS`; `[literal]` passes text through. */
function formatDate(date: Date, format: string | undefined): string {
  if (format === undefined) return date.toISOString();
  const pad = (n: number, w: number): string => String(n).padStart(w, "0");
  return format.replace(DATE_TOKEN_RE, (token: string, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return pad(date.getUTCFullYear(), 4);
      case "MM":
        return pad(date.getUTCMonth() + 1, 2);
      case "DD":
        return pad(date.getUTCDate(), 2);
      case "HH":
        return pad(date.getUTCHours(), 2);
      case "mm":
        return pad(date.getUTCMinutes(), 2);
      case "ss":
        return pad(date.getUTCSeconds(), 2);
      default:
        return pad(date.getUTCMilliseconds(), 3);
    }
  });
}

function parseNumber(text: string): number {
  const trimmed = text.trim();
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(trimmed)) {
    throw expressionError("INVALID_NUMBER", `to_number: not a number: ${JSON.stringify(text)}`);
  }
  return finite("to_number", Number(trimmed));
}

/** Steps `sort` charges for `n` elements: n·log₂n (comparison sorting), at least `n`. */
function sortCost(n: number): number {
  return n <= 1 ? n : Math.ceil(n * Math.log2(n));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Evaluator
 * ──────────────────────────────────────────────────────────────────────────── */

class Evaluator {
  private steps = 0;
  private depth = 0;
  private readonly sizes = new SizeEstimator();
  private readonly regexes = new LruCache<string, CompiledRegex>(REGEX_CACHE_SIZE);

  constructor(private readonly scope: EvalScope) {}

  /** Charges `n` steps against the budget. */
  private charge(n: number): void {
    this.steps += n;
    if (this.steps > MAX_EVAL_STEPS)
      throw expressionError(
        "STEP_LIMIT",
        `expression exceeded ${MAX_EVAL_STEPS} evaluation steps`,
        { limit: MAX_EVAL_STEPS },
      );
  }

  /** Charges one step and checks the nesting depth. */
  private enter(): void {
    this.charge(1);
    this.depth += 1;
    if (this.depth > MAX_EXPR_DEPTH)
      throw expressionError("DEPTH_LIMIT", EXPRESSION_TOO_DEEP_MESSAGE, { limit: MAX_EXPR_DEPTH });
  }

  /** Rejects values the expression built whose compact JSON would exceed the result limit. */
  private bounded(value: JsonValue): JsonValue {
    const size = this.sizes.measure(value);
    if (size > MAX_EVAL_RESULT_BYTES) {
      throw expressionError(
        "RESULT_TOO_LARGE",
        `expression result exceeds ${MAX_EVAL_RESULT_BYTES} bytes`,
        { limit: MAX_EVAL_RESULT_BYTES, size },
      );
    }
    return value;
  }

  /** Rejects values read through a reference whose compact JSON would exceed the input limit. */
  private boundedInput(ref: Ref, value: JsonValue): JsonValue {
    const size = this.sizes.measure(value);
    if (size > MAX_EVAL_INPUT_BYTES) {
      throw expressionError(
        "INPUT_TOO_LARGE",
        `value of '${formatRef(ref)}' exceeds ${MAX_EVAL_INPUT_BYTES} bytes`,
        { limit: MAX_EVAL_INPUT_BYTES, size, ref: formatRef(ref) },
      );
    }
    return value;
  }

  eval(ast: ExprAst, env: Env | undefined): JsonValue {
    this.enter();
    try {
      if (ast.kind === "ref") return this.boundedInput(ast.ref, this.resolve(ast.ref));
      return this.bounded(this.evalNode(ast, env));
    } finally {
      this.depth -= 1;
    }
  }

  private evalNode(ast: ExprAst, env: Env | undefined): JsonValue {
    switch (ast.kind) {
      case "literal":
        return typeof ast.value === "number" ? finite("number literal", ast.value) : ast.value;
      case "ref":
        return this.resolve(ast.ref);
      case "ident": {
        const value = lookup(env, ast.name);
        if (value === undefined)
          throw expressionError("UNKNOWN_IDENT", `unknown identifier '${ast.name}'`, {
            name: ast.name,
          });
        return value;
      }
      case "unary": {
        const operand = this.eval(ast.operand, env);
        return ast.op === "!"
          ? !expectBoolean("operator '!'", operand)
          : -expectNumber("operator '-'", operand);
      }
      case "binary":
        return this.evalBinary(ast, env);
      case "ternary":
        return expectBoolean("conditional test", this.eval(ast.test, env))
          ? this.eval(ast.then, env)
          : this.eval(ast.else, env);
      case "member":
        return this.member(this.eval(ast.object, env), ast.key);
      case "index":
        return this.index(this.eval(ast.object, env), this.eval(ast.index, env));
      case "call":
        return this.call(ast, env);
      case "lambda":
        throw expressionError(
          "LAMBDA_MISUSE",
          "a lambda is not a value; lambdas are only allowed as arguments of filter, map, any, all and sort",
        );
      case "array":
        return ast.items.map((item) => this.eval(item, env));
      case "object": {
        const out: JsonObject = {};
        for (const entry of ast.entries) {
          if (Object.prototype.hasOwnProperty.call(out, entry.key)) {
            throw expressionError(
              "INVALID_ARGUMENT",
              `duplicate key ${JSON.stringify(entry.key)} in object literal`,
              { key: entry.key },
            );
          }
          out[entry.key] = this.eval(entry.value, env);
        }
        return out;
      }
    }
  }

  private resolve(ref: Ref): JsonValue {
    const value = this.scope.resolve(ref);
    if (value === undefined)
      throw expressionError("UNKNOWN_REF", `unknown reference '${formatRef(ref)}'`, {
        ref: formatRef(ref),
      });
    return value;
  }

  private member(object: JsonValue, key: string): JsonValue {
    if (isObjectValue(object)) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) return null;
      const value: JsonValue | undefined = object[key];
      return value === undefined ? null : value;
    }
    if (Array.isArray(object)) {
      if (INT_RE.test(key)) return this.index(object, Number(key));
      throw expressionError(
        "TYPE",
        `cannot read property '${key}' of an array (expected an integer index)`,
        { key },
      );
    }
    throw expressionError("TYPE", `cannot read property '${key}' of ${jsonTypeOf(object)}`, {
      key,
      actual: jsonTypeOf(object),
    });
  }

  private index(object: JsonValue, index: JsonValue): JsonValue {
    if (typeof index === "string") return this.member(object, index);
    if (Array.isArray(object)) {
      const i = expectNumber("array index", index);
      if (!Number.isInteger(i))
        throw expressionError("TYPE", `array index must be an integer, got ${String(i)}`);
      const at = i < 0 ? object.length + i : i;
      const value: JsonValue | undefined = object[at];
      return value === undefined ? null : value;
    }
    if (isObjectValue(object))
      throw expressionError("TYPE", `object keys must be strings, got ${jsonTypeOf(index)}`);
    throw expressionError("TYPE", `cannot index ${jsonTypeOf(object)}`, {
      actual: jsonTypeOf(object),
    });
  }

  /**
   * Compiles the (vetted, literal) pattern `source` with `flags`, memoised per
   * evaluator so a pattern inside a lambda is compiled once per evaluation.
   */
  private regex(what: string, source: JsonValue, flags: JsonValue | undefined): CompiledRegex {
    const pattern = expectString(`${what}: pattern`, source);
    const f = flags === undefined ? "" : expectString(`${what}: flags`, flags);
    const check = checkRegexLiteral(pattern, f);
    if (!check.ok) throw regexCheckError(what, check, pattern);
    const key = `${f}\0${pattern}`;
    const cached = this.regexes.get(key);
    if (cached !== undefined) return cached;
    let compiled: CompiledRegex;
    try {
      compiled = getDefaultRegexEngine().compile(pattern, f);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw expressionError(
        "INVALID_REGEX",
        `${what}: the regex engine rejected the pattern: ${message}`,
        { pattern },
      );
    }
    this.regexes.set(key, compiled);
    return compiled;
  }

  /** The string a regex is run against, capped at {@link MAX_REGEX_SUBJECT_LENGTH}. */
  private regexSubject(what: string, value: JsonValue): string {
    const subject = expectString(what, value);
    if (subject.length > MAX_REGEX_SUBJECT_LENGTH) {
      throw expressionError(
        "INVALID_ARGUMENT",
        `${what}: subject is ${subject.length} characters long (limit ${MAX_REGEX_SUBJECT_LENGTH})`,
        { limit: MAX_REGEX_SUBJECT_LENGTH, length: subject.length },
      );
    }
    return subject;
  }

  /** Rejects a regex pattern (or flags) operand that is not a string literal, before it is evaluated. */
  private requireRegexLiteral(
    what: string,
    operand: ExprAst | undefined,
    role: "pattern" | "flags",
  ): void {
    if (operand !== undefined && literalString(operand) === undefined) {
      throw expressionError("INVALID_ARGUMENT", `${what}: the ${role} must be a string literal`, {
        role,
      });
    }
  }

  private evalBinary(ast: Extract<ExprAst, { kind: "binary" }>, env: Env | undefined): JsonValue {
    const opName = `operator '${ast.op}'`;
    if (ast.op === "&&")
      return expectBoolean(opName, this.eval(ast.left, env))
        ? expectBoolean(opName, this.eval(ast.right, env))
        : false;
    if (ast.op === "||")
      return expectBoolean(opName, this.eval(ast.left, env))
        ? true
        : expectBoolean(opName, this.eval(ast.right, env));
    if (ast.op === "matches") this.requireRegexLiteral(opName, ast.right, "pattern");
    const left = this.eval(ast.left, env);
    const right = this.eval(ast.right, env);
    switch (ast.op) {
      case "==":
        return valuesEqual(left, right);
      case "!=":
        return !valuesEqual(left, right);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        if (!(
          (typeof left === "number" && typeof right === "number") ||
          (typeof left === "string" && typeof right === "string")
        )) {
          throw expressionError(
            "TYPE",
            `${opName}: operands must both be numbers or both be strings, got ${jsonTypeOf(left)} and ${jsonTypeOf(right)}`,
          );
        }
        switch (ast.op) {
          case "<":
            return left < right;
          case "<=":
            return left <= right;
          case ">":
            return left > right;
          case ">=":
            return left >= right;
        }
      }
      case "in": {
        if (Array.isArray(right)) {
          this.charge(right.length);
          return right.some((item) => valuesEqual(item, left));
        }
        if (typeof right === "string") {
          this.charge(right.length);
          return right.includes(expectString(`${opName}: left operand of a string search`, left));
        }
        if (isObjectValue(right))
          return Object.prototype.hasOwnProperty.call(
            right,
            expectString(`${opName}: object key`, left),
          );
        throw expressionError(
          "TYPE",
          `${opName}: right operand must be an array, string or object, got ${jsonTypeOf(right)}`,
        );
      }
      case "matches":
        return this.regex(opName, right, undefined).test(this.regexSubject(opName, left));
      case "+": {
        if (typeof left === "number" && typeof right === "number")
          return finite(opName, left + right);
        if (typeof left === "string" && typeof right === "string") return left + right;
        throw expressionError(
          "TYPE",
          `${opName}: operands must both be numbers or both be strings, got ${jsonTypeOf(left)} and ${jsonTypeOf(right)}`,
        );
      }
      case "-":
        return finite(opName, expectNumber(opName, left) - expectNumber(opName, right));
      case "*":
        return finite(opName, expectNumber(opName, left) * expectNumber(opName, right));
      case "/": {
        const divisor = expectNumber(opName, right);
        const dividend = expectNumber(opName, left);
        if (divisor === 0) throw expressionError("DIVISION_BY_ZERO", "division by zero");
        return finite(opName, dividend / divisor);
      }
      case "%": {
        const divisor = expectNumber(opName, right);
        const dividend = expectNumber(opName, left);
        if (divisor === 0) throw expressionError("DIVISION_BY_ZERO", "modulo by zero");
        return finite(opName, dividend % divisor);
      }
    }
  }

  private call(ast: Extract<ExprAst, { kind: "call" }>, env: Env | undefined): JsonValue {
    const fn = ast.fn;
    if (!isExpressionFunction(fn))
      throw expressionError("UNKNOWN_FUNCTION", `unknown function '${fn}'`, { fn });
    const signature = FUNCTION_SIGNATURES[fn];
    if (ast.args.length < signature.minArgs || ast.args.length > signature.maxArgs) {
      throw expressionError(
        "ARITY",
        `${fn} expects ${signature.minArgs}${signature.maxArgs === signature.minArgs ? "" : signature.maxArgs === Number.POSITIVE_INFINITY ? " or more" : ` to ${signature.maxArgs}`} argument(s), got ${ast.args.length}`,
        { fn, got: ast.args.length },
      );
    }
    if (REGEX_FUNCTIONS.has(fn)) {
      this.requireRegexLiteral(fn, ast.args[1], "pattern");
      this.requireRegexLiteral(fn, ast.args[2], "flags");
    }
    const values: JsonValue[] = [];
    let lambda: Extract<ExprAst, { kind: "lambda" }> | undefined = undefined;
    for (const [i, arg] of ast.args.entries()) {
      if (arg.kind === "lambda") {
        if (signature.lambdaArg !== i)
          throw expressionError("LAMBDA_MISUSE", `argument ${i + 1} of ${fn} cannot be a lambda`, {
            fn,
          });
        lambda = arg;
      } else {
        if (signature.lambdaArg === i)
          throw expressionError("LAMBDA_MISUSE", `argument ${i + 1} of ${fn} must be a lambda`, {
            fn,
          });
        values.push(this.eval(arg, env));
      }
    }
    return this.apply(fn, values, lambda, env);
  }

  private invoke(
    lambda: Extract<ExprAst, { kind: "lambda" }>,
    value: JsonValue,
    env: Env | undefined,
  ): JsonValue {
    return this.eval(lambda.body, { name: lambda.param, value, parent: env });
  }

  private apply(
    fn: ExpressionFunctionName,
    args: JsonValue[],
    lambda: Extract<ExprAst, { kind: "lambda" }> | undefined,
    env: Env | undefined,
  ): JsonValue {
    const a0 = args[0] ?? null;
    const a1 = args[1] ?? null;
    switch (fn) {
      case "len": {
        if (typeof a0 === "string") {
          this.charge(a0.length);
          return countCodePoints(a0);
        }
        if (Array.isArray(a0)) {
          this.charge(a0.length);
          return a0.length;
        }
        if (isObjectValue(a0)) {
          const keys = Object.keys(a0);
          this.charge(keys.length);
          return keys.length;
        }
        throw typeError("len", a0, "string, array or object");
      }
      case "lower":
        return expectString("lower", a0).toLowerCase();
      case "upper":
        return expectString("upper", a0).toUpperCase();
      case "trim":
        return expectString("trim", a0).trim();
      case "contains": {
        if (typeof a0 === "string") {
          this.charge(a0.length);
          return a0.includes(expectString("contains: needle", a1));
        }
        if (Array.isArray(a0)) {
          this.charge(a0.length);
          return a0.some((item) => valuesEqual(item, a1));
        }
        throw typeError("contains", a0, "string or array");
      }
      case "starts_with":
        return expectString("starts_with", a0).startsWith(expectString("starts_with: prefix", a1));
      case "ends_with":
        return expectString("ends_with", a0).endsWith(expectString("ends_with: suffix", a1));
      case "split": {
        const text = expectString("split", a0);
        const separator = expectString("split: separator", a1);
        this.charge(text.length);
        return separator === "" ? Array.from(text) : text.split(separator);
      }
      case "join": {
        const items = expectArray("join", a0);
        const separator = args.length > 1 ? expectString("join: separator", a1) : ",";
        this.charge(items.length);
        return items.map(jsonToText).join(separator);
      }
      case "json":
        return stringifyJson(a0);
      case "parse_json": {
        const text = expectString("parse_json", a0);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          if (error instanceof RangeError) throw valueTooDeep();
          const message = error instanceof Error ? error.message : String(error);
          throw expressionError("INVALID_JSON", `parse_json: ${message}`);
        }
        return checkedJsonValue(parsed);
      }
      case "keys": {
        const keys = Object.keys(expectObject("keys", a0));
        this.charge(keys.length);
        return keys;
      }
      case "values": {
        const values = Object.values(expectObject("values", a0));
        this.charge(values.length);
        return values;
      }
      case "has": {
        if (isObjectValue(a0))
          return Object.prototype.hasOwnProperty.call(a0, expectString("has: key", a1));
        if (Array.isArray(a0)) {
          if (typeof a1 === "string") {
            if (!INT_RE.test(a1))
              throw expressionError(
                "TYPE",
                `has: index must be an integer or a canonical integer string, got ${JSON.stringify(a1)}`,
              );
            return Number(a1) < a0.length;
          }
          const i = expectNumber("has: index", a1);
          return Number.isInteger(i) && i >= 0 && i < a0.length;
        }
        throw typeError("has", a0, "object or array");
      }
      case "get": {
        const found = getPointer(a0, expectString("get: pointer", a1));
        return found === undefined ? (args[2] ?? null) : found;
      }
      case "coalesce":
        return args.find((v) => v !== null) ?? null;
      case "min":
      case "max": {
        const numbers = args.length === 1 && Array.isArray(a0) ? a0 : args;
        if (numbers.length === 0) return null;
        this.charge(numbers.length);
        let best: number | undefined;
        for (const n of numbers) {
          const x = expectNumber(fn, n);
          best = best === undefined ? x : fn === "min" ? Math.min(best, x) : Math.max(best, x);
        }
        return best ?? null;
      }
      case "abs":
        return Math.abs(expectNumber("abs", a0));
      case "round":
        return roundTo(
          expectNumber("round", a0),
          args.length > 1 ? expectNumber("round: digits", a1) : 0,
        );
      case "floor":
        return Math.floor(expectNumber("floor", a0));
      case "ceil":
        return Math.ceil(expectNumber("ceil", a0));
      case "sum":
      case "avg": {
        const items = expectArray(fn, a0);
        this.charge(items.length);
        let total = 0;
        for (const item of items) total += expectNumber(`${fn}: element`, item);
        if (fn === "sum") return finite("sum", total);
        return items.length === 0 ? null : finite("avg", total / items.length);
      }
      case "concat": {
        const out: JsonValue[] = [];
        args.forEach((arg, i) => {
          const items = expectArray(`concat: argument ${i + 1}`, arg);
          this.charge(items.length);
          out.push(...items);
        });
        return out;
      }
      case "first":
      case "last": {
        const items = expectArray(fn, a0);
        const value: JsonValue | undefined = fn === "first" ? items[0] : items[items.length - 1];
        return value === undefined ? null : value;
      }
      case "filter":
      case "map":
      case "any":
      case "all": {
        const items = expectArray(fn, a0);
        if (lambda === undefined)
          throw expressionError("LAMBDA_MISUSE", `${fn} needs a lambda`, { fn });
        const fnLambda = lambda;
        switch (fn) {
          case "map":
            return items.map((item) => this.invoke(fnLambda, item, env));
          case "filter":
            return items.filter((item) =>
              expectBoolean("filter: predicate", this.invoke(fnLambda, item, env)),
            );
          case "any":
            return items.some((item) =>
              expectBoolean("any: predicate", this.invoke(fnLambda, item, env)),
            );
          case "all":
            return items.every((item) =>
              expectBoolean("all: predicate", this.invoke(fnLambda, item, env)),
            );
        }
      }
      case "sort": {
        const items = expectArray("sort", a0);
        this.charge(sortCost(items.length));
        const keyed = items.map((item, i) => ({
          item,
          key: lambda === undefined ? item : this.invoke(lambda, item, env),
          i,
        }));
        keyed.sort((x, y) => compareKeys("sort", x.key, y.key) || x.i - y.i);
        return keyed.map((k) => k.item);
      }
      case "to_number": {
        if (typeof a0 === "number") return a0;
        if (typeof a0 === "boolean") return a0 ? 1 : 0;
        if (typeof a0 === "string") return parseNumber(a0);
        throw typeError("to_number", a0, "number, string or boolean");
      }
      case "to_string":
        return jsonToText(a0);
      case "regex_test":
        return this.regex("regex_test", a1, args[2]).test(this.regexSubject("regex_test", a0));
      case "regex_match": {
        const match = this.regex("regex_match", a1, args[2]).exec(
          this.regexSubject("regex_match", a0),
        );
        return match === null
          ? null
          : Array.from(match, (group: string | undefined) => group ?? null);
      }
      case "now":
        return this.scope.now();
      case "format_date":
        return formatDate(
          toDate(a0),
          args.length > 1 ? expectString("format_date: format", a1) : undefined,
        );
    }
  }
}

/**
 * Evaluates `ast` against `scope`. Total and bounded: at most
 * {@link MAX_EVAL_STEPS} steps, built values of at most
 * {@link MAX_EVAL_RESULT_BYTES}, referenced values of at most
 * {@link MAX_EVAL_INPUT_BYTES}, AST nesting of at most {@link MAX_EXPR_DEPTH},
 * value nesting of at most {@link MAX_VALUE_DEPTH}. Throws
 * {@link ExpressionError} (with `details.reason`) on every failure.
 */
export function evaluateExpression(ast: ExprAst, scope: EvalScope): JsonValue {
  return new Evaluator(scope).eval(ast, undefined);
}
