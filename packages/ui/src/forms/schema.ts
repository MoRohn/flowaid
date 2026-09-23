/**
 * Pure helpers for reading a JSON Schema (as emitted by Zod 4's `z.toJSONSchema`)
 * the way SchemaForm needs it: $ref resolution, field ordering and grouping,
 * default values, variant detection and react-hook-form validation rules.
 */
import {
  BindingSchema,
  type Binding,
  type JsonSchema as ContractJsonSchema,
  type UiHints,
} from "@flowaid/workflow-core";
import type { FormExtensionHints, JsonSchema } from "@/types";

export type SchemaValues = Record<string, unknown>;

/** Widgets the forms group registers beyond the manifest `x-ui` set (RFC-0012 keeps them as extensions, selected through `x-ui-ext`). */
export type ExtensionWidgetName =
  "secret" | "radio" | "threshold" | "credential" | "expression" | "retry-policy";

/** The manifest widget vocabulary (`UiHintsSchema.widget`). */
export type UiWidgetName = NonNullable<UiHints["widget"]>;

/**
 * Rendering hints as the forms group reads them: the manifest `x-ui` hints
 * (`UiHints` from workflow-core), the forms-only `x-ui-ext` block (extension
 * widgets and their options) and the deprecated `x-flowaid` keys still
 * accepted for one release (`advanced` is read as `collapsed`).
 */
export interface FieldHints extends Omit<UiHints, "widget" | "language"> {
  /** A manifest widget (`x-ui`), an extension or a name registered through `registerWidget` (`x-ui-ext`). */
  widget?: string;
  language?: FormExtensionHints["language"];
  /** `credential` widget: the credential type to offer. */
  credentialType?: string;
  /** `model` widget: which models to offer. */
  modelKind?: FormExtensionHints["modelKind"];
}

const LANGUAGES: readonly NonNullable<FieldHints["language"]>[] = [
  "javascript",
  "typescript",
  "json",
  "yaml",
];
const MODEL_KINDS: readonly NonNullable<FieldHints["modelKind"]>[] = [
  "decision",
  "generation",
  "embedding",
];

/**
 * True outside production builds. Bundlers replace `process.env.NODE_ENV`
 * statically; without a `process` global (a plain browser ESM build) the
 * check reads as development.
 */
export function isDevelopment(): boolean {
  const proc: unknown = Reflect.get(globalThis, "process");
  if (!isRecord(proc)) return true;
  const env = proc.env;
  return !isRecord(env) || env.NODE_ENV !== "production";
}

const warned = new Set<string>();

/** Logs a development-only warning once per distinct message. */
export function devWarn(message: string): void {
  if (!isDevelopment() || warned.has(message)) return;
  warned.add(message);
  console.warn(`[@flowaid/ui SchemaForm] ${message}`);
}

/** Reads the deprecated, untyped `x-flowaid` block into `FieldHints`, keeping only well-typed keys. */
function legacyHints(raw: Record<string, unknown>): FieldHints {
  const out: FieldHints = {};
  if (typeof raw.widget === "string") out.widget = raw.widget;
  if (typeof raw.placeholder === "string") out.placeholder = raw.placeholder;
  if (typeof raw.help === "string") out.help = raw.help;
  if (typeof raw.group === "string") out.group = raw.group;
  if (typeof raw.order === "number") out.order = raw.order;
  if (raw.advanced === true || raw.collapsed === true) out.collapsed = true;
  if (typeof raw.bindable === "boolean") out.bindable = raw.bindable;
  if (typeof raw.optionsProvider === "string") out.optionsProvider = raw.optionsProvider;
  if (typeof raw.credentialType === "string") out.credentialType = raw.credentialType;
  const language = LANGUAGES.find((l) => l === raw.language);
  if (language) out.language = language;
  const modelKind = MODEL_KINDS.find((k) => k === raw.modelKind);
  if (modelKind) out.modelKind = modelKind;
  if (typeof raw.min === "number") out.min = raw.min;
  if (typeof raw.max === "number") out.max = raw.max;
  if (typeof raw.step === "number") out.step = raw.step;
  return out;
}

