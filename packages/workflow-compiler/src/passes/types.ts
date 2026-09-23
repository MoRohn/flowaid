/**
 * Pass 6 — types (ARCHITECTURE.md §4.1, §4.5). Every binding is checked against the schema of
 * the port it feeds with `isSubschema`: a definite mismatch is `E_TYPE_MISMATCH`, an undecidable
 * one `W_TYPE_UNVERIFIED` (the runtime validates on delivery). Output values are checked against
 * the workflow's `outputs`, human review values against their schema.
 */
import {
  formatRef,
  isSubschema,
  type CompiledBinding,
  type JsonSchema,
} from "@flowaid/workflow-core";
import type { CompileContext } from "../context.js";
import { nodePath } from "../diagnostics.js";

const isUnconstrained = (schema: JsonSchema) => Object.keys(schema).length === 0;

export function typesPass(ctx: CompileContext): void {
  const reported = new Set<string>();
  const check = (
    nodeId: string,
    port: string,
    source: JsonSchema,
    target: JsonSchema,
    path: string,
    what: string,
  ) => {
    if (isUnconstrained(target)) return;
    const key = `${nodeId}|${port}|${path}`;
    if (reported.has(key)) return;
    const fit = isSubschema(source, target);
    if (!fit.ok && isSubschema(withoutNull(source), target).ok) {
      // Fits except that it may be null (an index past the end, a missing field).
      reported.add(key);
      ctx.diagnostics.add(
        "W_NULLABLE_INPUT",
        `${what} may be null at run time, which '${port}' does not accept; wrap it in coalesce(…, default)`,
        { nodeId, port, path },
      );
      return;
    }
    if (!fit.ok && isSubschema(source, withoutBounds(target)).ok) {
      // Compatible types; only a length, range, pattern or size bound cannot be proven.
      reported.add(key);
      ctx.diagnostics.add(
        "W_TYPE_UNVERIFIED",
        `${what} may not satisfy the bounds of '${port}' (${fit.reason}); it is validated when the node runs`,
        { nodeId, port, path },
      );
      return;
    }
    if (!fit.ok) {
      reported.add(key);
      ctx.diagnostics.add(
        "E_TYPE_MISMATCH",
        `${what} does not fit the schema of '${port}'${fit.path ? ` at ${fit.path}` : ""}: ${fit.reason}`,
        { nodeId, port, path },
      );
    } else if (!fit.verified) {
      reported.add(key);
      ctx.diagnostics.add(
        "W_TYPE_UNVERIFIED",
        `${what} cannot be proven to fit '${port}' at compile time; it is validated when the node runs`,
        { nodeId, port, path },
      );
    }
  };

  for (const { info, port, compiled, target, path } of ctx.typeChecks) {
    if (ctx.dropped.has(info.node.id)) continue;
    check(info.node.id, port, checkedSchema(compiled), target, path, describe(compiled));
  }

  for (const info of ctx.active()) {
    const node = info.node;
    if (node.kind === "output") {
      const value = info.compiled.get("value");
      if (!value) continue;
      const outputs = ctx.definition.outputs;
      const required = Array.isArray(outputs.required) ? outputs.required : [];
      if (value.kind === "object") {
        const missing = required.filter((key) => !Object.hasOwn(value.fields, key));
        for (const key of missing) {
          ctx.diagnostics.add(
            "E_OUTPUT_UNBOUND",
            `Output '${node.id}' does not set '${key}', which the workflow outputs require`,
            { nodeId: node.id, path: nodePath(info.index, "value") },
            {
              fix: {
                title: `Add ${key}`,
                patch: [
                  {
                    op: "add",
                    path: `${nodePath(info.index, "value", "fields")}/${key}`,
                    value: { kind: "literal", value: null },
                  },
                ],
              },
            },
          );
        }
        if (missing.length > 0) continue;
      }
      const fit = isSubschema(value.schema, outputs);
      if (!fit.ok && isSubschema(withoutNull(value.schema), outputs).ok) {
        ctx.diagnostics.add(
          "W_NULLABLE_INPUT",
          `Output '${node.id}' may produce null${fit.path ? ` at ${fit.path}` : ""}, which the workflow outputs do not accept; add a default`,
          { nodeId: node.id, path: nodePath(info.index, "value") },
        );
        continue;
      }
      if (!fit.ok) {
        ctx.diagnostics.add(
          "E_OUTPUT_SCHEMA_MISMATCH",
          `Output '${node.id}' does not match the workflow outputs${fit.path ? ` at ${fit.path}` : ""}: ${fit.reason}`,
          { nodeId: node.id, path: nodePath(info.index, "value") },
        );
      } else if (!fit.verified && !isUnconstrained(outputs)) {
        ctx.diagnostics.add(
          "W_TYPE_UNVERIFIED",
          `Output '${node.id}' cannot be proven to match the workflow outputs; it is validated at run time`,
          { nodeId: node.id, path: nodePath(info.index, "value") },
        );
      }
    }
    if (node.kind === "human" && node.mode.type === "review") {
      // The proposed value is edited by the reviewer, whose response is validated against the
      // full schema; the proposal only needs a compatible JSON type.
      const value = info.compiled.get("value");
      const type = node.mode.schema.type;
      if (value && type !== undefined) {
        check(
          node.id,
          "value",
          value.schema,
          { type },
          nodePath(info.index, "mode", "value"),
          describe(value),
        );
      }
    }
    if (node.kind === "wait" && node.until.type === "timestamp") {
      const at = info.compiled.get("at");
      if (at)
        check(
          node.id,
          "at",
          at.schema,
          { type: "string" },
          nodePath(info.index, "until", "at"),
          describe(at),
        );
    }
  }
}

