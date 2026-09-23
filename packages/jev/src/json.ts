/**
 * JSON helpers shared by the hashing functions: every hash in this package is `sha256Json` over
 * a plain JSON value, and typed objects may carry optional properties set to `undefined`
 * (which `stableStringify` rightly refuses). {@link toJsonValue} drops them first.
 */
import type { JsonObject, JsonValue } from "@flowaid/shared";
import { sha256Json } from "@flowaid/shared";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Converts a JSON-like value to a plain {@link JsonValue}: object properties whose value is
 * `undefined` are dropped (as `JSON.stringify` does). Throws a `TypeError` for values that have
 * no JSON form (functions, symbols, bigints, non-finite numbers, class instances, `undefined`
 * array elements) so a hash never covers a lossy encoding.
 */
export function toJsonValue(value: unknown, path = ""): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path || "(root)"}`);
      return value;
    case "object": {
      if (Array.isArray(value)) {
        return value.map((item: unknown, i) => {
          if (item === undefined) throw new TypeError(`undefined array element at ${path}/${i}`);
          return toJsonValue(item, `${path}/${i}`);
        });
      }
      if (!isRecord(value)) throw new TypeError(`non-plain object at ${path || "(root)"}`);
      const out: JsonObject = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        out[key] = toJsonValue(item, `${path}/${key}`);
      }
      return out;
    }
    case "bigint":
    case "symbol":
    case "undefined":
    case "function":
    default:
      throw new TypeError(`${typeof value} is not a JSON value at ${path || "(root)"}`);
  }
}

/** `sha256Json` of {@link toJsonValue}`(value)`: key order and absent optionals never change it. */
export function hashJson(value: unknown): string {
  return sha256Json(toJsonValue(value));
}
