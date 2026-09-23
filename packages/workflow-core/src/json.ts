/**
 * §1 JSON, JSON Schema and UI hints.
 *
 * The JSON value model every other contract is built on, the RFC 6901 pointer
 * and RFC 6902 patch schemas, data classes, and the restricted JSON Schema
 * 2020-12 dialect that `z.toJSONSchema()` emits (plus the `x-ui`, `x-dataClass`
 * and `x-secret` flowaid extensions).
 */
import { z } from "zod";

/** A JSON scalar. */
export type JsonPrimitive = string | number | boolean | null;
/** Any JSON document. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
/** A string-keyed JSON object. */
export type JsonObject = { [key: string]: JsonValue };

/** Zod schema for a JSON scalar. */
export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
/** Zod schema for any JSON value (recursive). */
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
/** Zod schema for a JSON object (recursive). */
export const JsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.record(z.string(), JsonValueSchema),
);

/** RFC 6901 JSON Pointer. "" = whole value; "/a/0/b" = value.a[0].b */
export const JsonPointerSchema = z
  .string()
  .regex(/^(\/([^/~]|~0|~1)*)*$/, "JSON Pointer (RFC 6901)");
export type JsonPointer = z.infer<typeof JsonPointerSchema>;

/** RFC 6902 patch operation (used by diagnostics quick-fixes, diffs and the editor undo stack). */
export const JsonPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: JsonPointerSchema, value: JsonValueSchema }),
  z.object({ op: z.literal("remove"), path: JsonPointerSchema }),
  z.object({ op: z.literal("replace"), path: JsonPointerSchema, value: JsonValueSchema }),
  z.object({ op: z.literal("move"), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal("copy"), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal("test"), path: JsonPointerSchema, value: JsonValueSchema }),
]);
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;
/** An ordered list of RFC 6902 operations. */
export type JsonPatch = JsonPatchOp[];

/** Data classes drive write-time redaction and retention. */
export const DataClassSchema = z.enum(["public", "internal", "sensitive", "pii"]);
export type DataClass = z.infer<typeof DataClassSchema>;

/** Inspector rendering hints carried on JSON Schema as `x-ui` (emitted from Zod `.meta({ 'x-ui': … })`). */
export const UiHintsSchema = z.object({
  widget: z
    .enum([
      "text",
      "textarea",
      "template",
      "code",
      "json",
      "number",
      "slider",
      "switch",
      "select",
      "combobox",
      "model",
      "criteria",
      "levels",
      "questions",
      "keyvalue",
      "list",
      "schema",
      "cron",
      "binding",
      "hidden",
    ])
    .optional(),
  language: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  group: z.string().optional(),
  order: z.number().optional(),
  showWhen: z
    .object({
      path: z.string(),
      equals: JsonValueSchema.optional(),
      oneOf: z.array(JsonValueSchema).optional(),
      truthy: z.boolean().optional(),
    })
    .optional(),
  /** Name of a manifest `optionProviders` entry; the inspector calls POST /v1/nodes/:type/options/:name */
  optionsProvider: z.string().optional(),
  /** Field may hold a literal OR a `Binding` (see §3). Compiler resolves it before execute(). */
  bindable: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});
export type UiHints = z.infer<typeof UiHintsSchema>;

/** The seven JSON Schema primitive type names. */
export const JsonSchemaTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);
export type JsonSchemaType = z.infer<typeof JsonSchemaTypeSchema>;

/**
 * JSON Schema 2020-12, restricted to what `z.toJSONSchema()` emits plus flowaid extensions.
 * Unknown keywords are preserved (index signature) but ignored by the subset checker (`W_TYPE_UNVERIFIED`).
 */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: boolean | JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  enum?: JsonPrimitive[];
  const?: JsonValue;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  title?: string;
  description?: string;
  default?: JsonValue;
  examples?: JsonValue[];
  deprecated?: boolean;
  "x-ui"?: UiHints;
  "x-dataClass"?: DataClass;
  "x-secret"?: boolean;
  [keyword: string]: unknown;
}

/** Zod schema validating a {@link JsonSchema} document (recursive; unknown keywords are kept). */
export const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.looseObject({
    $schema: z.string().optional(),
    $id: z.string().optional(),
    $ref: z.string().optional(),
    $defs: z.record(z.string(), JsonSchemaSchema).optional(),
    type: z.union([JsonSchemaTypeSchema, z.array(JsonSchemaTypeSchema)]).optional(),
    properties: z.record(z.string(), JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaSchema]).optional(),
    items: z.union([z.boolean(), JsonSchemaSchema]).optional(),
    prefixItems: z.array(JsonSchemaSchema).optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    uniqueItems: z.boolean().optional(),
    enum: z.array(JsonPrimitiveSchema).optional(),
    const: JsonValueSchema.optional(),
    anyOf: z.array(JsonSchemaSchema).optional(),
    oneOf: z.array(JsonSchemaSchema).optional(),
    allOf: z.array(JsonSchemaSchema).optional(),
    not: JsonSchemaSchema.optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    multipleOf: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    format: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    default: JsonValueSchema.optional(),
    examples: z.array(JsonValueSchema).optional(),
    deprecated: z.boolean().optional(),
    "x-ui": UiHintsSchema.optional(),
    "x-dataClass": DataClassSchema.optional(),
    "x-secret": z.boolean().optional(),
  }),
);
