/**
 * Small, pure helpers shared by the passes: pointers, binding detection, schema builders and a
 * locale-independent string order (every sort in the compiler uses it, so plans are identical
 * in every browser, Node version and locale).
 */
import {
  PortNameSchema,
  parsePointer,
  type Binding,
  type JsonSchema,
  type JsonValue,
} from "@flowaid/workflow-core";

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

export function isPortName(value: string): boolean {
  return PortNameSchema.safeParse(value).success;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a JSON pointer, or undefined when any step is missing. */
export function getAtPointer(value: unknown, pointer: string): unknown {
  const parsed = parsePointer(pointer);
  if (!parsed.ok) return undefined;
  let current: unknown = value;
  for (const token of parsed.tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined;
      current = current[Number(token)];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) return undefined;
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

const BINDING_KINDS = new Set(["literal", "ref", "template", "expr", "object", "array"]);

/** True when a config value is shaped like a Binding (used for `x-ui.bindable` fields). */
export function looksLikeBinding(value: unknown): value is Binding {
  return isPlainObject(value) && typeof value.kind === "string" && BINDING_KINDS.has(value.kind);
}

/** The schema of a literal binding: exactly the literal value, with its JSON type. */
export function literalSchema(value: JsonValue): JsonSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean", const: value };
  if (typeof value === "string") return { type: "string", const: value };
  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number", const: value };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      prefixItems: value.map(literalSchema),
      items: false,
      minItems: value.length,
      maxItems: value.length,
    };
  }
  const properties: Record<string, JsonSchema> = {};
  for (const [key, item] of Object.entries(value)) properties[key] = literalSchema(item);
  return {
    type: "object",
    properties,
    required: Object.keys(value),
    additionalProperties: false,
  };
}

/** A closed object schema with every listed property required (object bindings). */
export function closedObjectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** A fixed-length tuple schema (array bindings). */
export function tupleSchema(items: JsonSchema[]): JsonSchema {
  return {
    type: "array",
    prefixItems: items,
    items: false,
    minItems: items.length,
    maxItems: items.length,
  };
}

/** `schema` or null. */
export function nullableSchema(schema: JsonSchema): JsonSchema {
  if (Object.keys(schema).length === 0) return {};
  return { anyOf: [schema, { type: "null" }] };
}

export const STRING_SCHEMA: JsonSchema = { type: "string" };
export const DATE_TIME_SCHEMA: JsonSchema = { type: "string", format: "date-time" };

/** Deep copy of a JSON value (plans never share structure with the input definition). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A deep copy with every object's keys in code-point order (arrays keep their order). The
 * compiler works on this form so that key order, which JSON storage such as Postgres `jsonb`
 * does not preserve, can never change a plan: equal `definitionHash` ⇒ equal `planHash`.
 */
export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeysDeep) as T;
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareStrings)) out[key] = sortKeysDeep(value[key]);
  return out as T;
}
