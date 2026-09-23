/**
 * Whole-value JSON Schema validation for SchemaForm with ajv (draft 2020-12),
 * the same engine and schemas the compiler uses for `E_CONFIG_INVALID`.
 *
 * The form's own per-field rules (`buildRules`) give the friendly, immediate
 * messages; this layer catches everything else the schema says (nested
 * `required`, `additionalProperties`, `minProperties`, `propertyNames`, union
 * members, …). Before validating, the values are prepared the way the
 * compiler sees them: fields hidden by `x-ui.showWhen` are dropped, bindable
 * fields holding a ref/template/expr binding are skipped (the compiler
 * resolves them before `execute()`), `{ kind: 'literal' }` wrappers are
 * unwrapped and unset optional fields ("" / undefined) are omitted.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import type { JsonSchema } from "@/types";
import {
  devWarn,
  enumKey,
  evaluateShowWhen,
  hintsOf,
  humanize,
  isBinding,
  isNullable,
  isRecord,
  pathSegments,
  resolveSchema,
  variantInfo,
  type SchemaValues,
} from "./schema";

/** One schema violation, addressed by the dotted form path of the offending value ("" is the root). */
export interface SchemaIssue {
  path: string;
  keyword: string;
  /** Predicate phrase without the field label, e.g. "must be at least 3 characters". */
  message: string;
}

export interface SchemaValidator {
  /** Issues for the current form values (empty when valid or when the schema could not be compiled). */
  validate: (values: SchemaValues) => SchemaIssue[];
}

type PlainSchema = Record<string, unknown>;

/** Keywords handled structurally (recursed into) or dropped before compiling. */
const STRUCTURAL = new Set([
  "properties",
  "$defs",
  "items",
  "additionalProperties",
  "allOf",
  "oneOf",
  "anyOf",
]);
const DROPPED = new Set(["$schema", "$id", "x-ui", "x-ui-ext", "x-flowaid", "discriminator"]);