/** Follows `$ref: "#/$defs/Name"` (recursively) against the root schema's `$defs`. */
export function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  const seen = new Set<string>();
  while (current.$ref) {
    const ref = current.$ref;
    if (seen.has(ref)) break;
    seen.add(ref);
    const match = /^#\/\$defs\/(.+)$/.exec(ref);
    const target = match?.[1] ? root.$defs?.[match[1]] : undefined;
    if (!target) break;
    const { $ref: _ref, ...rest } = current;
    current = { ...target, ...rest };
  }
  if (current.allOf && current.allOf.length > 0) {
    // Zod emits allOf for intersections; flatten object members.
    const merged: JsonSchema = { ...current };
    delete merged.allOf;
    for (const part of current.allOf) {
      const resolved = resolveSchema(part, root);
      merged.properties = { ...merged.properties, ...resolved.properties };
      merged.required = [...(merged.required ?? []), ...(resolved.required ?? [])];
      if (resolved.type && !merged.type) merged.type = resolved.type;
    }
    return merged;
  }
  return current;
}

/**
 * Hints of a schema: `x-ui` (typed `UiHints` from workflow-core) merged with the
 * forms-only `x-ui-ext` block. A schema without `x-ui` falls back to the
 * deprecated `x-flowaid` block (read for one release, with a development warning).
 */
export function hintsOf(schema: JsonSchema): FieldHints {
  const ui = schema["x-ui"];
  const ext = schema["x-ui-ext"];
  const legacy = schema["x-flowaid"];
  let hints: FieldHints;
  if (ui) {
    const { language, ...rest } = ui;
    hints = { ...rest };
    const known = LANGUAGES.find((l) => l === language);
    if (known) hints.language = known;
    if (isRecord(legacy))
      devWarn(`"x-flowaid" ${JSON.stringify(legacy)} is ignored next to "x-ui"; delete it.`);
  } else if (isRecord(legacy)) {
    devWarn(
      `"x-flowaid" is deprecated and will be removed in the next release; rename ${JSON.stringify(legacy)} to "x-ui" (extension widgets go under "x-ui-ext").`,
    );
    hints = legacyHints(legacy);
  } else {
    hints = {};
  }
  if (ext) {
    if (ext.widget !== undefined) hints.widget = ext.widget;
    if (ext.credentialType !== undefined) hints.credentialType = ext.credentialType;
    if (ext.modelKind !== undefined) hints.modelKind = ext.modelKind;
    if (ext.language !== undefined) hints.language = ext.language;
  }
  return hints;
}

export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

const JSON_TYPES: readonly string[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

function isJsonType(value: string): value is JsonType {
  return JSON_TYPES.includes(value);
}

/** The primary JSON type of a schema, ignoring `null` in unions. */
export function primaryType(schema: JsonSchema): JsonType | undefined {
  const t = schema.type;
  if (Array.isArray(t)) {
    const first = t.find((x) => x !== "null");
    return first !== undefined && isJsonType(first) ? first : undefined;
  }
  return t;
}

export function isNullable(schema: JsonSchema): boolean {
  return Array.isArray(schema.type) && schema.type.includes("null");
}

export interface OrderedProperty {
  key: string;
  schema: JsonSchema;
  hints: FieldHints;
  required: boolean;
  /** `$defs` name when the property was declared as a `$ref`, e.g. "RetryPolicy". */
  ref?: string;
}

/** The `$defs` name a `$ref` points at, or undefined. */
export function refName(schema: JsonSchema): string | undefined {
  const match = schema.$ref ? /^#\/\$defs\/(.+)$/.exec(schema.$ref) : null;
  return match?.[1];
}

/** Properties ordered by `x-ui.order` (ascending), then declaration order. */
export function orderedProperties(schema: JsonSchema, root: JsonSchema): OrderedProperty[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(props).map(([key, raw], index) => {
    const resolved = resolveSchema(raw, root);
    return {
      key,
      schema: resolved,
      hints: hintsOf(resolved),
      required: required.has(key),
      ref: refName(raw),
      index,
    };
  });
  entries.sort((a, b) => {
    const ao = a.hints.order ?? Number.POSITIVE_INFINITY;
    const bo = b.hints.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.index - b.index;
  });
  return entries.map(({ index: _index, ...rest }) => rest);
}

export interface PropertyGroup {
  /** Group title, or null for ungrouped fields (rendered first, without a heading). */
  title: string | null;
  fields: OrderedProperty[];
  /** Leaf fields hinted `collapsed` (or the deprecated `advanced`): rendered in a closed "Advanced" disclosure. */
  collapsed: OrderedProperty[];
}

/** True for an object schema rendered as its own fieldset (fixed properties, no widget, not a union or map). */
export function isFieldset(schema: JsonSchema, hints: FieldHints): boolean {
  if (hints.widget !== undefined) return false;
  if (schema.oneOf || schema.anyOf) return false;
  return primaryType(schema) === "object" && !isMapSchema(schema);
}

/**
 * Splits ordered properties into `x-ui.group` sections. A `collapsed` leaf goes
 * to its section's closed "Advanced" disclosure; a `collapsed` object keeps its
 * place and renders its own fieldset closed.
 */
export function groupProperties(props: OrderedProperty[]): PropertyGroup[] {
  const groups = new Map<string | null, PropertyGroup>();
  for (const prop of props) {
    const title = prop.hints.group ?? null;
    let group = groups.get(title);
    if (!group) {
      group = { title, fields: [], collapsed: [] };
      groups.set(title, group);
    }
    // `$ref` objects may render through a registered `ref:<Name>` widget, so they are treated as leaves.
    if (
      prop.hints.collapsed === true &&
      (prop.ref !== undefined || !isFieldset(prop.schema, prop.hints))
    )
      group.collapsed.push(prop);
    else group.fields.push(prop);
  }
  const list = [...groups.values()];
  list.sort((a, b) => (a.title === null ? -1 : b.title === null ? 1 : 0));
  return list;
}

/** Option list for enum/const schemas. Labels come from `enumNames`-style titles when present. */
/** Stringifies a primitive enum/const member; objects are JSON-encoded so they stay distinguishable. */
export function enumKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (value === null) return "null";
  if (value === undefined) return "";
  return JSON.stringify(value);
}

