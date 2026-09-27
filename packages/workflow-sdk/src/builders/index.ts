/**
 * The workflow builders (API.md §8.1). The set is fixed and total over `WorkflowDefinitionSchema`:
 * every builder returns the `CONTRACTS.ts` node, binding, edge, secret, variable or trigger JSON
 * unchanged — no normalisation and no defaults beyond what the schema applies on parse — so
 * `definitionHash(defineWorkflow(...)) === definitionHash(json)`. `@flowaid/codegen` emits only
 * these builders when it turns a definition into `src/workflow.ts`.
 */
import {
  WORKFLOW_SCHEMA_URI,
  type Binding,
  type BranchNodeSchema,
  type ControlEdge,
  type ForEachNodeSchema,
  type HumanNodeSchema,
  type InputNodeSchema,
  type JoinNodeSchema,
  type JsonSchema,
  type JsonValue,
  type LoopNodeSchema,
  type NoteNodeSchema,
  type OutputNodeSchema,
  type Ref,
  type RunField,
  type ScopeField,
  type SecretDeclSchema,
  type SubflowNodeSchema,
  type TaskNodeSchema,
  type TriggerSchema,
  type VariableSchema,
  type WaitNodeSchema,
  type WorkflowDefinitionSchema,
  type WorkflowNodeSchema,
} from "@flowaid/workflow-core";
import type { z } from "zod";

/**
 * What {@link ref} returns: a `ref` binding that is also callable as `.default(value)` — the same
 * ref with a default (used when the producer was pruned). The helper is non-enumerable and
 * {@link defineWorkflow} serialises it away, so the document stays plain JSON.
 */
export type RefBuilder = Extract<Binding, { kind: "ref" }> & {
  readonly default: JsonValue & ((value: JsonValue) => Binding);
};

type Draft<S extends z.ZodType> = Omit<z.input<S>, "id" | "kind">;
/** A node without its id (the id is its key in `defineWorkflow({ nodes })`). */
export type NodeDraft =
  z.input<typeof WorkflowNodeSchema> extends infer N
    ? N extends unknown
      ? Omit<N, "id">
      : never
    : never;
/** Fields every node kind shares. */
export type CommonOptions = Omit<Draft<typeof InputNodeSchema>, "name">;

// ───────────────────────── bindings ─────────────────────────

function refBuilder(target: Ref): RefBuilder {
  const binding = { kind: "ref" as const, ref: target };
  Object.defineProperty(binding, "default", {
    enumerable: false,
    value: (value: JsonValue): Binding => ({ kind: "ref", ref: target, default: value }),
  });
  return binding as RefBuilder;
}

function portRef(node: string, port: string, path?: string): RefBuilder {
  return refBuilder(
    path === undefined ? { kind: "port", node, port } : { kind: "port", node, port, path },
  );
}

/** References: `ref(node, port, path?)`, `ref.var(name)`, `ref.scope(field, path?)`, `ref.run(field)`. */
export const ref: typeof portRef & {
  var(name: string): RefBuilder;
  scope(field: ScopeField, path?: string): RefBuilder;
  run(field: RunField): RefBuilder;
} = Object.assign(portRef, {
  var: (name: string) => refBuilder({ kind: "var", name }),
  scope: (field: ScopeField, path?: string) =>
    refBuilder(path === undefined ? { kind: "scope", field } : { kind: "scope", field, path }),
  run: (field: RunField) => refBuilder({ kind: "run", field }),
});

/** A literal JSON value. */
export const lit = (value: JsonValue): Binding => ({ kind: "literal", value });
/** A template: text with `{{ expr | filter }}` holes. */
export const tpl = (source: string): Binding => ({ kind: "template", source });
/** A FlowExpr expression. */
export const expr = (source: string): Binding => ({ kind: "expr", source });
/** An object whose fields are bindings. */
export const obj = (fields: Record<string, Binding>): Binding => ({ kind: "object", fields });
/** An array whose items are bindings. */
export const arr = (items: Binding[]): Binding => ({ kind: "array", items });

// ───────────────────────── nodes ─────────────────────────

/** The workflow entry (exactly one, root scope). */
export const input = (name: string, opts: CommonOptions = {}): NodeDraft => ({
  kind: "input",
  name,
  ...opts,
});

/** A workflow exit. */
export const output = (
  name: string,
  opts: Omit<Draft<typeof OutputNodeSchema>, "name">,
): NodeDraft => ({
  kind: "output",
  name,
  ...opts,
});

/** An executor node of a node type (`flowaid.decision.choice`, `flowaid.tools.http`, …). */
export const task = (
  type: string,
  opts: Omit<Draft<typeof TaskNodeSchema>, "type">,
): NodeDraft => ({
  kind: "task",
  type,
  ...opts,
});

/** A deterministic branch over FlowExpr cases. */
export const branch = (
  name: string,
  opts: Omit<Draft<typeof BranchNodeSchema>, "name">,
): NodeDraft => ({
  kind: "branch",
  name,
  ...opts,
});

