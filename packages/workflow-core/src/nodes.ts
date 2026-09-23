/**
 * §6 Node kinds and control edges.
 *
 * Control-flow constructs are node kinds owned by the runtime; plugins ship
 * only `task` nodes. Containers (`loop`, `foreach`) are flat: body nodes carry
 * `parent`.
 */
import { z } from "zod";
import { JsonObjectSchema, JsonSchemaSchema, JsonValueSchema } from "./json.js";
import {
  EdgeIdSchema,
  NodeIdSchema,
  NodeTypeIdSchema,
  PortNameSchema,
  SecretNameSchema,
  SemverSchema,
} from "./ids.js";
import { BindingSchema, ExpressionSourceSchema } from "./bindings.js";
import { BoundsSchema, NodePolicySchema } from "./policy.js";

const CommonNodeShape = {
  id: NodeIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  /** Container (loop/foreach) this node belongs to. Absent = root scope. */
  parent: NodeIdSchema.optional(),
  disabled: z.boolean().default(false),
  policy: NodePolicySchema.optional(),
};

/** Workflow entry. Exactly one per workflow, root scope. Output ports: one per top-level property of `inputs`. Control-out: done. */
export const InputNodeSchema = z.object({ ...CommonNodeShape, kind: z.literal("input") });

/** Workflow exit. `value` must be assignable to `outputs`. Several allowed. */
export const OutputNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("output"),
  value: BindingSchema,
  /** Run outcome label (e.g. "rejected"); reported in RUN_COMPLETED.outcome. */
  outcome: z.string().max(64).optional(),
  /** Complete the run as soon as this output completes, cancelling still-running siblings. Default: wait for the root scope to drain. */
  earlyExit: z.boolean().default(false),
});

/** Ordinary executor node. Ports from the manifest (+ port rules). */
export const TaskNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("task"),
  type: NodeTypeIdSchema,
  typeVersion: SemverSchema,
  config: JsonObjectSchema.default({}),
  /** One binding per input port. Unbound optional ports resolve to undefined. */
  inputs: z.record(PortNameSchema, BindingSchema).default({}),
  /** credential slot name (manifest.credentials[].name) → symbolic secret name. */
  credentials: z.record(z.string(), SecretNameSchema).default({}),
});

/** Deterministic branch: cases evaluated in order; `first` fires the first true case (or defaultPort), `all` fires every true case. */
export const BranchNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("branch"),
  mode: z.enum(["first", "all"]).default("first"),
  cases: z
    .array(
      z.object({
        port: PortNameSchema,
        when: ExpressionSourceSchema,
        label: z.string().max(80).optional(),
      }),
    )
    .min(1)
    .max(64),
  defaultPort: PortNameSchema.default("default"),
});

/** Explicit multi-input join. Arrivals = incoming control edges. `inputs` are collected into output `values` (refs to pruned producers yield null here). */
export const JoinNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("join"),
  mode: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("all") }),
      z.object({ type: z.literal("any") }),
      z.object({ type: z.literal("count"), n: z.int().min(1) }),
      /** first arrival wins; private subgraphs of the other inputs are cancelled/skipped. */
      z.object({ type: z.literal("race") }),
    ])
    .default({ type: "all" }),
  timeoutMs: z.int().min(1).optional(),
  inputs: z.record(PortNameSchema, BindingSchema).default({}),
});

/** While/Until/Retry-style loop over a body (nodes with parent === this.id). */
export const LoopNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("loop"),
  /** Object schema of $scope.carry. */
  carrySchema: JsonSchemaSchema,
  carry: z.object({
    initial: JsonObjectSchema,
    /** Evaluated in body scope after each iteration; becomes $scope.carry of the next one. Keys ⊆ carrySchema.properties. */
    next: z.record(z.string(), BindingSchema),
  }),
  /** Evaluated in body scope after each iteration; exposed as output port `result` (from the last iteration). */
  result: z.record(z.string(), BindingSchema).default({}),
  /** Boolean FlowExpr in body scope, evaluated after each iteration; true ⇒ exit via `done`. Absent ⇒ runs to maxIterations (W_LOOP_NO_EXIT). */
  exitWhen: ExpressionSourceSchema.optional(),
  bounds: BoundsSchema,
  /** route ⇒ fire `exhausted` with the last result; fail ⇒ node fails with BOUNDS_EXCEEDED. */
  onExhausted: z.enum(["route", "fail"]).default("route"),
});

