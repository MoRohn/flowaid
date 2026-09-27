/**
 * `coerceArgs`: lenient argument conversion before validation, so model-produced arguments like
 * `"42"` for an integer or `"true"` for a boolean pass. Every conversion is reported (trace-visible).
 */
import type { JsonSchema, JsonValue } from "@flowaid/workflow-core";

export interface Coercion {
  path: string;
  from: string;
  to: string;
}

const typeName = (v: JsonValue): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

function typesOf(schema: JsonSchema): string[] {
  const t = schema.type;
  if (Array.isArray(t)) return t;
  if (typeof t === "string") return [t];
  const alt = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  return alt.flatMap((s) => (typeof s.type === "string" ? [s.type] : []));
}

export function coerceArgs(
  schema: JsonSchema,
  value: JsonValue,
  path = "",
): { value: JsonValue; coerced: Coercion[] } {
  const coerced: Coercion[] = [];
  const out = coerce(schema, value, path, coerced, 0);
  return { value: out, coerced };
}

function coerce(
  schema: JsonSchema,
  value: JsonValue,
  path: string,
  log: Coercion[],
  depth: number,
): JsonValue {
  if (depth > 64 || typeof schema !== "object") return value;
  const types = typesOf(schema);
  const note = (to: JsonValue) => {
    log.push({ path: path || "/", from: typeName(value), to: typeName(to) });
    return to;
  };
  if (
    types.length > 0 &&
    !types.includes(typeName(value)) &&
    !(types.includes("integer") && Number.isInteger(value)) &&
    !(types.includes("number") && typeof value === "number")
  ) {
    if (typeof value === "string") {
      const s = value.trim();
      if (
        (types.includes("integer") && /^-?\d+$/.test(s)) ||
        (types.includes("number") && s !== "" && Number.isFinite(Number(s)))
      )
        return note(Number(s));
      if (types.includes("boolean") && /^(?:true|false)$/i.test(s))
        return note(s.toLowerCase() === "true");
      if (types.includes("null") && (s === "" || s === "null")) return note(null);
      if ((types.includes("object") || types.includes("array")) && /^[[{]/.test(s)) {
        try {
          const parsed = JSON.parse(s) as JsonValue;
          if (types.includes(typeName(parsed)))
            return coerce(schema, note(parsed), path, log, depth + 1);
        } catch {
          /* leave it to validation */
        }
      }
      if (types.includes("array")) return coerce(schema, note([value]), path, log, depth + 1);
    } else if (
      (typeof value === "number" || typeof value === "boolean") &&
      types.includes("string")
    )
      return note(String(value));
    else if (typeof value === "number" && types.includes("boolean") && (value === 0 || value === 1))
      return note(value === 1);
    else if (types.includes("array") && value !== null && !Array.isArray(value))
      return coerce(schema, note([value]), path, log, depth + 1);
  }
  if (Array.isArray(value) && typeof schema.items === "object" && !Array.isArray(schema.items))
    return value.map((v, i) =>
      coerce(schema.items as JsonSchema, v, `${path}/${i}`, log, depth + 1),
    );
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const props = schema.properties ?? {};
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = props[k]
        ? coerce(
            props[k],
            v,
            `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`,
            log,
            depth + 1,
          )
        : v;
    return out;
  }
  return value;
}