/** An explicit multi-input join. */
export const join = (
  name: string,
  opts: Omit<Draft<typeof JoinNodeSchema>, "name"> = {},
): NodeDraft => ({
  kind: "join",
  name,
  ...opts,
});

/** A loop container; body nodes carry `parent: <this id>`. */
export const loop = (
  name: string,
  opts: Omit<Draft<typeof LoopNodeSchema>, "name">,
): NodeDraft => ({
  kind: "loop",
  name,
  ...opts,
});

/** A foreach container; body nodes carry `parent: <this id>`. */
export const foreach = (
  name: string,
  opts: Omit<Draft<typeof ForEachNodeSchema>, "name">,
): NodeDraft => ({
  kind: "foreach",
  name,
  ...opts,
});

/** Runs another workflow as a child run. */
export const subflow = (
  name: string,
  opts: Omit<Draft<typeof SubflowNodeSchema>, "name">,
): NodeDraft => ({
  kind: "subflow",
  name,
  ...opts,
});

/** A durable wait (delay, timestamp or event). */
export const wait = (
  name: string,
  opts: Omit<Draft<typeof WaitNodeSchema>, "name">,
): NodeDraft => ({
  kind: "wait",
  name,
  ...opts,
});

/** A durable human task. */
export const human = (
  name: string,
  opts: Omit<Draft<typeof HumanNodeSchema>, "name">,
): NodeDraft => ({
  kind: "human",
  name,
  ...opts,
});

/** A canvas note (dropped by the compiler). */
export const note = (
  text: string,
  opts: Omit<Draft<typeof NoteNodeSchema>, "text">,
): NodeDraft => ({
  kind: "note",
  text,
  ...opts,
});

// ───────────────────────── edges, declarations, triggers ─────────────────────────

/** A control edge from a node's control-out port to another node. */
export const edge = (
  from: { node: string; port: string },
  to: string,
  id: string,
): ControlEdge => ({
  id,
  from: { node: from.node, port: from.port },
  to: { node: to },
});

/** A symbolic secret, bound to a credential per environment. */
export const secret = (
  name: string,
  credentialType: string,
  opts: Omit<z.input<typeof SecretDeclSchema>, "name" | "credentialType"> = {},
): z.input<typeof SecretDeclSchema> => ({ name, credentialType, ...opts });

/** A workflow variable (`$vars.<name>`). */
export const variable = (
  name: string,
  schema: JsonSchema,
  opts: Omit<z.input<typeof VariableSchema>, "name" | "schema"> = {},
): z.input<typeof VariableSchema> => ({ name, schema, ...opts });

type TriggerInput = z.input<typeof TriggerSchema>;
type TriggerOptions<K extends TriggerInput["type"]> = Omit<
  Extract<TriggerInput, { type: K }>,
  "type"
>;

/** How runs start: `trigger.manual()`, `trigger.webhook(...)`, `trigger.schedule(...)`, `trigger.mcp(...)`, `trigger.event(...)`. */
export const trigger = {
  manual: (): TriggerInput => ({ type: "manual" }),
  webhook: (opts: TriggerOptions<"webhook">): TriggerInput => ({ type: "webhook", ...opts }),
  schedule: (opts: TriggerOptions<"schedule">): TriggerInput => ({ type: "schedule", ...opts }),
  mcp: (opts: TriggerOptions<"mcp">): TriggerInput => ({ type: "mcp", ...opts }),
  event: (opts: TriggerOptions<"event">): TriggerInput => ({ type: "event", ...opts }),
};

// ───────────────────────── the document ─────────────────────────

/** The workflow document as `WorkflowDefinitionSchema` accepts it (defaults optional). */
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;

export interface WorkflowSpec extends Omit<WorkflowDefinitionInput, "$schema" | "nodes"> {
  /** Keyed by node id, or an array of nodes that carry their `id`. */
  nodes: Record<string, NodeDraft> | WorkflowDefinitionInput["nodes"];
}

/**
 * The workflow document (`$schema` included), as plain JSON: `nodes` keyed by id become the array
 * form, the `.default()` helpers and `undefined` properties are dropped. Ready for
 * `WorkflowDefinitionSchema.parse`, the compiler, or `POST /v1/workflows`.
 */
export function defineWorkflow(spec: WorkflowSpec): WorkflowDefinitionInput {
  const nodes = Array.isArray(spec.nodes)
    ? spec.nodes
    : Object.entries(spec.nodes).map(([id, node]) => ({ id, ...node }));
  return JSON.parse(
    JSON.stringify({ $schema: WORKFLOW_SCHEMA_URI, ...spec, nodes }),
  ) as WorkflowDefinitionInput;
}

/** Every builder by name (what generated `src/workflow.ts` files import). */
export const builders = {
  arr,
  branch,
  defineWorkflow,
  edge,
  expr,
  foreach,
  human,
  input,
  join,
  lit,
  loop,
  note,
  obj,
  output,
  ref,
  secret,
  subflow,
  task,
  tpl,
  trigger,
  variable,
  wait,
} as const;

/** The builder names, sorted (the import list of generated code). */
export type BuilderName = keyof typeof builders;
export const BUILDER_NAMES = Object.keys(builders).sort() as BuilderName[];