/** Enum label: all-caps tokens (GET, RATE_LIMITED) stay as written; other keys are humanised. */
export function enumLabel(value: unknown): string {
  const key = enumKey(value);
  return /^[A-Z0-9_-]+$/.test(key) ? key : humanize(key);
}

export function enumOptions(schema: JsonSchema): Array<{ value: string; label: string }> {
  const values = schema.enum ?? (schema.const !== undefined ? [schema.const] : []);
  return values.map((v) => ({ value: enumKey(v), label: enumLabel(v) }));
}

/** Turns a snake_case / camelCase key into a label: `maxAttempts` → "Max attempts". */
export function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function labelFor(key: string, schema: JsonSchema): string {
  return schema.title ?? humanize(key);
}

export interface VariantInfo {
  discriminator: string;
  variants: Array<{ value: string; label: string; schema: JsonSchema }>;
}

/**
 * Detects a discriminated union: `oneOf`/`anyOf` where every member is an object
 * with a `const` on the discriminator property (explicit via `discriminator`, or
 * inferred as the first property that is `const` in every member).
 */
export function variantInfo(schema: JsonSchema, root: JsonSchema): VariantInfo | null {
  const members = (schema.oneOf ?? schema.anyOf)?.map((m) => resolveSchema(m, root));
  if (!members || members.length === 0) return null;
  let discriminator = schema.discriminator?.propertyName;
  if (!discriminator) {
    const first = members[0];
    if (!first?.properties) return null;
    discriminator = Object.keys(first.properties).find((key) =>
      members.every((m) => m.properties?.[key]?.const !== undefined),
    );
  }
  if (!discriminator) return null;
  const variants: VariantInfo["variants"] = [];
  for (const member of members) {
    const constValue = member.properties?.[discriminator]?.const;
    if (constValue === undefined) return null;
    variants.push({
      value: enumKey(constValue),
      label: member.title ?? humanize(enumKey(constValue)),
      schema: member,
    });
  }
  return { discriminator, variants };
}

/** True for `{ type: "object" }` schemas without fixed properties: a free-form map. */
export function isMapSchema(schema: JsonSchema): boolean {
  if (primaryType(schema) !== "object") return false;
  const hasProps = schema.properties && Object.keys(schema.properties).length > 0;
  return !hasProps && schema.additionalProperties !== false;
}

/**
 * Builds a value satisfying the schema's declared defaults. Objects get every
 * property's default (so react-hook-form sees a stable shape); arrays start
 * empty unless a default is given; primitives fall back to `undefined`.
 */
