import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@/types";
import { isRecord } from "./schema";
import { createSchemaValidator, labelForPath, toValidationSchema } from "./validation";

const SCHEMA: JsonSchema = {
  type: "object",
  $defs: {
    Header: {
      type: "object",
      properties: { type: { const: "header" }, name: { type: "string", minLength: 1 } },
      required: ["type", "name"],
    },
  },
  properties: {
    method: { type: "string", enum: ["GET", "POST"] },
    body: {
      type: "object",
      title: "Request body",
      required: ["id"],
      "x-ui": { showWhen: { path: "/method", equals: "POST" } },
    },
    threshold: { type: "number", minimum: 0, maximum: 1, "x-ui": { bindable: true } },
    note: { type: "string", minLength: 3 },
    auth: {
      oneOf: [
        { type: "object", properties: { type: { const: "none" } } },
        { $ref: "#/$defs/Header" },
      ],
    },
  },
  required: ["method"],
  additionalProperties: false,
};

describe("createSchemaValidator", () => {
  const validator = createSchemaValidator(SCHEMA);

  it("accepts a valid config", () => {
    expect(validator.validate({ method: "GET", threshold: 0.5, auth: { type: "none" } })).toEqual(
      [],
    );
  });

  it("maps keyword errors to form paths with friendly messages", () => {
    const issues = validator.validate({ threshold: 2, extra: true, note: "ab" });
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "method", keyword: "required", message: "is required" },
        { path: "threshold", keyword: "maximum", message: "must be at most 1" },
        { path: "", keyword: "additionalProperties", message: "has an unknown field “extra”" },
        { path: "note", keyword: "minLength", message: "must be at least 3 characters" },
      ]),
    );
  });

  it("skips fields hidden by showWhen, bindings and unset optional strings", () => {
    expect(validator.validate({ method: "GET", body: { wrong: 1 }, note: "" })).toEqual([]);
    expect(validator.validate({ method: "POST", body: {} })).toEqual([
      { path: "body.id", keyword: "required", message: "is required" },
    ]);
    expect(
      validator.validate({ method: "GET", threshold: { kind: "expr", source: "a.b * 2" } }),
    ).toEqual([]);
    expect(validator.validate({ method: "GET", threshold: { kind: "literal", value: 3 } })).toEqual(
      [{ path: "threshold", keyword: "maximum", message: "must be at most 1" }],
    );
  });

  it("reports only the selected member of a discriminated union", () => {
    expect(validator.validate({ method: "GET", auth: { type: "header" } })).toEqual([
      { path: "auth.name", keyword: "required", message: "is required" },
    ]);
    expect(validator.validate({ method: "GET", auth: { type: "basic" } })).toEqual([
      { path: "auth.type", keyword: "enum", message: "must be one of the listed options" },
    ]);
  });

  it("compiles discriminated unions into if/then branches and drops hint keywords", () => {
    const compiled = toValidationSchema(SCHEMA, SCHEMA);
    const properties = compiled.properties;
    const auth = isRecord(properties) ? properties.auth : undefined;
    expect(isRecord(auth) && auth.oneOf === undefined && Array.isArray(auth.allOf)).toBe(true);
    expect(JSON.stringify(compiled)).not.toContain("x-ui");
  });

  it("names issue paths by title or key", () => {
    expect(labelForPath("body.id", SCHEMA)).toBe("Id");
    expect(labelForPath("body", SCHEMA)).toBe("Request body");
    expect(labelForPath("", SCHEMA)).toBe("Configuration");
  });
});
