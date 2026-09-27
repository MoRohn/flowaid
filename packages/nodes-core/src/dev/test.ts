import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { ExpressionError, type JsonValue } from "@flowaid/workflow-core";
import { compileItemExpr, evalForItem } from "../itemExpr.js";

const CHECK_UI = {
  widget: "code",
  language: "flowexpr-item",
  help: "Must be true. `$scope.item` is the actual value, `$vars` the workflow variables.",
} as const;

export interface TestResult {
  name: string;
  passed: boolean;
  actual?: JsonValue;
  error?: string;
}

export const testNode = defineNode({
  id: "flowaid.dev.test",
  version: "1.0.0",
  metadata: {
    name: "Test",
    description:
      "Runs named assertions (FlowExpr) against a value and fires `pass` or `fail` with every result, without failing the run. Meant for drafts and evaluations, not production traffic.",
    category: "developer",
    icon: "flask-conical",
    tags: ["developer", "test", "assertion"],
    summary: "{{ config.assertions.length }} assertions",
  },
  configSchema: z.strictObject({
    assertions: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(200),
          check: z.string().min(1).max(4000).meta({ "x-ui": CHECK_UI }),
        }),
      )
      .min(1)
      .max(100),
  }),
  inputSchema: z.object({ actual: z.unknown() }),
  outputSchema: z.object({
    passed: z.boolean(),
    results: z.array(
      z.object({
        name: z.string(),
        passed: z.boolean(),
        error: z.string().optional(),
      }),
    ),
    failures: z.int().min(0),
  }),
  controlPorts: [
    { name: "pass", label: "Pass", description: "Every assertion held." },
    { name: "fail", label: "Fail", description: "At least one assertion did not hold." },
  ],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const actual = (input.actual ?? null) as JsonValue;
    const results: TestResult[] = ctx.config.assertions.map((a) => {
      try {
        const held = evalForItem(compileItemExpr(a.check), actual, 0, ctx.vars, () =>
          ctx.clock.now(),
        );
        return { name: a.name, passed: held === true };
      } catch (error) {
        const message =
          error instanceof ExpressionError || error instanceof Error
            ? error.message
            : String(error);
        return { name: a.name, passed: false, error: message };
      }
    });
    const failures = results.filter((r) => !r.passed).length;
    for (const r of results)
      ctx.logger[r.passed ? "info" : "warn"](`${r.passed ? "✓" : "✗"} ${r.name}`, r.error ?? null);
    return Promise.resolve(
      ok(
        { passed: failures === 0, results, failures },
        { route: failures === 0 ? "pass" : "fail" },
      ),
    );
  },
});
