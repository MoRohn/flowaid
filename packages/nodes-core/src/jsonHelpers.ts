/** Small JSON helpers shared by the data nodes. */
import { SchemaValidationError, type JsonObject, type JsonValue } from "@flowaid/workflow-core";

export { SchemaValidationError };
export type { JsonObject, JsonValue };

export const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function sortKeys(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObject(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys(v[k] as JsonValue)]),
    );
  return v;
}

export function stableStringifyJson(value: JsonValue, pretty: boolean): string {
  return JSON.stringify(sortKeys(value), null, pretty ? 2 : undefined);
}

/** Recursive merge: objects merge key by key, everything else is replaced by the later value. */
export function deepMerge(a: JsonValue, b: JsonValue, arrays: "replace" | "concat"): JsonValue {
  if (isObject(a) && isObject(b)) {
    const out: JsonObject = { ...a };
    for (const [k, v] of Object.entries(b))
      out[k] = k in a ? deepMerge(a[k] as JsonValue, v, arrays) : v;
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && arrays === "concat") return [...a, ...b];
  return b;
}
