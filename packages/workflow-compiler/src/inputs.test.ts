import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@flowaid/workflow-core";
import { describeInputIssues, inputIssues } from "./inputs.js";

const schema: JsonSchema = {
  type: "object",
  properties: { name: { type: "string" }, n: { type: "integer" } },
  required: ["name"],
};

describe("inputIssues", () => {
  it("accepts a valid input and lists every problem of an invalid one", () => {
    expect(inputIssues(schema, { name: "ops" })).toEqual([]);
    const issues = inputIssues(schema, { n: "x" });
    expect(issues).toEqual([
      { path: "/", message: "must have required property 'name'" },
      { path: "/n", message: "must be integer" },
    ]);
    expect(describeInputIssues(issues)).toBe(
      "/ must have required property 'name'; /n must be integer",
    );
    expect(describeInputIssues(issues, 1)).toBe("/ must have required property 'name'; and 1 more");
  });

  it("reuses one validator for equal schemas arriving as fresh objects", () => {
    for (let i = 0; i < 500; i++)
      expect(inputIssues(JSON.parse(JSON.stringify(schema)) as never, { name: "a" })).toEqual([]);
    // distinct schemas beyond the cache bound still validate
    for (let i = 0; i < 250; i++)
      expect(inputIssues({ type: "object", required: [`k${i}`] }, {})).toHaveLength(1);
  });
});
