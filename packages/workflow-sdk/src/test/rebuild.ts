/**
 * Re-expresses a workflow definition through the builders only — every node, binding, edge,
 * secret, variable and trigger goes through its builder — so tests can assert that the builders
 * emit exactly the JSON they were given (API.md §8.1).
 */
import type {
  Binding,
  JsonObject,
  JsonSchema,
  JsonValue,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import {
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
  type AnyNodeSpec,
  type TriggerSpec,
  type WorkflowDefinitionInput,
} from "../builders/index.js";

type Raw = Record<string, unknown>;

export function rebuildBinding(b: Binding): Binding {
  switch (b.kind) {
    case "literal":
      return lit(b.value);
    case "template":
      return tpl(b.source);
    case "expr":
      return expr(b.source);
    case "object":
      return obj(
        Object.fromEntries(Object.entries(b.fields).map(([k, v]) => [k, rebuildBinding(v)])),
      );
    case "array":
      return arr(b.items.map(rebuildBinding));
    case "ref": {
      const r = b.ref;
      const built =
        r.kind === "port"
          ? ref(r.node, r.port, r.path)
          : r.kind === "var"
            ? ref.var(r.name)
            : r.kind === "scope"
              ? ref.scope(r.field, r.path)
              : ref.run(r.field);
      return "default" in b && b.default !== undefined ? built.default(b.default) : built;
    }
  }
}

const bindings = (m: unknown) =>
  m === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(m as Record<string, Binding>).map(([k, v]) => [k, rebuildBinding(v)]),
      );

/** Drops `undefined` values so rebuilt objects carry exactly the keys of the source. */
function defined<T extends Raw>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function rebuildNode(raw: Raw): AnyNodeSpec {
  const { id, kind, name, ...rest } = raw as Raw & { id: string; kind: string; name: string };
  const common = { id, ...rest };
  switch (kind) {
    case "input":
      return input(name, common);
    case "output":
      return output(name, { ...common, value: rebuildBinding(rest.value as Binding) });
    case "task": {
      const { type, inputs, ...o } = common as unknown as Raw & { type: string };
      return task(type, defined({ name, ...o, inputs: bindings(inputs) }) as never);
    }
    case "branch":
      return branch(name, common as never);
    case "join":
      return join(name, defined({ ...common, inputs: bindings(rest.inputs) }));
    case "loop": {
      const carry = rest.carry as { initial: JsonValue; next: Record<string, Binding> } | undefined;
      return loop(
        name,
        defined({
          ...common,
          carry: carry && { initial: carry.initial, next: bindings(carry.next) },
          result: bindings(rest.result),
        }) as never,
      );
    }
    case "foreach":
      return foreach(
        name,
        defined({
          ...common,
          items: rebuildBinding(rest.items as Binding),
          collect: rest.collect === undefined ? undefined : rebuildBinding(rest.collect as Binding),
        }) as never,
      );
    case "subflow":
      return subflow(name, defined({ ...common, inputs: bindings(rest.inputs) }) as never);
    case "wait": {
      const until = rest.until as { type: string; at?: Binding };
      return wait(name, {
        ...common,
        until:
          until.type === "timestamp"
            ? { ...until, at: rebuildBinding(until.at as Binding) }
            : until,
      } as never);
    }
    case "human": {
      const mode = rest.mode as { type: string; value?: Binding };
      return human(
        name,
        defined({
          ...common,
          title: rebuildBinding(rest.title as Binding),
          context: bindings(rest.context),
          mode:
            mode.type === "review"
              ? { ...mode, value: rebuildBinding(mode.value as Binding) }
              : mode,
        }) as never,
      );
    }
    case "note": {
      const { text, ...o } = common as unknown as Raw & { text: string };
      return note(text, { name, ...o });
    }
    default:
      throw new Error(`unknown node kind ${kind}`);
  }
}

function rebuildTrigger(t: TriggerSpec): TriggerSpec {
  const { type, ...o } = t;
  switch (type) {
    case "manual":
      return trigger.manual();
    case "webhook":
      return trigger.webhook(o as never);
    case "schedule":
      return trigger.schedule(o as never);
    case "mcp":
      return trigger.mcp(o as never);
    case "event":
      return trigger.event(o as never);
  }
}

/** The definition, rebuilt through the builders (nodes passed as an object keyed by id). */
export function rebuild(
  def: WorkflowDefinitionInput | WorkflowDefinition,
): WorkflowDefinitionInput {
  const d = def;
  const nodes = Object.fromEntries(
    (d.nodes as Raw[]).map((n) => {
      const built = rebuildNode(n);
      const { id: _id, ...rest } = built;
      return [n.id as string, rest];
    }),
  );
  return defineWorkflow(
    defined({
      id: d.id,
      name: d.name,
      description: d.description,
      inputs: d.inputs as JsonSchema,
      outputs: d.outputs as JsonSchema,
      nodes,
      edges: d.edges?.map((e) => edge(e.from, e.to.node, e.id)),
      variables: d.variables?.map(({ name, schema, ...o }) =>
        variable(name, schema as JsonSchema, o),
      ),
      secrets: d.secrets?.map(({ name, credentialType, ...o }) => secret(name, credentialType, o)),
      triggers: d.triggers?.map(rebuildTrigger),
      execution: d.execution,
      layout: d.layout,
      metadata: d.metadata as JsonObject | undefined,
    }),
  );
}
