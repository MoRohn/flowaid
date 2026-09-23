import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@/types";
import {
  buildRules,
  defaultValueFor,
  groupProperties,
  humanize,
  isMapSchema,
  orderedProperties,
  resolveSchema,
  variantInfo,
  withDefaults,
} from "./schema";

const root: JsonSchema = {
  type: "object",
  $defs: {
    RetryPolicy: {
      type: "object",
      title: "Retry policy",
      properties: { maxAttempts: { type: "integer", default: 3 } },
    },
  },
  properties: {
    timeoutMs: { type: "integer", "x-ui": { collapsed: true, order: 9 } },
    question: { type: "string", "x-ui": { order: 1 } },
    model: { type: "string", "x-ui": { order: 2, group: "Model" } },
    retry: { $ref: "#/$defs/RetryPolicy" },
    enabled: { type: "boolean", default: true },
  },
  required: ["question"],
};

describe("resolveSchema", () => {
  it("follows $ref into $defs and keeps local overrides", () => {
    const resolved = resolveSchema({ $ref: "#/$defs/RetryPolicy", description: "override" }, root);
    expect(resolved.title).toBe("Retry policy");
    expect(resolved.description).toBe("override");
    expect(resolved.$ref).toBeUndefined();
  });

  it("flattens allOf object members", () => {
    const resolved = resolveSchema(
      {
        allOf: [
          { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
          { properties: { b: { type: "number" } } },
        ],
      },
      root,
    );
    expect(Object.keys(resolved.properties ?? {})).toEqual(["a", "b"]);
    expect(resolved.required).toEqual(["a"]);
  });
});

describe("orderedProperties / groupProperties", () => {
  it("orders by x-ui.order then declaration order and records $ref names", () => {
    const props = orderedProperties(root, root);
    expect(props.map((p) => p.key)).toEqual(["question", "model", "timeoutMs", "retry", "enabled"]);
    expect(props.find((p) => p.key === "retry")?.ref).toBe("RetryPolicy");
    expect(props.find((p) => p.key === "question")?.required).toBe(true);
  });

  it("splits groups and collapsed leaves, ungrouped first", () => {
    const groups = groupProperties(orderedProperties(root, root));
    expect(groups.map((g) => g.title)).toEqual([null, "Model"]);
    expect(groups[0]?.fields.map((f) => f.key)).toEqual(["question", "retry", "enabled"]);
    expect(groups[0]?.collapsed.map((f) => f.key)).toEqual(["timeoutMs"]);
    expect(groups[1]?.fields.map((f) => f.key)).toEqual(["model"]);
  });
});

describe("variantInfo", () => {
  const union: JsonSchema = {
    oneOf: [
      {
        type: "object",
        title: "Bearer",
        properties: { type: { const: "bearer" }, token: { type: "string" } },
      },
      { type: "object", properties: { type: { const: "basic" }, user: { type: "string" } } },
    ],
  };
  it("infers the discriminator and labels", () => {
    const info = variantInfo(union, root);
    expect(info?.discriminator).toBe("type");
    expect(info?.variants.map((v) => v.label)).toEqual(["Bearer", "Basic"]);
  });
  it("returns null for unions without a shared const", () => {
    expect(variantInfo({ anyOf: [{ type: "string" }, { type: "number" }] }, root)).toBeNull();
  });
});

describe("defaults", () => {
  it("builds nested defaults and merges values over them", () => {
    expect(defaultValueFor(root, root)).toEqual({ retry: { maxAttempts: 3 }, enabled: true });
    expect(withDefaults(root, { question: "Intent?", retry: { maxAttempts: 5 } })).toEqual({
      question: "Intent?",
      retry: { maxAttempts: 5 },
      enabled: true,
    });
  });
  it("picks the first variant's defaults for unions", () => {
    const schema: JsonSchema = {
      oneOf: [
        {
          type: "object",
          properties: { type: { const: "fixed" }, ms: { type: "integer", default: 500 } },
        },
        { type: "object", properties: { type: { const: "exp" } } },
      ],
    };
    expect(defaultValueFor(schema, schema)).toEqual({ type: "fixed", ms: 500 });
  });
  it("detects free-form maps", () => {
    expect(isMapSchema({ type: "object", additionalProperties: { type: "string" } })).toBe(true);
    expect(isMapSchema({ type: "object", properties: { a: { type: "string" } } })).toBe(false);
    expect(isMapSchema({ type: "object", additionalProperties: false })).toBe(false);
  });
});

describe("buildRules", () => {
  const validate = (schema: JsonSchema, value: unknown, required = false) =>
    buildRules(schema, { required, label: "Field" }).validate(value);

  it("enforces required", () => {
    expect(validate({ type: "string" }, "", true)).toBe("Field is required");
    expect(validate({ type: "string" }, "", false)).toBe(true);
    expect(validate({ type: "array" }, [], true)).toBe("Field is required");
  });
  it("enforces numeric bounds, integers and multiples", () => {
    expect(validate({ type: "number", minimum: 0, maximum: 1 }, 1.2)).toBe(
      "Field must be at most 1",
    );
    expect(validate({ type: "number", minimum: 0 }, -1)).toBe("Field must be at least 0");
    expect(validate({ type: "integer" }, 1.5)).toBe("Field must be a whole number");
    expect(validate({ type: "number", multipleOf: 0.05 }, 0.07)).toBe(
      "Field must be a multiple of 0.05",
    );
    expect(validate({ type: "number", multipleOf: 0.05 }, 0.15)).toBe(true);
    expect(validate({ type: "number", exclusiveMinimum: 0 }, 0)).toBe(
      "Field must be greater than 0",
    );
  });
  it("enforces string length, pattern and formats", () => {
    expect(validate({ type: "string", minLength: 3 }, "ab")).toBe(
      "Field must be at least 3 characters",
    );
    expect(validate({ type: "string", maxLength: 2 }, "abc")).toBe(
      "Field must be at most 2 characters",
    );
    expect(validate({ type: "string", pattern: "^[a-z_]+$" }, "Bad Key")).toBe(
      "Field does not match the expected format",
    );
    expect(validate({ type: "string", format: "email" }, "nope")).toBe(
      "Field must be an email address",
    );
    expect(validate({ type: "string", format: "uri" }, "not a url")).toBe(
      "Field must be a full URL",
    );
    expect(validate({ type: "string", format: "uri" }, "https://api.example.com/v1")).toBe(true);
    expect(validate({ type: "string", format: "uri" }, "{{ variables.baseUrl }}/tickets")).toBe(
      true,
    );
  });
  it("enforces enums, array bounds and JSON drafts", () => {
    expect(validate({ type: "string", enum: ["GET", "POST"] }, "PUT")).toBe(
      "Field must be one of the listed options",
    );
    expect(validate({ type: "array", minItems: 2 }, ["a"])).toBe("Field needs at least 2 items");
    expect(validate({ type: "array", maxItems: 1 }, ["a", "b"])).toBe(
      "Field can have at most 1 items",
    );
    expect(validate({ type: "object" }, "{ not json")).toBe("Field must be valid JSON");
    expect(validate({ type: "object" }, { ok: true })).toBe(true);
  });
  it("humanizes keys", () => {
    expect(humanize("maxAttempts")).toBe("Max attempts");
    expect(humanize("retry_policy")).toBe("Retry policy");
  });
});
