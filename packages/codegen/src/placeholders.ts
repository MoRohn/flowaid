/**
 * Schema-generated sample values (CODE_EXPORT.md §1, "Redaction"). An export reads only persisted,
 * already redacted run data; on top of that, fields marked `x-dataClass: pii | sensitive` and
 * `{ "$redacted": true }` stubs are replaced by values generated from the schema, and every
 * replacement is listed (the package README prints the list).
 */
import type { JsonValue } from "@flowaid/workflow-core";

type Schema = Record<string, unknown>;

/** Where a value was replaced, and why. */
export interface Placeholder {
  /** e.g. `inputs/example.json#/customer/email` or `tests/recorded-run.json#/nodes/draft/output` */
  location: string;
  reason: "pii" | "sensitive" | "redacted";
}

const asSchema = (s: unknown): Schema | undefined =>
  s !== null && typeof s === "object" && !Array.isArray(s) ? (s as Schema) : undefined;

function firstType(schema: Schema): string | undefined {
  const t = schema.type;
  if (Array.isArray(t)) return (t as string[]).find((x) => x !== "null") ?? (t[0] as string);
  return typeof t === "string" ? t : schema.properties ? "object" : undefined;
}

function stringFor(schema: Schema, redacted: boolean): string {
  switch (schema.format) {
    case "email":
      return "user@example.com";
    case "date-time":
      return "2026-01-01T00:00:00.000Z";
    case "date":
      return "2026-01-01";
    case "uri":
    case "url":
      return "https://example.com/";
    case "uuid":
      return "00000000-0000-4000-8000-000000000000";
    default: {
      const text = redacted ? "[redacted]" : "example";
      const min = typeof schema.minLength === "number" ? schema.minLength : 0;
      return text.padEnd(min, "x");
    }
  }
}

/**
 * A value that satisfies `schema` as far as the common keywords go: `const`, `enum`, then (unless
 * `redacted`) `examples` and `default`, then by type. Depth-limited for recursive schemas.
 */
export function sampleFor(
  schemaIn: unknown,
  opts: { redacted?: boolean } = {},
  depth = 0,
): JsonValue {
  const schema = asSchema(schemaIn);
  const redacted = opts.redacted ?? false;
  if (!schema || depth > 8) return redacted ? "[redacted]" : null;
  if ("const" in schema) return schema.const as JsonValue;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0] as JsonValue;
  if (!redacted && Array.isArray(schema.examples) && schema.examples.length > 0)
    return schema.examples[0] as JsonValue;
  if (!redacted && "default" in schema) return schema.default as JsonValue;
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const list = schema[key];
    if (Array.isArray(list) && list.length > 0) return sampleFor(list[0], opts, depth + 1);
  }
  switch (firstType(schema) ?? "") {
    case "string":
      return stringFor(schema, redacted);
    case "integer":
    case "number": {
      const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
      const max = typeof schema.maximum === "number" ? schema.maximum : undefined;
      return min ?? (max !== undefined && max < 0 ? max : 0);
    }
    case "boolean":
      return false;
    case "null":
      return null;
    case "array": {
      const n = typeof schema.minItems === "number" ? schema.minItems : redacted ? 0 : 1;
      return Array.from({ length: n }, () => sampleFor(schema.items, opts, depth + 1));
    }
    case "object": {
      const props = asSchema(schema.properties) ?? {};
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
      const keys = redacted ? required : Object.keys(props);
      return Object.fromEntries(
        keys.filter((k) => k in props).map((k) => [k, sampleFor(props[k], opts, depth + 1)]),
      );
    }
    default:
      return redacted ? "[redacted]" : null;
  }
}

const isRedactedStub = (v: unknown): boolean =>
  v !== null && typeof v === "object" && (v as Record<string, unknown>).$redacted === true;

const escapePointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * `value` with every `{ "$redacted": true }` stub and every `x-dataClass: pii | sensitive` field
 * replaced by a schema-generated value; each replacement is appended to `found`.
 */
export function scrub(
  value: JsonValue,
  schemaIn: unknown,
  location: string,
  found: Placeholder[],
): JsonValue {
  const schema = asSchema(schemaIn);
  const dataClass = schema?.["x-dataClass"];
  if (isRedactedStub(value)) {
    found.push({ location, reason: "redacted" });
    return sampleFor(schema, { redacted: true });
  }
  if (dataClass === "pii" || dataClass === "sensitive") {
    found.push({ location, reason: dataClass });
    return sampleFor(schema, { redacted: true });
  }
  if (Array.isArray(value))
    return value.map((v, i) => scrub(v, schema?.items, `${location}/${i}`, found));
  if (value !== null && typeof value === "object") {
    const props = asSchema(schema?.properties) ?? {};
    const extra = schema?.additionalProperties;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        scrub(v, props[k] ?? extra, `${location}/${escapePointer(k)}`, found),
      ]),
    );
  }
  return value;
}
