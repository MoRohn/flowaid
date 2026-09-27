/**
 * Binding builders (API.md §8.1): each returns the `Binding` JSON of `CONTRACTS.ts` §3 as is.
 * `ref(...)` results also carry a non-enumerable `.default(value)` that returns the optional
 * form `{ kind: 'ref', ref, default }`; being non-enumerable it never reaches the JSON, and
 * `defineWorkflow` returns plain data without it (schema parsers read `default` by name).
 */
import type { Binding, JsonValue, Ref, RunField, ScopeField } from "@flowaid/workflow-core";

export type RefBinding = Extract<Binding, { kind: "ref" }>;
/** A ref binding with `.default(value)`. */
export type RefBuilder = RefBinding & { default(value: JsonValue): RefBinding };

function withDefault(ref: Ref): RefBuilder {
  const binding = { kind: "ref" as const, ref };
  Object.defineProperty(binding, "default", {
    enumerable: false,
    value: (value: JsonValue): RefBinding => ({ kind: "ref", ref, default: value }),
  });
  return binding as RefBuilder;
}

/** Output port `port` of node `node`, optionally narrowed by a JSON pointer (`/field/0`). */
export function ref(node: string, port: string, path?: string): RefBuilder {
  return withDefault({ kind: "port", node, port, ...(path !== undefined ? { path } : {}) });
}
/** A workflow variable (`$vars.<name>`). */
ref.var = (name: string): RefBuilder => withDefault({ kind: "var", name });
/** The innermost container's `item` / `index` / `iteration` / `carry`. */
ref.scope = (field: ScopeField, path?: string): RefBuilder =>
  withDefault({ kind: "scope", field, ...(path !== undefined ? { path } : {}) });
/** A run field (`$run.id`, `$run.environment`, …). */
ref.run = (field: RunField): RefBuilder => withDefault({ kind: "run", field });

export const lit = (value: JsonValue): Binding => ({ kind: "literal", value });
/** A template with `{{ expr | filter }}` holes. */
export const tpl = (source: string): Binding => ({ kind: "template", source });
/** A FlowExpr expression. */
export const expr = (source: string): Binding => ({ kind: "expr", source });
export const obj = (fields: Record<string, Binding>): Binding => ({ kind: "object", fields });
export const arr = (items: Binding[]): Binding => ({ kind: "array", items });
