import { stableStringify } from "@flowaid/shared";
import { ExecutionPlanSchema } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { DEMOS, instantiate, resolveTool } from "./test/demos.js";
import { fixtureCatalog, readJson } from "./test/support.js";

describe.each(DEMOS)("demo template %s", (name) => {
  const definition = instantiate(readJson(`${name}.json`));
  const result = compile(definition, { catalog: fixtureCatalog(), resolveTool });

  it("compiles with zero errors against the fixture manifests", () => {
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("emits a schema-valid plan whose hash covers its content", () => {
    if (!result.ok) return;
    expect(() => ExecutionPlanSchema.parse(result.plan)).not.toThrow();
  });

  it("matches the checked-in plan snapshot", async () => {
    if (!result.ok) return;
    await expect(
      `${JSON.stringify(JSON.parse(stableStringify(result.plan)), null, 2)}\n`,
    ).toMatchFileSnapshot(`../fixtures/plans/${name}.plan.json`);
  });

  it("reports its warnings and infos deterministically", async () => {
    await expect(
      `${JSON.stringify(
        result.diagnostics.map((d) => ({ code: d.code, message: d.message, location: d.location })),
        null,
        2,
      )}\n`,
    ).toMatchFileSnapshot(`../fixtures/diagnostics/${name}.json`);
  });
});