const BOUND_KEYWORDS = [
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

/** A copy of `schema` without value bounds, so only types, shapes and enums are compared. */
export function withoutBounds(schema: JsonSchema): JsonSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if ((BOUND_KEYWORDS as readonly string[]).includes(key)) continue;
    if (key === "properties" || key === "$defs" || key === "patternProperties") {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, withoutBounds(v)]),
      );
    } else if (key === "items" || key === "additionalProperties" || key === "not") {
      out[key] =
        typeof value === "object" && value !== null ? withoutBounds(value as JsonSchema) : value;
    } else if (key === "prefixItems" || key === "anyOf" || key === "oneOf" || key === "allOf") {
      out[key] = (value as JsonSchema[]).map(withoutBounds);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** A copy of `schema` that no longer admits null (at any depth of properties and items). */
export function withoutNull(schema: JsonSchema): JsonSchema {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
  const out: Record<string, unknown> = { ...schema };
  if (Array.isArray(schema.type)) {
    const types = (schema.type as string[]).filter((t) => t !== "null");
    if (types.length > 0) out.type = types.length === 1 ? types[0] : types;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const alternatives = schema[key];
    if (Array.isArray(alternatives)) {
      const kept = alternatives.filter(
        (a) => !(typeof a === "object" && a !== null && a.type === "null"),
      );
      if (kept.length > 0) out[key] = kept.map(withoutNull);
    }
  }
  if (typeof schema.properties === "object" && schema.properties !== null) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, withoutNull(v)]),
    );
  }
  if (typeof schema.items === "object" && schema.items !== null && !Array.isArray(schema.items)) {
    out.items = withoutNull(schema.items);
  }
  if (Array.isArray(schema.prefixItems)) out.prefixItems = schema.prefixItems.map(withoutNull);
  return out;
}

/** The schema a binding is checked with: a template is a string at least as long as its literal text. */
function checkedSchema(binding: CompiledBinding): JsonSchema {
  if (binding.kind !== "template") return binding.schema;
  const literal = binding.template.parts.reduce(
    (n, p) => (p.kind === "text" ? n + [...p.text].length : n),
    0,
  );
  return literal > 0 ? { type: "string", minLength: literal } : binding.schema;
}

function describe(binding: CompiledBinding): string {
  switch (binding.kind) {
    case "ref":
      return `'${formatRef(binding.ref)}'`;
    case "literal":
      return "The literal";
    case "template":
      return "The template";
    case "expr":
      return "The expression";
    case "object":
      return "The object";
    case "array":
      return "The list";
  }
}
