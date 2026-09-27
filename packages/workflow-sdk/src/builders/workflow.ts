/**
 * `defineWorkflow` (API.md §8.1): assembles a `WorkflowDefinition` from builder output. `nodes`
 * is an object keyed by node id (its insertion order is the node order) or an array of nodes
 * that carry their own `id`. Nothing is normalised: `definitionHash(defineWorkflow(x))` equals
 * the hash of the same definition written as JSON (the round-trip test of `CODE_EXPORT.md` §3).
 * The result is plain data (see `plain`), ready for `JSON.stringify` and schema parsing.
 */
import type { z } from "zod";
import {
  WORKFLOW_SCHEMA_URI,
  type ControlEdge,
  type JsonObject,
  type JsonSchema,
  type Layout,
  type WorkflowDefinitionSchema,
} from "@flowaid/workflow-core";
import type { AnyNodeSpec, SecretSpec, TriggerSpec, VariableSpec } from "./nodes.js";

/** The definition as JSON, before the schema applies its defaults. */
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;

export interface DefineWorkflowOptions {
  id: string;
  name: string;
  description?: string;
  inputs: JsonSchema;
  outputs: JsonSchema;
  nodes: Record<string, AnyNodeSpec> | (AnyNodeSpec & { id: string })[];
  edges?: ControlEdge[];
  variables?: VariableSpec[];
  secrets?: SecretSpec[];
  triggers?: TriggerSpec[];
  execution?: WorkflowDefinitionInput["execution"];
  layout?: Layout;
  metadata?: JsonObject;
}

/**
 * A copy holding only own enumerable data: the non-enumerable helpers builders attach (such as
 * `ref(...).default`) stay out of the definition, where schema parsing would read them.
 */
function plain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plain) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) out[key] = plain(item);
  }
  return out as T;
}

export function defineWorkflow(o: DefineWorkflowOptions): WorkflowDefinitionInput {
  const { nodes, ...rest } = o;
  const list = Array.isArray(nodes)
    ? nodes
    : Object.entries(nodes).map(([id, node]) => {
        if (node.id !== undefined && node.id !== id)
          throw new TypeError(`node '${id}' is built with a different id '${node.id}'`);
        return { ...node, id };
      });
  for (const node of list)
    if (typeof node.id !== "string") throw new TypeError("every node in a node array needs an id");
  return plain({ $schema: WORKFLOW_SCHEMA_URI, ...rest, nodes: list });
}
