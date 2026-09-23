/**
 * Plan integrity (ARCHITECTURE.md §5): the worker re-checks every plan before running it. A plan
 * whose content no longer matches its `planHash`, or that the current compiler would not produce
 * from its definition, is `E_PLAN_HASH_MISMATCH`.
 */
import { sha256Json } from "@flowaid/shared";
import type { Diagnostic, ExecutionPlan } from "@flowaid/workflow-core";
import { compile, type CompileInput } from "./compile.js";

function mismatch(message: string): Diagnostic {
  return { code: "E_PLAN_HASH_MISMATCH", severity: "error", message, location: {} };
}

/** The plan's content hashes to its `planHash`. */
export function verifyPlanHash(plan: ExecutionPlan): Diagnostic[] {
  const { planHash, ...rest } = plan;
  const actual = sha256Json(rest);
  return actual === planHash
    ? []
    : [mismatch(`Plan content hashes to ${actual}, not its planHash ${planHash}`)];
}

/** The plan is intact and is exactly what compiling `definition` with `options` produces now. */
export function verifyPlan(
  plan: ExecutionPlan,
  definition: unknown,
  options: CompileInput,
): Diagnostic[] {
  const integrity = verifyPlanHash(plan);
  if (integrity.length > 0) return integrity;
  const result = compile(definition, { ...options, compilerVersion: plan.compilerVersion });
  if (!result.ok) return result.diagnostics.filter((d) => d.severity === "error");
  if (result.plan.planHash !== plan.planHash) {
    return [
      mismatch(
        `The definition now compiles to plan ${result.plan.planHash}, not ${plan.planHash} (a node manifest or the compiler changed)`,
      ),
    ];
  }
  return [];
}
