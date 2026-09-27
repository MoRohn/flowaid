/**
 * Node, edge, secret, variable and trigger builders (API.md §8.1). Every builder returns the
 * `CONTRACTS.ts` JSON with exactly the keys given — no normalisation and no defaults beyond
 * what the schema applies when the definition is parsed. Nodes are built without an id unless
 * `id` is passed; `defineWorkflow` takes the id from the `nodes` object key.
 */
import type { z } from "zod";
import type {
  BranchNodeSchema,
  ControlEdge,
  ForEachNodeSchema,
  HumanNodeSchema,
  InputNodeSchema,
  JoinNodeSchema,
  JsonSchema,
  LoopNodeSchema,
  NoteNodeSchema,
  OutputNodeSchema,
  SecretDeclSchema,
  SubflowNodeSchema,
  TaskNodeSchema,
  TriggerSchema,
  VariableSchema,
  WaitNodeSchema,
} from "@flowaid/workflow-core";

type Spec<S extends z.ZodType> = Omit<z.input<S>, "id" | "kind" | "name"> & { id?: string };
/** A node as written in a definition, with an optional id. */
export type NodeSpec<S extends z.ZodType> = Omit<z.input<S>, "id"> & { id?: string };

export type InputSpec = NodeSpec<typeof InputNodeSchema>;
export type OutputSpec = NodeSpec<typeof OutputNodeSchema>;
export type TaskSpec = NodeSpec<typeof TaskNodeSchema>;
export type BranchSpec = NodeSpec<typeof BranchNodeSchema>;
export type JoinSpec = NodeSpec<typeof JoinNodeSchema>;
export type LoopSpec = NodeSpec<typeof LoopNodeSchema>;
export type ForEachSpec = NodeSpec<typeof ForEachNodeSchema>;
export type SubflowSpec = NodeSpec<typeof SubflowNodeSchema>;
export type WaitSpec = NodeSpec<typeof WaitNodeSchema>;
export type HumanSpec = NodeSpec<typeof HumanNodeSchema>;
export type NoteSpec = NodeSpec<typeof NoteNodeSchema>;
export type AnyNodeSpec =
  | InputSpec
  | OutputSpec
  | TaskSpec
  | BranchSpec
  | JoinSpec
  | LoopSpec
  | ForEachSpec
  | SubflowSpec
  | WaitSpec
  | HumanSpec
  | NoteSpec;

export const input = (name: string, o: Spec<typeof InputNodeSchema> = {}): InputSpec => ({
  kind: "input",
  name,
  ...o,
});

export const output = (name: string, o: Spec<typeof OutputNodeSchema>): OutputSpec => ({
  kind: "output",
  name,
  ...o,
});

/** A task node of node type `type` (e.g. `flowaid.decision.choice`). */
export const task = (
  type: string,
  o: Omit<Spec<typeof TaskNodeSchema>, "type"> & { name: string },
): TaskSpec => ({
  kind: "task",
  type,
  ...o,
});

export const branch = (name: string, o: Spec<typeof BranchNodeSchema>): BranchSpec => ({
  kind: "branch",
  name,
  ...o,
});

export const join = (name: string, o: Spec<typeof JoinNodeSchema> = {}): JoinSpec => ({
  kind: "join",
  name,
  ...o,
});

/** A loop container; body nodes set `parent` to its id. */
export const loop = (name: string, o: Spec<typeof LoopNodeSchema>): LoopSpec => ({
  kind: "loop",
  name,
  ...o,
});

/** A for-each container; body nodes set `parent` to its id. */
export const foreach = (name: string, o: Spec<typeof ForEachNodeSchema>): ForEachSpec => ({
  kind: "foreach",
  name,
  ...o,
});

export const subflow = (name: string, o: Spec<typeof SubflowNodeSchema>): SubflowSpec => ({
  kind: "subflow",
  name,
  ...o,
});

export const wait = (name: string, o: Spec<typeof WaitNodeSchema>): WaitSpec => ({
  kind: "wait",
  name,
  ...o,
});

export const human = (name: string, o: Spec<typeof HumanNodeSchema>): HumanSpec => ({
  kind: "human",
  name,
  ...o,
});

/** A canvas annotation (dropped by the compiler). */
export const note = (
  text: string,
  o: Omit<Spec<typeof NoteNodeSchema>, "text"> & { name: string },
): NoteSpec => ({
  kind: "note",
  text,
  ...o,
});

/** The default edge id: `<node>-<port>-<target>`, cut to the id limit. */
export function edgeId(from: { node: string; port: string }, to: string): string {
  return `${from.node}-${from.port}-${to}`.replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
}

/** A control edge from an output port to a node. */
export const edge = (
  from: { node: string; port: string },
  to: string,
  id?: string,
): ControlEdge => ({
  id: id ?? edgeId(from, to),
  from: { node: from.node, port: from.port },
  to: { node: to },
});

export type SecretSpec = z.input<typeof SecretDeclSchema>;
export const secret = (
  name: string,
  credentialType: string,
  o: Omit<SecretSpec, "name" | "credentialType"> = {},
): SecretSpec => ({ name, credentialType, ...o });

export type VariableSpec = z.input<typeof VariableSchema>;
export const variable = (
  name: string,
  schema: JsonSchema,
  o: Omit<VariableSpec, "name" | "schema"> = {},
): VariableSpec => ({ name, schema, ...o });

export type TriggerSpec = z.input<typeof TriggerSchema>;
type TriggerOf<T extends TriggerSpec["type"]> = Omit<Extract<TriggerSpec, { type: T }>, "type">;

export const trigger = {
  manual: (): TriggerSpec => ({ type: "manual" }),
  webhook: (o: TriggerOf<"webhook">): TriggerSpec => ({ type: "webhook", ...o }),
  schedule: (o: TriggerOf<"schedule">): TriggerSpec => ({ type: "schedule", ...o }),
  mcp: (o: TriggerOf<"mcp">): TriggerSpec => ({ type: "mcp", ...o }),
  event: (o: TriggerOf<"event">): TriggerSpec => ({ type: "event", ...o }),
};
