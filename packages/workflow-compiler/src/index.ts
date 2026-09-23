/**
 * `@flowaid/workflow-compiler` — WorkflowDefinition → ExecutionPlan with diagnostics
 * (ARCHITECTURE.md §4). Pure, synchronous and browser-safe.
 */
export { COMPILER_VERSION, compile, validate, type CompileInput } from "./compile.js";
export { severityOf } from "./diagnostics.js";
export { verifyPlan, verifyPlanHash } from "./verify.js";
export { checkBinding, type BindingCheck } from "./checkBinding.js";
export { diff, jsonPatch, type WorkflowDiff } from "./diff.js";
export { migrateDefinition, type MigrateOptions, type MigrationStep } from "./migrate.js";
export {
  ALWAYS,
  NEVER,
  MAX_CLAUSES,
  and as guardAnd,
  or as guardOr,
  exclusive as guardsExclusive,
  implies as guardImplies,
  type Exclusivity,
} from "./guards.js";
export { describeGuard } from "./passes/controlflow.js";
export { classifiedPointers } from "./redaction.js";
