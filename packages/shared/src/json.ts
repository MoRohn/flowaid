/**
 * JSON value types and helpers.
 *
 * `JsonValue` is the closed set of values that survive a `JSON.stringify` /
 * `JSON.parse` round trip unchanged. Everything flowaid persists, transmits or
 * hashes is a `JsonValue`; these helpers are the only place that decides what
 * counts as one.
 */

/** A JSON scalar. `number` excludes `NaN` and `±Infinity` (see {@link isJsonValue}). */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON document: a primitive, an array of JSON values or a string-keyed object of them. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A JSON object (string keys, JSON values). */
export type JsonObject = { [key: string]: JsonValue };

/** A JSON array. */
export type JsonArray = JsonValue[];

/**
 * True when `value` is a plain object created by an object literal, `Object.create(null)`
 * or `JSON.parse`. Class instances, arrays, `Map`s, `Date`s and functions are not plain.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * True when `value` is a JSON object whose every (own, enumerable) property is a JSON value.
 * This is a deep check; use it at trust boundaries, not in hot loops.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  if (!isPlainObject(value)) {
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!isJsonValue(value[key])) {
      return false;
    }
  }
  return true;
}

/**
 * True when `value` is representable as JSON without loss: `null`, booleans, strings,
 * finite numbers, arrays of JSON values and plain objects of JSON values. `undefined`,
 * functions, symbols, bigints, `NaN`, `Infinity`, `Date`, `Map`, class instances and
 * sparse-array holes all return `false`.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (value === null) {
        return true;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          if (!(i in value) || !isJsonValue(value[i])) {
            return false;
          }
        }
        return true;
      }
      return isJsonObject(value);
    }
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return false;
  }
}

/**
 * Structural equality for JSON-like values. Objects are compared by their own enumerable
 * keys regardless of key order; arrays by index; primitives by `===` (so `NaN` is never
 * equal to anything, matching JSON semantics where `NaN` cannot exist). Non-plain objects
 * are only equal when they are the same reference.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Returns a deep copy of `value` with every object's keys sorted (code-unit order) at every
 * depth. Arrays keep their order. The result is a fresh structure; the input is not mutated.
 * Two JSON values that are {@link deepEqual} canonicalize to values whose `JSON.stringify`
 * output is identical.
 */
export function canonicalize<T extends JsonValue>(value: T): T;
export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) {
        out[key] = canonicalize(item);
      }
    }
    return out;
  }
  return value;
}

/**
 * Deep-clones a JSON value. Cheaper than `structuredClone` for plain JSON and guaranteed to
 * return plain objects/arrays.
 */
export function cloneJson<T extends JsonValue>(value: T): T;
export function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item));
  }
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item !== undefined) {
        out[key] = cloneJson(item);
      }
    }
    return out;
  }
  return value;
}
