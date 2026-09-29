/**
 * `E_CONFIG_INVALID` messages in the person's terms. An ajv error names a JSON pointer and a
 * schema keyword ("must match pattern ^([0-9a-f]{8}-…)$"); this names the setting by its title
 * (or its key, humanised), says what it expects in words and what it holds now. The pointer
 * stays on the diagnostic's location, so the message never repeats it.
 */
import type { ErrorObject } from "ajv";
import type { JsonSchema } from "@flowaid/workflow-core";
import { unescapePointerToken } from "@flowaid/workflow-core";
import { isPlainObject } from "./util.js";

/** Formats read by name; a pattern whose schema declares one of these is never quoted. */
const FORMATS: Record<string, string> = {
  uuid: "an ID (a UUID such as 3f2c9a1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b)",
  email: "an email address",
  uri: "a URL",
  url: "a URL",
  "date-time": "a date and time (ISO 8601, e.g. 2026-09-29T15:00:00Z)",
  date: "a date (YYYY-MM-DD)",
  time: "a time (HH:MM:SS)",
  duration: "an ISO 8601 duration (e.g. PT30S)",
  ipv4: "an IPv4 address",
  ipv6: "an IPv6 address",
  hostname: "a host name",
};

/** A pattern is shown only when it is short enough to read. */
const MAX_PATTERN = 40;

const ACRONYMS: Record<string, string> = {
  id: "ID",
  ids: "IDs",
  url: "URL",
  urls: "URLs",
  uri: "URI",
  api: "API",
  mcp: "MCP",
  llm: "LLM",
  json: "JSON",
  http: "HTTP",
};

/** "sourceIds" → "Source IDs", "max_steps" → "Max steps". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function segmentsOf(pointer: string): string[] {
  return pointer === "" ? [] : pointer.split("/").slice(1).map(unescapePointerToken);
}

function child(schema: JsonSchema | undefined, segment: string): JsonSchema | undefined {
  if (!schema) return undefined;
  if (/^\d+$/.test(segment) && isPlainObject(schema.items)) return schema.items;
  const props = isPlainObject(schema.properties) ? schema.properties : undefined;
  const found = props?.[segment];
  return isPlainObject(found) ? found : undefined;
}

/** "Documents › Source IDs › item 1" for "/documents/sourceIds/0". */
export function labelOf(pointer: string, root: JsonSchema): string {
  const parts: string[] = [];
  let schema: JsonSchema | undefined = root;
  for (const segment of segmentsOf(pointer)) {
    schema = child(schema, segment);
    if (/^\d+$/.test(segment)) {
      parts.push(`item ${Number(segment) + 1}`);
      continue;
    }
    const title = typeof schema?.title === "string" ? schema.title : undefined;
    parts.push(title ?? humanizeKey(segment));
  }
  return parts.join(" › ");
}

/** A short rendering of the offending value. */
export function showValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === "") return "empty";
  const text = JSON.stringify(value) ?? typeof value;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function kindOf(value: unknown): string {
  if (value === null) return "empty (null)";
  if (Array.isArray(value)) return "a list";
  switch (typeof value) {
    case "string":
      return `text ${showValue(value)}`;
    case "number":
      return `the number ${value}`;
    case "boolean":
      return String(value);
    case "object":
      return "an object";
    case "bigint":
    case "symbol":
    case "undefined":
    case "function":
      break;
  }
  return typeof value;
}

function typeName(type: unknown): string {
  const one = (t: unknown): string => {
    switch (t) {
      case "string":
        return "text";
      case "integer":
        return "a whole number";
      case "number":
        return "a number";
      case "boolean":
        return "true or false";
      case "object":
        return "an object";
      case "array":
        return "a list";
      case "null":
        return "empty (null)";
      default:
        return String(t);
    }
  };
  return Array.isArray(type) ? type.map(one).join(" or ") : one(type);
}