function plainKeywords(schema: JsonSchema): PlainSchema {
  const clone: unknown = JSON.parse(JSON.stringify(schema));
  const out: PlainSchema = {};
  if (!isRecord(clone)) return out;
  for (const [key, value] of Object.entries(clone)) {
    if (STRUCTURAL.has(key) || DROPPED.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function mapRecord(
  record: Record<string, JsonSchema>,
  root: JsonSchema,
): Record<string, PlainSchema> {
  const out: Record<string, PlainSchema> = {};
  for (const [key, value] of Object.entries(record)) out[key] = toValidationSchema(value, root);
  return out;
}

/**
 * Copies a form schema into the schema ajv compiles. Discriminated unions
 * (the ones SchemaForm renders as a segmented control) become `if/then`
 * chains keyed on the discriminator, so a value reports the errors of its
 * selected member only instead of every failing `oneOf` branch.
 */
export function toValidationSchema(schema: JsonSchema, root: JsonSchema): PlainSchema {
  const out = plainKeywords(schema);
  if (schema.properties) out.properties = mapRecord(schema.properties, root);
  if (schema.$defs) out.$defs = mapRecord(schema.$defs, root);
  if (schema.items) out.items = toValidationSchema(schema.items, root);
  if (typeof schema.additionalProperties === "boolean")
    out.additionalProperties = schema.additionalProperties;
  else if (schema.additionalProperties)
    out.additionalProperties = toValidationSchema(schema.additionalProperties, root);
  const allOf: PlainSchema[] = (schema.allOf ?? []).map((part) => toValidationSchema(part, root));
  const members = schema.oneOf ?? schema.anyOf;
  if (members) {
    const info = variantInfo(schema, root);
    if (info) {
      const d = info.discriminator;
      const consts: unknown[] = [];
      const branches: PlainSchema[] = [];
      members.forEach((member, index) => {
        const constValue = resolveSchema(member, root).properties?.[d]?.const;
        if (constValue === undefined || info.variants[index] === undefined) return;
        consts.push(constValue);
        branches.push({
          if: { properties: { [d]: { const: constValue } }, required: [d] },
          then: toValidationSchema(member, root),
        });
      });
      allOf.push({ required: [d], properties: { [d]: { enum: consts } } }, ...branches);
    } else {
      out[schema.oneOf ? "oneOf" : "anyOf"] = members.map((m) => toValidationSchema(m, root));
    }
  }
  if (allOf.length > 0) out.allOf = allOf;
  return out;
}

interface PrepareContext {
  root: JsonSchema;
  rootValues: SchemaValues;
  /** Dotted paths not validated: hidden by showWhen or holding a ref/template/expr binding. */
  skipped: string[];
}

function join(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function prepareValue(
  schema: JsonSchema,
  value: unknown,
  path: string,
  ctx: PrepareContext,
): unknown {
  const resolved = resolveSchema(schema, ctx.root);
  const info = variantInfo(resolved, ctx.root);
  if (info && isRecord(value)) {
    const selected = info.variants.find((v) => v.value === enumKey(value[info.discriminator]));
    return selected ? prepareObject(selected.schema, value, path, ctx) : value;
  }
  if (isRecord(value) && resolved.properties) return prepareObject(resolved, value, path, ctx);
  if (Array.isArray(value) && resolved.items) {
    const items = resolved.items;
    return value.map((item, index) => prepareValue(items, item, join(path, String(index)), ctx));
  }
  return value;
}

function prepareObject(
  schema: JsonSchema,
  value: SchemaValues,
  path: string,
  ctx: PrepareContext,
): SchemaValues {
  const out: SchemaValues = {};
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};
  const hidden = new Set<string>();
  for (const [key, raw] of Object.entries(properties)) {
    const showWhen = hintsOf(resolveSchema(raw, ctx.root)).showWhen;
    if (showWhen && !evaluateShowWhen(showWhen, ctx.rootValues)) {
      hidden.add(key);
      ctx.skipped.push(join(path, key));
    }
  }
  for (const [key, current] of Object.entries(value)) {
    if (hidden.has(key)) continue;
    const raw = properties[key];
    if (!raw) {
      if (current !== undefined) out[key] = current;
      continue;
    }
    const resolved = resolveSchema(raw, ctx.root);
    const hints = hintsOf(resolved);
    let next: unknown = current;
    if ((hints.bindable === true || hints.widget === "binding") && isBinding(next)) {
      if (next.kind !== "literal") {
        ctx.skipped.push(join(path, key));
        continue;
      }
      next = next.value;
    }
    const optional = !required.has(key);
    if (next === undefined) continue;
    if (optional && next === "") continue;
    if (optional && next === null && !isNullable(resolved)) continue;
    out[key] = prepareValue(raw, next, join(path, key), ctx);
  }
  return out;
}

function pointerToPath(pointer: string): string {
  return pathSegments(pointer).join(".");
}

function num(value: unknown): string {
  return typeof value === "number" ? String(value) : "";
}

function plural(n: unknown, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A friendly predicate for one ajv error (the field label is prefixed by the caller). */
export function issueMessage(error: ErrorObject): string {
  const params: Record<string, unknown> = error.params;
  switch (error.keyword) {
    case "required":
      return "is required";
    case "type":
      return `must be ${typeof params.type === "string" ? typeName(params.type) : "of the declared type"}`;
    case "minLength":
      return `must be at least ${num(params.limit)} characters`;
    case "maxLength":
      return `must be at most ${num(params.limit)} characters`;
    case "minimum":
      return `must be at least ${num(params.limit)}`;
    case "maximum":
      return `must be at most ${num(params.limit)}`;
    case "exclusiveMinimum":
      return `must be greater than ${num(params.limit)}`;
    case "exclusiveMaximum":
      return `must be less than ${num(params.limit)}`;
    case "multipleOf":
      return `must be a multiple of ${num(params.multipleOf)}`;
    case "enum":
      return "must be one of the listed options";
    case "const":
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case "pattern":
      return "does not match the expected format";
    case "minItems":
      return `needs at least ${num(params.limit)} ${plural(params.limit, "item", "items")}`;
    case "maxItems":
      return `can have at most ${num(params.limit)} items`;
    case "uniqueItems":
      return "must not contain duplicates";
    case "minProperties":
      return `needs at least ${num(params.limit)} ${plural(params.limit, "entry", "entries")}`;
    case "maxProperties":
      return `can have at most ${num(params.limit)} entries`;
    case "propertyNames":
      return `has a key that does not match the expected format${typeof params.propertyName === "string" ? ` (“${params.propertyName}”)` : ""}`;
    case "additionalProperties":
      return `has an unknown field “${typeof params.additionalProperty === "string" ? params.additionalProperty : ""}”`;
    default:
      return error.message ?? "is invalid";
  }
}

function typeName(type: string): string {
  switch (type) {
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
    default:
      return type;
  }
}

function isUnder(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}.`));
}

function toIssues(errors: readonly ErrorObject[], skipped: readonly string[]): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    // The failing `then` of a discriminated union is reported by its own errors.
    if (error.keyword === "if") continue;
    const base = pointerToPath(error.instancePath);
    const params: Record<string, unknown> = error.params;
    const path =
      error.keyword === "required" && typeof params.missingProperty === "string"
        ? join(base, params.missingProperty)
        : base;
    if (isUnder(path, skipped)) continue;
    // `propertyNames` reports the inner keyword too; keep the one message per path and keyword.
    const key = `${path}\u0000${error.keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, keyword: error.keyword, message: issueMessage(error) });
  }
  return out;
}

/**
 * Compiles `root` once and returns a validator over form values. A schema ajv
 * cannot compile disables this layer (with a development warning); the
 * per-field rules still apply.
 */
export function createSchemaValidator(root: JsonSchema): SchemaValidator {
  let compiled: ValidateFunction | null = null;
  try {
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
    compiled = ajv.compile(toValidationSchema(root, root));
  } catch (error) {
    devWarn(
      `the schema could not be compiled for validation (${error instanceof Error ? error.message : String(error)}); only field rules apply.`,
    );
  }
  let lastKey: string | null = null;
  let lastIssues: SchemaIssue[] = [];
  return {
    validate(values) {
      if (!compiled) return [];
      const ctx: PrepareContext = { root, rootValues: values, skipped: [] };
      const data = prepareObject(resolveSchema(root, root), values, "", ctx);
      const key = JSON.stringify(data) + JSON.stringify(ctx.skipped);
      if (key === lastKey) return lastIssues;
      const valid = compiled(data);
      lastKey = key;
      lastIssues = valid ? [] : toIssues(compiled.errors ?? [], ctx.skipped);
      return lastIssues;
    },
  };
}

/** Issues addressed exactly to `path` (a field's own errors). */
export function issuesAt(issues: readonly SchemaIssue[], path: string): SchemaIssue[] {
  return issues.filter((issue) => issue.path === path);
}

/** A label for an issue path: the field's schema title, else the humanised last key; "Configuration" for the root. */
export function labelForPath(path: string, root: JsonSchema): string {
  if (path === "") return "Configuration";
  let schema: JsonSchema | undefined = resolveSchema(root, root);
  let last = path;
  for (const segment of path.split(".")) {
    last = segment;
    if (!schema) break;
    const current: JsonSchema = resolveSchema(schema, root);
    const next: JsonSchema | undefined =
      /^\d+$/.test(segment) && current.items ? current.items : current.properties?.[segment];
    schema = next ? resolveSchema(next, root) : undefined;
  }
  return schema?.title ?? humanize(last);
}
