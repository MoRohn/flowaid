/**
 * Binding resolution at run time (ARCHITECTURE.md §5.5). A consumer's references resolve from
 * its own scope outward: a `node.port` ref finds the nearest enclosing scope whose plan scope
 * holds the producer (hoisted dependencies guarantee it has settled), takes the port from the
 * producer's output and projects the path with `projectValue` — the runtime twin of the
 * compiler's `projectSchema`. Templates and expressions use workflow-core's bounded evaluator.
 */
import {
  InputMissingError,
  evaluateExpression,
  projectValue,
  renderTemplate,
  type CompiledBinding,
  type EvalScope,
  type ExecutionPlan,
  type JsonObject,
  type JsonValue,
  type Ref,
  type RunField,
  type ScopePath,
} from "@flowaid/workflow-core";
import { nodeState, type SchedulerState } from "./state.js";

/** Run metadata for `$run.*`. */
export type RunMeta = Record<RunField, string | null>;

export interface ResolveContext {
  plan: ExecutionPlan;
  state: SchedulerState;
  /** Scope the consumer runs in. */
  scope: ScopePath;
  vars: Readonly<Record<string, JsonValue>>;
  run: RunMeta;
  now: string;
}

function project(value: JsonValue | undefined, path: string | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (!path) return value;
  const r = projectValue(value, path);
  return r.ok ? r.value : undefined;
}

/** The output value of `node.port` as seen from `scope`, or undefined when absent. */
export function portValue(
  ctx: ResolveContext,
  node: string,
  port: string,
  path?: string,
): JsonValue | undefined {
  const producer = ctx.plan.nodes[node];
  if (!producer) return undefined;
  let path_ = ctx.scope;
  for (;;) {
    const sc = ctx.state.scopes[path_];
    if (sc && sc.planScope === producer.scope) {
      const out = nodeState(ctx.state, path_, node).output;
      if (out === undefined || out === null || typeof out !== "object" || Array.isArray(out))
        return undefined;
      return project(out[port], path);
    }
    if (!sc?.parent) return undefined;
    path_ = sc.parent.path;
  }
}

/** `$scope.*` of the innermost container around `scope`. */
function scopeField(ctx: ResolveContext, field: string): JsonValue | undefined {
  let path_ = ctx.scope;
  for (;;) {
    const sc = ctx.state.scopes[path_];
    if (!sc) return undefined;
    const it = sc.iteration as Record<string, JsonValue | undefined>;
    if (it[field] !== undefined) return it[field];
    if (!sc.parent) return undefined;
    path_ = sc.parent.path;
  }
}

export function evalScope(ctx: ResolveContext): EvalScope {
  return {
    resolve(ref: Ref): JsonValue | undefined {
      switch (ref.kind) {
        case "port":
          return portValue(ctx, ref.node, ref.port, ref.path);
        case "var":
          return ctx.vars[ref.name];
        case "scope":
          return project(scopeField(ctx, ref.field), ref.path);
        case "run":
          return ctx.run[ref.field] ?? null;
      }
    },
    now: () => ctx.now,
  };
}

function describe(ref: Ref): string {
  switch (ref.kind) {
    case "port":
      return `${ref.node}.${ref.port}${ref.path ?? ""}`;
    case "var":
      return `$vars.${ref.name}`;
    case "scope":
      return `$scope.${ref.field}${ref.path ?? ""}`;
    case "run":
      return `$run.${ref.field}`;
  }
}

/** Evaluates a compiled binding. Missing required references throw `InputMissingError`. */
export function evaluateBinding(binding: CompiledBinding, scope: EvalScope): JsonValue | undefined {
  switch (binding.kind) {
    case "literal":
      return binding.value;
    case "ref": {
      const value = scope.resolve(binding.ref);
      if (value !== undefined) return value;
      if (binding.default !== undefined) return binding.default;
      if (binding.optional) return undefined;
      throw new InputMissingError(`${describe(binding.ref)} has no value`, {
        ref: describe(binding.ref),
      });
    }
    case "template":
      return renderTemplate(binding.template, scope);
    case "expr":
      return evaluateExpression(binding.ast, scope);
    case "object": {
      const out: JsonObject = {};
      for (const [key, field] of Object.entries(binding.fields)) {
        const v = evaluateBinding(field, scope);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case "array":
      return binding.items.map((item) => evaluateBinding(item, scope) ?? null);
  }
}

/** Evaluates a record of bindings (task inputs, human context, loop next/result). */
export function evaluateRecord(
  bindings: Readonly<Record<string, CompiledBinding>>,
  scope: EvalScope,
): JsonObject {
  const out: JsonObject = {};
  for (const [key, b] of Object.entries(bindings)) {
    const v = evaluateBinding(b, scope);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Sets `value` at a JSON pointer inside a copy of `target` (config templates and bindings). */
export function setPointer(target: JsonObject, pointer: string, value: JsonValue): JsonObject {
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (tokens.length === 0) return target;
  const root: JsonObject = { ...target };
  let cursor: JsonObject | JsonValue[] = root;
  tokens.forEach((token, i) => {
    const last = i === tokens.length - 1;
    if (Array.isArray(cursor)) {
      const idx = Number(token);
      if (last) cursor[idx] = value;
      else {
        const child = cursor[idx];
        const copy: JsonObject | JsonValue[] = Array.isArray(child)
          ? [...child]
          : { ...((child ?? {}) as JsonObject) };
        cursor[idx] = copy;
        cursor = copy;
      }
    } else {
      if (last) cursor[token] = value;
      else {
        const child = cursor[token];
        const copy: JsonObject | JsonValue[] = Array.isArray(child)
          ? [...child]
          : { ...((child ?? {}) as JsonObject) };
        cursor[token] = copy;
        cursor = copy;
      }
    }
  });
  return root;
}