function listOf(values: readonly unknown[]): string {
  const shown = values.slice(0, 8).map((v) => showValue(v));
  return values.length > 8 ? `${shown.join(", ")}, … (${values.length} in all)` : shown.join(", ");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One ajv error as a sentence. `root` is the schema that was validated (a node's configSchema),
 * used for the titles of the settings along the way. Requires ajv's `verbose` option for the
 * current value in the message; without it the message just omits it.
 */
export function describeConfigError(error: ErrorObject, root: JsonSchema): string {
  const params = error.params as Record<string, unknown>;
  const label = labelOf(error.instancePath, root);
  const subject = label || "The configuration";
  const data: unknown = error.data;
  const parent = isPlainObject(error.parentSchema) ? (error.parentSchema as JsonSchema) : undefined;
  const now = "data" in error ? `; it is ${kindOf(data)}` : "";

  switch (error.keyword) {
    case "required": {
      const missing = typeof params.missingProperty === "string" ? params.missingProperty : "?";
      const name = labelOf(`${error.instancePath}/${missing}`, root);
      return label ? `${label} is missing ${name}` : `${name} is required`;
    }
    case "additionalProperties": {
      const extra = typeof params.additionalProperty === "string" ? params.additionalProperty : "?";
      const known = isPlainObject(parent?.properties) ? Object.keys(parent.properties) : [];
      const where = label ? ` in ${label}` : "";
      const hint =
        known.length > 0
          ? ` Known settings: ${known.slice(0, 12).join(", ")}${known.length > 12 ? ", …" : ""}.`
          : "";
      return `'${extra}' is not a setting this node has${where}; remove it.${hint}`;
    }
    case "type":
      return `${subject} must be ${typeName(params.type)}${now}`;
    case "pattern":
    case "format": {
      const format =
        typeof parent?.format === "string"
          ? parent.format
          : typeof params.format === "string"
            ? params.format
            : undefined;
      const expected = format && FORMATS[format] ? FORMATS[format] : undefined;
      if (expected) return `${subject} must be ${expected}${now}`;
      const pattern = typeof params.pattern === "string" ? params.pattern : "";
      const shape = pattern && pattern.length <= MAX_PATTERN ? ` (pattern ${pattern})` : "";
      return `${subject} is not in the expected format${shape}${now}`;
    }
    case "enum": {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues : [];
      return `${subject} must be one of ${listOf(allowed)}${now}`;
    }
    case "const":
      return `${subject} must be ${showValue(params.allowedValue)}${now}`;
    case "minLength":
      return `${subject} must be at least ${plural(Number(params.limit), "character")}${now}`;
    case "maxLength":
      return `${subject} must be at most ${plural(Number(params.limit), "character")}${typeof data === "string" ? `; it has ${data.length}` : ""}`;
    case "minimum":
      return `${subject} must be at least ${String(params.limit)}${now}`;
    case "maximum":
      return `${subject} must be at most ${String(params.limit)}${now}`;
    case "exclusiveMinimum":
      return `${subject} must be greater than ${String(params.limit)}${now}`;
    case "exclusiveMaximum":
      return `${subject} must be less than ${String(params.limit)}${now}`;
    case "multipleOf":
      return `${subject} must be a multiple of ${String(params.multipleOf)}${now}`;
    case "minItems":
      return `${subject} needs at least ${plural(Number(params.limit), "item")}${Array.isArray(data) ? `; it has ${data.length}` : ""}`;
    case "maxItems":
      return `${subject} can have at most ${plural(Number(params.limit), "item")}${Array.isArray(data) ? `; it has ${data.length}` : ""}`;
    case "uniqueItems":
      return `${subject} has a duplicate: items ${Number(params.j) + 1} and ${Number(params.i) + 1} are the same`;
    case "minProperties":
      return `${subject} needs at least ${plural(Number(params.limit), "entry", "entries")}`;
    case "maxProperties":
      return `${subject} can have at most ${plural(Number(params.limit), "entry", "entries")}`;
    case "propertyNames":
      return `${subject} has a key that is not allowed${typeof params.propertyName === "string" ? ` ('${params.propertyName}')` : ""}`;
    case "oneOf":
    case "anyOf":
      return `${subject} does not match any of the shapes this setting accepts${now}`;
    case "not":
      return `${subject} holds a value this setting does not allow${now}`;
    default:
      return `${subject} ${error.message ?? `is invalid (${error.keyword})`}`;
  }
}

/**
 * Whether an error should be reported at all: an `if` failure repeats its `then` branch's errors,
 * and errors under a pointer already reported another way (a template placeholder) would repeat it.
 */
export function reportable(error: ErrorObject, covered: readonly string[]): boolean {
  if (error.keyword === "if") return false;
  const params = error.params as Record<string, unknown>;
  const at =
    error.keyword === "required" && typeof params.missingProperty === "string"
      ? `${error.instancePath}/${params.missingProperty}`
      : error.instancePath;
  return !covered.some((p) => at === p || at.startsWith(`${p}/`));
}
