import { describe, expect, it } from "vitest";
import Ajv2020Module from "ajv/dist/2020.js";
import type { JsonSchema } from "@flowaid/workflow-core";
import { describeConfigError, humanizeKey, labelOf } from "./configErrors.js";

const Ajv2020 = Ajv2020Module.default;
const UUID =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["model"],
  properties: {
    model: { type: "string", title: "Model" },
    maxSteps: { type: "integer", minimum: 1, maximum: 50 },
    mode: { enum: ["fast", "careful"] },
    code: { type: "string", pattern: "^[A-Z]{3}$" },
    documents: {
      type: "object",
      properties: {
        sourceIds: {
          type: "array",
          maxItems: 2,
          items: { type: "string", format: "uuid", pattern: UUID },
        },
      },
    },
  },
};

function messages(value: unknown): string[] {
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false,
    verbose: true,
  });
  const validate = ajv.compile(schema as object);
  validate(value);
  return (validate.errors ?? []).map((e) => describeConfigError(e, schema));
}

describe("describeConfigError", () => {
  it("names a uuid in words and quotes the value, never the regex", () => {
    expect(messages({ model: "m", documents: { sourceIds: ["docs"] } })).toEqual([
      'Documents › Source IDs › item 1 must be an ID (a UUID such as 3f2c9a1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b); it is text "docs"',
    ]);
  });

  it("reads every common keyword as a sentence", () => {
    expect(
      messages({ maxSteps: 90, mode: "slow", code: "abc", extra: 1, documents: { sourceIds: [] } }),
    ).toEqual([
      "Model is required",
      "'extra' is not a setting this node has; remove it. Known settings: model, maxSteps, mode, code, documents.",
      "Max steps must be at most 50; it is the number 90",
      'Mode must be one of "fast", "careful"; it is text "slow"',
      'Code is not in the expected format (pattern ^[A-Z]{3}$); it is text "abc"',
    ]);
  });

  it("labels by title, humanised key and list position", () => {
    expect(labelOf("/model", schema)).toBe("Model");
    expect(labelOf("/documents/sourceIds/2", schema)).toBe("Documents › Source IDs › item 3");
    expect(humanizeKey("api_url")).toBe("API URL");
  });
});