/** Map/ForEach over an array with bounded concurrency. Body nodes have parent === this.id. */
export const ForEachNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("foreach"),
  items: BindingSchema,
  /** Schema of $scope.item; inferred from `items` when omitted. */
  itemSchema: JsonSchemaSchema.optional(),
  concurrency: z.int().min(1).max(64).default(4),
  failurePolicy: z.enum(["fail_fast", "collect", "skip"]).default("fail_fast"),
  bounds: BoundsSchema,
  /** Body-scope binding collected per item into output `results`. Required when `results` is consumed. */
  collect: BindingSchema.optional(),
  /** Sequential reduce after collection: FlowExpr over $acc, $value, $index → output `reduced`. */
  reduce: z.object({ initial: JsonValueSchema, expr: ExpressionSourceSchema }).optional(),
});

/** Runs another workflow (deployed version or a pinned version) as a child run. */
export const SubflowNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("subflow"),
  workflowId: z.uuid(),
  version: z.union([z.literal("deployed"), z.object({ versionId: z.uuid() })]).default("deployed"),
  /** child input key → binding */
  inputs: z.record(z.string(), BindingSchema).default({}),
  timeoutMs: z.int().min(1).optional(),
});

/** Durable wait: delay, timestamp or external event (with timeout). */
export const WaitNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("wait"),
  until: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("delay"),
      ms: z
        .int()
        .min(1)
        .max(30 * 24 * 3600_000),
    }),
    z.object({ type: z.literal("timestamp"), at: BindingSchema }),
    z.object({
      type: z.literal("event"),
      eventName: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
      timeoutMs: z.int().min(1),
      payloadSchema: JsonSchemaSchema.optional(),
    }),
  ]),
});

/** What a human node asks the reviewer to do. */
export const HumanModeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approval") }),
  /** Reviewer may edit `value` (validated by `schema`); approved value flows out of port `value`. */
  z.object({ type: z.literal("review"), value: BindingSchema, schema: JsonSchemaSchema }),
  z.object({ type: z.literal("form"), schema: JsonSchemaSchema }),
  z.object({
    type: z.literal("choice"),
    options: z
      .array(z.object({ id: PortNameSchema, label: z.string().max(80) }))
      .min(2)
      .max(32),
  }),
]);
export type HumanMode = z.infer<typeof HumanModeSchema>;

/** Durable human task. Control-outs: approval/review → approved|rejected; form → submitted; choice → one per option id; + expired (onExpire='route'). */
export const HumanNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("human"),
  mode: HumanModeSchema,
  title: BindingSchema,
  context: z.record(z.string(), BindingSchema).default({}),
  /** user ids or "role:<role>" / "group:<id>"; empty = anyone with runs:approve */
  assignees: z.array(z.string()).default([]),
  expiresInMs: z.int().min(1).optional(),
  onExpire: z.enum(["fail", "route", "escalate"]).default("fail"),
  escalation: z.object({ afterMs: z.int().min(1), to: z.array(z.string()).min(1) }).optional(),
  /** Allow a signed single-use review link for non-members. */
  externalReview: z.boolean().default(false),
});

/** Canvas-only annotation; dropped by the compiler. */
export const NoteNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal("note"),
  text: z.string().max(4000),
});

/** Any node of a workflow definition, discriminated by `kind`. */
export const WorkflowNodeSchema = z.discriminatedUnion("kind", [
  InputNodeSchema,
  OutputNodeSchema,
  TaskNodeSchema,
  BranchNodeSchema,
  JoinNodeSchema,
  LoopNodeSchema,
  ForEachNodeSchema,
  SubflowNodeSchema,
  WaitNodeSchema,
  HumanNodeSchema,
  NoteNodeSchema,
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type NodeKind = WorkflowNode["kind"];
export type TaskNode = z.infer<typeof TaskNodeSchema>;
export type HumanNode = z.infer<typeof HumanNodeSchema>;
export type LoopNode = z.infer<typeof LoopNodeSchema>;
export type ForEachNode = z.infer<typeof ForEachNodeSchema>;

/** Control edges are the only edges in a definition. Data edges are derived from bindings. */
export const ControlEdgeSchema = z.object({
  id: EdgeIdSchema,
  from: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  to: z.object({ node: NodeIdSchema }),
});
export type ControlEdge = z.infer<typeof ControlEdgeSchema>;
