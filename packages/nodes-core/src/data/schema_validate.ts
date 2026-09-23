import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { SchemaValidationError, type JsonValue } from "@flowaid/workflow-core";
import { validateJson } from "../jsonSchema.js";

export const schemaValidateNode = defineNode({
  id: "flowaid.data.schema_validate",
  version: "1.0.0",
  metadata: {
    name: "Validate schema",
    description:
      "Checks a value against a JSON Schema (draft 2020-12). Fires `valid` or `invalid` and reports every violation.",
    category: "data",
    icon: "file-check",
    tags: ["data", "validation", "schema"],
    summary: "validate against schema",
  },
  configSchema: z.strictObject({
    schema: z
      .record(z.string(), z.unknown())
      .meta({ "x-ui": { widget: "schema", help: "The JSON Schema `value` must match." } }),
    failOnInvalid: z
      .boolean()
      .default(false)
      .meta({
        "x-ui": { widget: "switch", help: "Fail the node instead of routing to `invalid`." },
      }),
  }),
  inputSchema: z.object({ value: z.unknown() }),
  outputSchema: z.object({
    valid: z.boolean(),
    value: z.unknown(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
  controlPorts: [
    { name: "valid", label: "Valid", description: "The value matches the schema." },
    { name: "invalid", label: "Invalid", description: "The value violates the schema." },
  ],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    const r = validateJson(ctx.config.schema, value);
    const errors = r.ok ? [] : r.errors;
    if (!r.ok && ctx.config.failOnInvalid)
      throw new SchemaValidationError(
        `the value violates the schema (${errors.length} issue${errors.length === 1 ? "" : "s"})`,
        errors,
      );
    return Promise.resolve(
      ok({ valid: r.ok, value, errors }, { route: r.ok ? "valid" : "invalid" }),
    );
  },
});
