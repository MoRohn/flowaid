/**
 * `compile()` and `validate()` (ARCHITECTURE.md §4). Pure, synchronous and deterministic: the
 * same definition and options always yield the same diagnostics and the same `planHash`, in the
 * browser, the API, the worker and the CLI.
 *
 * The definition is compiled in canonical form (object keys in code-point order), so documents
 * with the same `definitionHash` compile to the same `planHash` however their keys are ordered.
 *
 * Errors stop compilation after their pass group: 1 alone; 2–3; 4–6; 7–8 run only when nothing
 * before them failed. Warnings and infos never block.
 */
import type { CompileOptions, CompileResult, Diagnostic } from "@flowaid/workflow-core";
import { CompileContext } from "./context.js";
import { Diagnostics } from "./diagnostics.js";
import { bindingsPass } from "./passes/bindings.js";
import { catalogPass } from "./passes/catalog.js";
import { controlFlowPass } from "./passes/controlflow.js";
import { emitPass } from "./passes/emit.js";
import { environmentPass } from "./passes/environment.js";
import { schemaPass } from "./passes/schema.js";
import { structurePass } from "./passes/structure.js";
import { typesPass } from "./passes/types.js";
import { sortKeysDeep } from "./util.js";

/** The compiler's own version, recorded in every plan. Bump it when plan output changes. */
export const COMPILER_VERSION = "0.1.0";

/** `CompileOptions` with `level` and `compilerVersion` defaulted. */
export type CompileInput = Omit<CompileOptions, "level" | "compilerVersion"> &
  Partial<Pick<CompileOptions, "level" | "compilerVersion">>;

function withDefaults(options: CompileInput): CompileOptions {
  return { level: "draft", compilerVersion: COMPILER_VERSION, ...options };
}

function internal(diagnostics: Diagnostic[], error: unknown): CompileResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    diagnostics: [
      ...diagnostics,
      {
        code: "E_INTERNAL",
        severity: "error",
        message: `Compiler error: ${message}`,
        location: {},
      },
    ],
  };
}

/** Compiles a workflow definition (any JSON value) into an ExecutionPlan, or reports why it cannot. */
export function compile(definition: unknown, options: CompileInput): CompileResult {
  const opts = withDefaults(options);
  const early = new Diagnostics();
  const parsed = schemaPass(definition, early);
  if (!parsed) return { ok: false, diagnostics: early.list };

  // Compile the canonical form: object key order must never reach the plan (jsonb reorders keys).
  const ctx = new CompileContext(sortKeysDeep(parsed), opts);
  try {
    catalogPass(ctx);
    structurePass(ctx);
    if (ctx.diagnostics.hasErrors()) return { ok: false, diagnostics: ctx.diagnostics.list };

    bindingsPass(ctx);
    const flow = controlFlowPass(ctx);
    typesPass(ctx);
    if (ctx.diagnostics.hasErrors()) return { ok: false, diagnostics: ctx.diagnostics.list };

    environmentPass(ctx);
    if (ctx.diagnostics.hasErrors()) return { ok: false, diagnostics: ctx.diagnostics.list };

    const plan = emitPass(ctx, flow);
    return { ok: true, plan, diagnostics: ctx.diagnostics.list };
  } catch (error) {
    return internal(ctx.diagnostics.list, error);
  }
}

/** Every diagnostic `compile()` would report, without keeping the plan. */
export function validate(definition: unknown, options: CompileInput): Diagnostic[] {
  return compile(definition, options).diagnostics;
}
