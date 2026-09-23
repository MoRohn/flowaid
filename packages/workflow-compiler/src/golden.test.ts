import { stableStringify } from "@flowaid/shared";
import { ExecutionPlanSchema } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { fixtureCatalog, jsonDiff, readJson } from "./test/support.js";

describe("golden: example-support-reply", () => {
  const definition = readJson("example-support-reply.json");
  const expected = ExecutionPlanSchema.parse(readJson("plans", "example-support-reply.plan.json"));

  it("compiles without errors", () => {
    const result = compile(definition, { catalog: fixtureCatalog() });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("equals the checked-in plan byte for byte after canonicalisation", () => {
    const result = compile(definition, { catalog: fixtureCatalog() });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics, null, 2));
    const diff = jsonDiff(
      JSON.parse(stableStringify(result.plan)),
      JSON.parse(stableStringify(expected)),
    );
    expect(diff).toEqual([]);
    expect(stableStringify(result.plan)).toBe(stableStringify(expected));
  });
});