export function defaultValueFor(schema: JsonSchema, root: JsonSchema): unknown {
  const s = resolveSchema(schema, root);
  if (s.default !== undefined) return structuredCloneSafe(s.default);
  if (s.const !== undefined) return s.const;
  const variant = variantInfo(s, root);
  if (variant) {
    const first = variant.variants[0];
    return first ? defaultValueFor(first.schema, root) : undefined;
  }
  const type = primaryType(s);
  switch (type) {
    case "object": {
      if (isMapSchema(s)) return {};
      const out: SchemaValues = {};
      for (const [key, prop] of Object.entries(s.properties ?? {})) {
        const v = defaultValueFor(prop, root);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case "array":
      return [];
    case "boolean":
      return false;
    case "string":
    case "number":
    case "integer":
    case "null":
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Deep-merges `values` over the schema defaults so every declared field has a slot. */
export function withDefaults(schema: JsonSchema, values: SchemaValues | undefined): SchemaValues {
  const base = defaultValueFor(schema, schema);
  const baseObj = isRecord(base) ? base : {};
  return mergeDeep(baseObj, values ?? {});
}

function mergeDeep(base: SchemaValues, over: SchemaValues): SchemaValues {
  const out: SchemaValues = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    if (isRecord(b) && isRecord(v) && !Array.isArray(v)) out[k] = mergeDeep(b, v);
    else out[k] = v;
  }
  return out;
}

export function isRecord(value: unknown): value is SchemaValues {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ValidationRule {
  required?: string;
  validate: (value: unknown) => true | string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Validation rules for a leaf field, mirroring the JSON Schema keywords the
 * runtime enforces: required, minimum/maximum (and exclusive variants),
 * multipleOf, integer, minLength/maxLength, pattern, format, enum, minItems/maxItems.
 * Messages name the rule so the person knows the fix.
 */
export function buildRules(
  schema: JsonSchema,
  opts: { required: boolean; label: string },
): ValidationRule {
  const type = primaryType(schema);
  const { required, label } = opts;
  return {
    required: required ? `${label} is required` : undefined,
    validate: (value: unknown) => {
      if (isEmpty(value)) return required ? `${label} is required` : true;
      if ((type === "object" || type === "array") && typeof value === "string")
        return `${label} must be valid JSON`;
      if (type === "number" || type === "integer") {
        if (typeof value !== "number" || !Number.isFinite(value))
          return `${label} must be a number`;
        if (type === "integer" && !Number.isInteger(value))
          return `${label} must be a whole number`;
        if (schema.minimum !== undefined && value < schema.minimum)
          return `${label} must be at least ${schema.minimum}`;
        if (schema.maximum !== undefined && value > schema.maximum)
          return `${label} must be at most ${schema.maximum}`;
        if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
          return `${label} must be greater than ${schema.exclusiveMinimum}`;
        if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
          return `${label} must be less than ${schema.exclusiveMaximum}`;
        if (schema.multipleOf !== undefined) {
          const ratio = value / schema.multipleOf;
          if (Math.abs(ratio - Math.round(ratio)) > 1e-9)
            return `${label} must be a multiple of ${schema.multipleOf}`;
        }
      }
      if (type === "string") {
        if (typeof value !== "string") return `${label} must be text`;
        if (schema.minLength !== undefined && value.length < schema.minLength)
          return `${label} must be at least ${schema.minLength} characters`;
        if (schema.maxLength !== undefined && value.length > schema.maxLength)
          return `${label} must be at most ${schema.maxLength} characters`;
        if (schema.pattern !== undefined) {
          try {
            if (!new RegExp(schema.pattern).test(value))
              return `${label} does not match the expected format`;
          } catch {
            // An invalid pattern is a schema bug, not a value problem.
          }
        }
        if (schema.format === "email" && !EMAIL_RE.test(value))
          return `${label} must be an email address`;
        if (schema.format === "uri" || schema.format === "url") {
          const isTemplate = value.includes("{{");
          if (!isTemplate) {
            try {
              new URL(value);
            } catch {
              return `${label} must be a full URL`;
            }
          }
        }
      }
      if (schema.enum && !schema.enum.some((e) => enumKey(e) === enumKey(value)))
        return `${label} must be one of the listed options`;
      if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems)
          return `${label} needs at least ${schema.minItems} ${schema.minItems === 1 ? "item" : "items"}`;
        if (schema.maxItems !== undefined && value.length > schema.maxItems)
          return `${label} can have at most ${schema.maxItems} items`;
      }
      return true;
    },
  };
}

export type InputModeHint = "email" | "url" | "text" | "numeric" | "decimal";

export function inputModeFor(schema: JsonSchema): InputModeHint | undefined {
  if (schema.format === "email") return "email";
  if (schema.format === "uri" || schema.format === "url") return "url";
  return undefined;
}

const UI_TYPES: readonly string[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
];

function toUiType(type: ContractJsonSchema["type"]): JsonSchema["type"] {
  if (type === undefined) return undefined;
  if (Array.isArray(type)) return type.filter((t) => UI_TYPES.includes(t));
  return UI_TYPES.includes(type) ? type : undefined;
}

function mapSchemas(
  record: Record<string, ContractJsonSchema> | undefined,
): Record<string, JsonSchema> | undefined {
  if (!record) return undefined;
  const out: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(record)) out[k] = fromContractSchema(v);
  return out;
}

/**
 * Narrows a contract `JsonSchema` (workflow-core, with boolean `items` and an
 * open keyword set) into the subset `SchemaForm` renders. Boolean `items` /
 * `additionalProperties` schemas are dropped; every other keyword the form
 * reads is copied, hints included.
 */
export function fromContractSchema(schema: ContractJsonSchema): JsonSchema {
  const out: JsonSchema = {};
  if (schema.$ref !== undefined) out.$ref = schema.$ref;
  const defs = mapSchemas(schema.$defs);
  if (defs) out.$defs = defs;
  const type = toUiType(schema.type);
  if (type !== undefined) out.type = type;
  if (schema.title !== undefined) out.title = schema.title;
  if (schema.description !== undefined) out.description = schema.description;
  if (schema.default !== undefined) out.default = schema.default;
  if (schema.enum !== undefined) out.enum = [...schema.enum];
  if (schema.const !== undefined) out.const = schema.const;
  if (schema.format !== undefined) out.format = schema.format;
  if (schema.pattern !== undefined) out.pattern = schema.pattern;
  if (schema.minLength !== undefined) out.minLength = schema.minLength;
  if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.exclusiveMinimum !== undefined) out.exclusiveMinimum = schema.exclusiveMinimum;
  if (schema.exclusiveMaximum !== undefined) out.exclusiveMaximum = schema.exclusiveMaximum;
  if (schema.multipleOf !== undefined) out.multipleOf = schema.multipleOf;
  const properties = mapSchemas(schema.properties);
  if (properties) out.properties = properties;
  if (schema.required !== undefined) out.required = [...schema.required];
  if (typeof schema.additionalProperties === "boolean")
    out.additionalProperties = schema.additionalProperties;
  else if (schema.additionalProperties)
    out.additionalProperties = fromContractSchema(schema.additionalProperties);
  if (typeof schema.minProperties === "number") out.minProperties = schema.minProperties;
  if (typeof schema.maxProperties === "number") out.maxProperties = schema.maxProperties;
  const propertyNames = schema.propertyNames;
  if (isRecord(propertyNames)) {
    const names: JsonSchema = {};
    if (typeof propertyNames.pattern === "string") names.pattern = propertyNames.pattern;
    if (typeof propertyNames.minLength === "number") names.minLength = propertyNames.minLength;
    if (typeof propertyNames.maxLength === "number") names.maxLength = propertyNames.maxLength;
    out.propertyNames = names;
  }
  if (typeof schema.items === "object") out.items = fromContractSchema(schema.items);
  if (schema.minItems !== undefined) out.minItems = schema.minItems;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  if (schema.uniqueItems !== undefined) out.uniqueItems = schema.uniqueItems;
  if (schema.oneOf) out.oneOf = schema.oneOf.map(fromContractSchema);
  if (schema.anyOf) out.anyOf = schema.anyOf.map(fromContractSchema);
  if (schema.allOf) out.allOf = schema.allOf.map(fromContractSchema);
  const discriminator = schema.discriminator;
  if (isRecord(discriminator) && typeof discriminator.propertyName === "string") {
    out.discriminator = { propertyName: discriminator.propertyName };
  }
  if (schema["x-ui"]) out["x-ui"] = schema["x-ui"];
  const ext = schema["x-ui-ext"];
  if (isRecord(ext)) out["x-ui-ext"] = extensionHints(ext);
  const legacy = schema["x-flowaid"];
  if (isRecord(legacy)) out["x-flowaid"] = legacy;
  if (schema["x-secret"] === true) out["x-secret"] = true;
  return out;
}

/** Keeps the well-typed keys of an untyped `x-ui-ext` block (contract schemas carry it as an unknown keyword). */
function extensionHints(raw: Record<string, unknown>): FormExtensionHints {
  const out: FormExtensionHints = {};
  if (typeof raw.widget === "string") out.widget = raw.widget;
  if (typeof raw.credentialType === "string") out.credentialType = raw.credentialType;
  const modelKind = MODEL_KINDS.find((k) => k === raw.modelKind);
  if (modelKind) out.modelKind = modelKind;
  const language = LANGUAGES.find((l) => l === raw.language);
  if (language) out.language = language;
  return out;
}

// ---------------------------------------------------------------------------
// Paths and `x-ui.showWhen`
// ---------------------------------------------------------------------------

/**
 * Splits a field path into segments. JSON Pointers (`/method`, `/auth/type`,
 * `~1` / `~0` escapes) and dotted form paths (`auth.type`) are both accepted.
 */
export function pathSegments(path: string): string[] {
  if (path === "" || path === "/") return [];
  if (path.startsWith("/"))
    return path
      .slice(1)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  return path.split(".");
}

/** The value at `path` (pointer or dotted) inside `values`, or undefined. */
export function valueAtPath(values: unknown, path: string): unknown {
  let current: unknown = values;
  for (const segment of pathSegments(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Structural equality over JSON values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const ak = Object.keys(a).filter((k) => a[k] !== undefined);
    const bk = Object.keys(b).filter((k) => b[k] !== undefined);
    return ak.length === bk.length && ak.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

export type ShowWhen = NonNullable<UiHints["showWhen"]>;

/**
 * Evaluates `x-ui.showWhen` against the form values (the node config). `path`
 * is a JSON Pointer from the config root (`/method`) or a dotted form path.
 * Every condition given must hold: `equals` (deep equality), `oneOf` (one of
 * the listed values), `truthy` (the value's truthiness matches). With no
 * condition the field shows when the value is truthy.
 */
export function evaluateShowWhen(condition: ShowWhen, values: unknown): boolean {
  const value = valueAtPath(values, condition.path);
  const hasEquals = condition.equals !== undefined;
  const hasOneOf = condition.oneOf !== undefined;
  const hasTruthy = condition.truthy !== undefined;
  if (hasEquals && !jsonEqual(value, condition.equals)) return false;
  if (condition.oneOf && !condition.oneOf.some((v) => jsonEqual(value, v))) return false;
  if (hasTruthy && isTruthy(value) !== condition.truthy) return false;
  if (!hasEquals && !hasOneOf && !hasTruthy) return isTruthy(value);
  return true;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Bindable fields (`x-ui.bindable`)
// ---------------------------------------------------------------------------

/** The binding kinds a `BindingField` toggles between. */
export const BINDING_MODES = ["literal", "ref", "template", "expr"] as const;
export type BindingMode = (typeof BINDING_MODES)[number];

const BINDING_KINDS: ReadonlySet<string> = new Set([
  "literal",
  "ref",
  "template",
  "expr",
  "object",
  "array",
]);

/** True when the value has the shape of a `Binding` (workflow-core `BindingSchema`). */
export function isBinding(value: unknown): value is Binding {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    BINDING_KINDS.has(value.kind) &&
    BindingSchema.safeParse(value).success
  );
}

/** True when a literal must be wrapped as `{ kind: 'literal', value }` so it is not read as a binding. */
function looksLikeBinding(value: unknown): boolean {
  return isRecord(value) && typeof value.kind === "string" && BINDING_KINDS.has(value.kind);
}

/**
 * The value a bindable field stores for a literal: the plain value, or
 * `{ kind: 'literal', value }` when the plain value would itself read as a
 * binding (an object with a binding `kind`).
 */
export function literalFieldValue(value: unknown): unknown {
  if (looksLikeBinding(value)) return { kind: "literal", value };
  return value;
}

/** The literal a bindable field holds (unwrapping `{ kind: 'literal' }`), or undefined for ref/template/expr bindings. */
export function literalOf(value: unknown): unknown {
  if (isBinding(value)) return value.kind === "literal" ? value.value : undefined;
  return value;
}

/** The mode a bindable field's value is in: a ref/template/expr binding, otherwise literal. */
export function bindingModeOf(value: unknown): BindingMode {
  if (
    isBinding(value) &&
    (value.kind === "ref" || value.kind === "template" || value.kind === "expr")
  )
    return value.kind;
  return "literal";
}
