/**
 * A plain-data {@link EvalScope}: node outputs, variables, container scope
 * fields and run metadata held in JSON, with reference paths projected by
 * JSON Pointer. The runtime builds richer scopes; this one serves tests, the
 * node-sdk harness and the playground.
 */
import type { EvalScope, Ref, RunField, ScopeField } from "../bindings.js";
import type { JsonObject, JsonValue } from "../json.js";
import { projectValue } from "../schema/project.js";
import { expressionError } from "./evaluator.js";

/** Values a {@link createEvalScope} scope resolves references against. */
export interface EvalScopeValues {
  /** Node outputs: `ports[nodeId][portName]`. */
  ports?: Record<string, JsonObject>;
  /** Workflow variables (`$vars.<name>`). */
  vars?: JsonObject;
  /** Innermost container fields (`$scope.item`, `$scope.index`, `$scope.iteration`, `$scope.carry`). */
  scope?: Partial<Record<ScopeField, JsonValue>>;
  /** Run metadata (`$run.<field>`). */
  run?: Partial<Record<RunField, JsonValue>>;
  /** Clock for `now()`; defaults to the system clock. */
  now?: () => string;
}

/**
 * Builds an {@link EvalScope} over plain values. Unknown nodes, ports,
 * variables and fields resolve to `undefined` (→ `UNKNOWN_REF`). Reference
 * paths are projected with {@link projectValue}, the walker the runtime uses,
 * so this scope and the worker agree: a property or index that is absent (or
 * sits below a `null` level) resolves to `null`, like a missing member, while
 * a path that descends into a scalar or applies a non-index token to an array
 * is an `ExpressionError` (`TYPE`) carrying the projector's reason.
 */
export function createEvalScope(values: EvalScopeValues): EvalScope {
  const now = values.now ?? ((): string => new Date().toISOString());
  return {
    resolve(ref: Ref): JsonValue | undefined {
      switch (ref.kind) {
        case "port": {
          const port: JsonValue | undefined = values.ports?.[ref.node]?.[ref.port];
          return port === undefined ? undefined : project(port, ref.path);
        }
        case "var":
          return values.vars?.[ref.name];
        case "scope": {
          const field: JsonValue | undefined = values.scope?.[ref.field];
          return field === undefined ? undefined : project(field, ref.path);
        }
        case "run":
          return values.run?.[ref.field];
      }
    },
    now,
  };
}

function project(value: JsonValue, path: string | undefined): JsonValue {
  if (path === undefined || path === "") return value;
  const projected = projectValue(value, path);
  if (!projected.ok)
    throw expressionError("TYPE", `cannot resolve reference path '${path}': ${projected.reason}`, {
      path,
    });
  return projected.value ?? null;
}
