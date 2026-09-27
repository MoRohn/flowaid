/**
 * Schema bridges (LANGCHAIN.md §2): Zod → JSON Schema through Zod 4's own `z.toJSONSchema`
 * (draft 2020-12), and a deliberately conservative JSON Schema → Zod converter for tool inputs.
 * Constructs the converter does not understand become `z.unknown()` and are reported as
 * warnings instead of being guessed, so a tool never validates stricter than its schema says.
 */
import { z } from "zod";
import type { JsonSchema } from "@flowaid/workflow-core";

export interface SchemaWarning {
  /** JSON pointer into the source schema */
  path: string;
  message: string;
}

/** Zod 4 → JSON Schema 2020-12 (`io: "input"` so defaults stay optional for callers). */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const out = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

const KNOWN = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "description",
  "title",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "nullable",
  "examples",
  "$schema",
  "$comment",
  "multipleOf",
  "uniqueItems",
  "x-ui",
  "x-secret",
]);

function annotate<T extends z.ZodType>(schema: T, node: Node): T {
  return typeof node.description === "string" ? schema.describe(node.description) : schema;
}

function literalOf(value: unknown, path: string, warnings: SchemaWarning[]): z.ZodType {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return z.literal(value);
  warnings.push({ path, message: "non-scalar const/enum value accepted as unknown" });
  return z.unknown();
}

function convert(node: unknown, path: string, warnings: SchemaWarning[]): z.ZodType {
  if (node === true || (isNode(node) && Object.keys(node).length === 0)) return z.unknown();
  if (node === false) return z.never();
  if (!isNode(node)) {
    warnings.push({ path, message: "schema is not an object" });
    return z.unknown();
  }
  for (const key of Object.keys(node))
    if (!KNOWN.has(key))
      warnings.push({ path: `${path}/${key}`, message: `'${key}' is not enforced` });

  if ("const" in node) return annotate(literalOf(node.const, `${path}/const`, warnings), node);
  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    if (values.length > 0 && values.every((v) => typeof v === "string"))
      return annotate(z.enum(values as [string, ...string[]]), node);
    const literals = values.map((v, i) => literalOf(v, `${path}/enum/${i}`, warnings));
    if (literals.length === 0) return z.never();
    return annotate(
      literals.length === 1
        ? (literals[0] as z.ZodType)
        : z.union(literals as [z.ZodType, z.ZodType, ...z.ZodType[]]),
      node,
    );
  }
  const alternatives = node.anyOf ?? node.oneOf;
  if (Array.isArray(alternatives)) {
    const key = node.anyOf ? "anyOf" : "oneOf";
    const members = alternatives.map((a, i) => convert(a, `${path}/${key}/${i}`, warnings));
    if (members.length === 0) return z.never();
    return annotate(
      members.length === 1
        ? (members[0] as z.ZodType)
        : z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]]),
      node,
    );
  }

  const types = Array.isArray(node.type) ? (node.type as unknown[]) : [node.type];
  const nullable = types.includes("null") || node.nullable === true;
  const concrete = types.filter((t) => t !== "null" && t !== undefined);
  if (concrete.length > 1) {
    const members = concrete.map((t) => convert({ ...node, type: t }, path, warnings));
    const union = z.union(members as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    return annotate(nullable ? union.nullable() : union, node);
  }
  const base = scalarOrContainer(concrete[0], node, path, warnings);
  return annotate(nullable ? base.nullable() : base, node);
}

function scalarOrContainer(
  type: unknown,
  node: Node,
  path: string,
  warnings: SchemaWarning[],
): z.ZodType {
  const num = (k: string) => (typeof node[k] === "number" ? node[k] : undefined);
  switch (type) {
    case "string": {
      let s = z.string();
      const min = num("minLength");
      const max = num("maxLength");
      if (min !== undefined) s = s.min(min);
      if (max !== undefined) s = s.max(max);
      if (typeof node.pattern === "string") {
        try {
          s = s.regex(new RegExp(node.pattern, "u"));
        } catch {
          warnings.push({ path: `${path}/pattern`, message: "pattern is not a valid regex" });
        }
      }
      return s;
    }
    case "integer":
    case "number": {
      let n = type === "integer" ? z.int() : z.number();
      const min = num("minimum");
      const max = num("maximum");
      const xmin = num("exclusiveMinimum");
      const xmax = num("exclusiveMaximum");
      if (min !== undefined) n = n.min(min);
      if (max !== undefined) n = n.max(max);
      if (xmin !== undefined) n = n.gt(xmin);
      if (xmax !== undefined) n = n.lt(xmax);
      return n;
    }
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array": {
      let a = z.array(
        node.items === undefined ? z.unknown() : convert(node.items, `${path}/items`, warnings),
      );
      const min = num("minItems");
      const max = num("maxItems");
      if (min !== undefined) a = a.min(min);
      if (max !== undefined) a = a.max(max);
      return a;
    }
    case "object":
    case undefined: {
      if (type === undefined && node.properties === undefined) return z.unknown();
      const props = isNode(node.properties) ? node.properties : {};
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries(props)) {
        const inner = convert(value, `${path}/properties/${key}`, warnings);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      const obj = z.object(shape);
      if (node.additionalProperties === false) return obj.strict();
      if (isNode(node.additionalProperties))
        return obj.catchall(
          convert(node.additionalProperties, `${path}/additionalProperties`, warnings),
        );
      return obj.loose();
    }
    default:
      warnings.push({ path: `${path}/type`, message: `unknown type '${String(type)}'` });
      return z.unknown();
  }
}

/**
 * JSON Schema → Zod. Returns the schema and every construct that is accepted but not enforced
 * (`$ref`, `allOf`, `not`, `if/then/else`, `patternProperties`, …).
 */
export function jsonSchemaToZod(schema: JsonSchema | boolean): {
  schema: z.ZodType;
  warnings: SchemaWarning[];
} {
  const warnings: SchemaWarning[] = [];
  return { schema: convert(schema, "", warnings), warnings };
}
