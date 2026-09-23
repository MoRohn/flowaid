/**
 * §13 ExecutionPlan: the compiler's output — a flat, id-resolved,
 * schema-checked graph the runtime walks — and the compiler option/result types.
 */
import { z } from "zod";
import {
  DataClassSchema,
  JsonObjectSchema,
  JsonPointerSchema,
  JsonSchemaSchema,
  JsonValueSchema,
  type JsonSchema,
  type JsonValue,
} from "./json.js";
import {
  EdgeIdSchema,
  NodeIdSchema,
  NodeTypeIdSchema,
  PortNameSchema,
  ScopeIdSchema,
  SemverSchema,
  SecretNameSchema,
  ToolNameSchema,
  type SecretName,
  type Semver,
} from "./ids.js";
import {
  CompiledTemplateSchema,
  ExprAstSchema,
  RefSchema,
  type CompiledTemplate,
  type ExprAst,
  type Ref,
} from "./bindings.js";
import {
  IdempotencySchema,
  NodeCapabilitySchema,
  NodeManifestSchema,
  WorkerPoolSchema,
  type NodeCatalog,
} from "./manifest.js";
import {
  BoundsSchema,
  ExecutionPolicySchema,
  PrivacyPolicySchema,
  ProviderHopSchema,
  RetryPolicySchema,
  type ProviderHop,
} from "./policy.js";
import { SecretDeclSchema, TriggerSchema, VariableSchema } from "./definition.js";
import type { Diagnostic } from "./diagnostics.js";

/**
 * Disjunctive normal form over branch predicates: the node can run iff some clause holds.
 * `[[]]` = unconditional (always). `[]` = never (only produced for unreachable nodes, which are dropped).
 */
export const GuardSchema = z.array(z.array(z.object({ node: NodeIdSchema, port: PortNameSchema })));
export type Guard = z.infer<typeof GuardSchema>;

/** A data dependency derived from a binding (or hoisted onto a container). */
export const DataDependencySchema = z.object({
  from: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  to: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  path: JsonPointerSchema.optional(),
  /** Producer may be pruned when the consumer runs; the binding carries a default. */
  optional: z.boolean(),
  via: z.enum(["ref", "template", "expr", "hoisted"]),
});
export type DataDependency = z.infer<typeof DataDependencySchema>;

/** An incoming control edge with its exclusive-group index. */
export const ControlDependencySchema = z.object({
  edgeId: EdgeIdSchema,
  from: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  /** Exclusive group index: OR within a group, AND across groups (ARCHITECTURE.md §5.3). */
  group: z.int().min(0),
});
export type ControlDependency = z.infer<typeof ControlDependencySchema>;

/** A binding after compilation: parsed templates/expressions and the schema it is typed as. */
export type CompiledBinding =
  | { kind: "literal"; value: JsonValue; schema: JsonSchema }
  | { kind: "ref"; ref: Ref; optional: boolean; default?: JsonValue; schema: JsonSchema }
  | { kind: "template"; template: CompiledTemplate; schema: JsonSchema }
  | { kind: "expr"; ast: ExprAst; schema: JsonSchema }
  | { kind: "object"; fields: Record<string, CompiledBinding>; schema: JsonSchema }
  | { kind: "array"; items: CompiledBinding[]; schema: JsonSchema };

/** Zod schema for a {@link CompiledBinding} (recursive). */
export const CompiledBindingSchema: z.ZodType<CompiledBinding> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: JsonValueSchema, schema: JsonSchemaSchema }),
    z.object({
      kind: z.literal("ref"),
      ref: RefSchema,
      optional: z.boolean(),
      default: JsonValueSchema.optional(),
      schema: JsonSchemaSchema,
    }),
    z.object({
      kind: z.literal("template"),
      template: CompiledTemplateSchema,
      schema: JsonSchemaSchema,
    }),
    z.object({ kind: z.literal("expr"), ast: ExprAstSchema, schema: JsonSchemaSchema }),
    z.object({
      kind: z.literal("object"),
      fields: z.record(z.string(), CompiledBindingSchema),
      schema: JsonSchemaSchema,
    }),
    z.object({
      kind: z.literal("array"),
      items: z.array(CompiledBindingSchema),
      schema: JsonSchemaSchema,
    }),
  ]),
);

/** A write-time redaction rule the runtime applies before persisting node input/output. */
export const RedactionRuleSchema = z.object({
  /** JSON pointer into the node's input ("/in/…") or output ("/out/…") value. */
  pointer: JsonPointerSchema,
  dataClass: DataClassSchema,
  mode: z.enum(["mask", "hash", "drop"]),
});
export type RedactionRule = z.infer<typeof RedactionRuleSchema>;

/** Node policy with every workflow/manifest default applied. */
export const ResolvedNodePolicySchema = z.object({
  timeoutMs: z.int().min(1),
  retry: RetryPolicySchema,
  onError: z.enum(["fail", "route", "ignore"]),
  maxCostUsd: z.number().positive().nullable(),
  maxTokens: z.int().min(1).nullable(),
  privacy: PrivacyPolicySchema,
});
export type ResolvedNodePolicy = z.infer<typeof ResolvedNodePolicySchema>;

/** Tool signature resolved at compile time (MCP tool, OpenAPI operation, workflow-as-tool). Same shape as ToolDefinition (§14). */
export const ToolSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mcp"), serverId: z.uuid(), tool: ToolNameSchema }),
  z.object({ kind: z.literal("openapi"), toolsetId: z.uuid(), operationId: ToolNameSchema }),
  z.object({ kind: z.literal("workflow"), workflowId: z.uuid() }),
  z.object({ kind: z.literal("builtin"), id: ToolNameSchema }),
  z.object({ kind: z.literal("http") }),
]);
export type ToolSource = z.infer<typeof ToolSourceSchema>;

/** A tool as exposed to models and the compiler. */
export const ToolDefinitionSchema = z.object({
  name: ToolNameSchema,
  description: z.string().max(4000),
  /** JSON Schema 2020-12 object schema — canonical (Zod derived only for validation). */
  inputSchema: JsonSchemaSchema,
  outputSchema: JsonSchemaSchema.optional(),
  /** "github.read", "stripe.refund" — checked against credential scopes at compile and run time. */
  capability: z.string().optional(),
  idempotency: IdempotencySchema,
  approvalRequired: z.boolean(),
  source: ToolSourceSchema,
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolSignature = ToolDefinition;

/** Kind-specific compiled operation of a plan node. */
export const PlanOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input") }),
  z.object({
    kind: z.literal("output"),
    value: CompiledBindingSchema,
    outcome: z.string().nullable(),
    earlyExit: z.boolean(),
  }),
  z.object({
    kind: z.literal("task"),
    type: NodeTypeIdSchema,
    typeVersion: SemverSchema,
    /** literals only; template/bindable fields are moved into configTemplates/configBindings */
    config: JsonObjectSchema,
    configTemplates: z.record(JsonPointerSchema, CompiledTemplateSchema),
    configBindings: z.record(JsonPointerSchema, CompiledBindingSchema),
    inputs: z.record(PortNameSchema, CompiledBindingSchema),
    credentials: z.record(z.string(), SecretNameSchema),
    manifest: NodeManifestSchema,
    tool: ToolDefinitionSchema.nullable(),
  }),
  z.object({
    kind: z.literal("branch"),
    mode: z.enum(["first", "all"]),
    cases: z.array(z.object({ port: PortNameSchema, when: ExprAstSchema, source: z.string() })),
    defaultPort: PortNameSchema,
  }),
  z.object({
    kind: z.literal("join"),
    mode: z.discriminatedUnion("type", [
      z.object({ type: z.literal("all") }),
      z.object({ type: z.literal("any") }),
      z.object({ type: z.literal("count"), n: z.int().min(1) }),
      z.object({ type: z.literal("race") }),
    ]),
    timeoutMs: z.int().min(1).nullable(),
    inputs: z.record(PortNameSchema, CompiledBindingSchema),
    /** edge id → nodes reachable only through that input (aborted/skipped when it loses a race). */
    privateSubgraphs: z.record(EdgeIdSchema, z.array(NodeIdSchema)),
  }),
  z.object({
    kind: z.literal("loop"),
    carrySchema: JsonSchemaSchema,
    initialCarry: JsonObjectSchema,
    next: z.record(z.string(), CompiledBindingSchema),
    result: z.record(z.string(), CompiledBindingSchema),
    exitWhen: ExprAstSchema.nullable(),
    bounds: BoundsSchema,
    onExhausted: z.enum(["route", "fail"]),
    bodyScope: ScopeIdSchema,
  }),
  z.object({
    kind: z.literal("foreach"),
    items: CompiledBindingSchema,
    itemSchema: JsonSchemaSchema,
    concurrency: z.int().min(1),
    failurePolicy: z.enum(["fail_fast", "collect", "skip"]),
    bounds: BoundsSchema,
    collect: CompiledBindingSchema.nullable(),
    reduce: z.object({ initial: JsonValueSchema, expr: ExprAstSchema }).nullable(),
    bodyScope: ScopeIdSchema,
  }),
  z.object({
    kind: z.literal("subflow"),
    workflowId: z.uuid(),
    /** null = resolve the environment's deployment at run start */
    versionId: z.uuid().nullable(),
    inputs: z.record(z.string(), CompiledBindingSchema),
    inputSchema: JsonSchemaSchema,
    outputSchema: JsonSchemaSchema,
    timeoutMs: z.int().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("wait"),
    until: z.discriminatedUnion("type", [
      z.object({ type: z.literal("delay"), ms: z.int().min(1) }),
      z.object({ type: z.literal("timestamp"), at: CompiledBindingSchema }),
      z.object({
        type: z.literal("event"),
        eventName: z.string(),
        timeoutMs: z.int().min(1),
        payloadSchema: JsonSchemaSchema.nullable(),
      }),
    ]),
  }),
  z.object({
    kind: z.literal("human"),
    mode: z.discriminatedUnion("type", [
      z.object({ type: z.literal("approval") }),
      z.object({
        type: z.literal("review"),
        value: CompiledBindingSchema,
        schema: JsonSchemaSchema,
      }),
      z.object({ type: z.literal("form"), schema: JsonSchemaSchema }),
      z.object({
        type: z.literal("choice"),
        options: z.array(z.object({ id: PortNameSchema, label: z.string() })),
      }),
    ]),
    title: CompiledBindingSchema,
    context: z.record(z.string(), CompiledBindingSchema),
    assignees: z.array(z.string()),
    expiresInMs: z.int().min(1).nullable(),
    onExpire: z.enum(["fail", "route", "escalate"]),
    escalation: z.object({ afterMs: z.int().min(1), to: z.array(z.string()) }).nullable(),
    externalReview: z.boolean(),
  }),
]);
export type PlanOp = z.infer<typeof PlanOpSchema>;

/** One node of the plan with its resolved dependencies, guard, policy and operation. */
export const PlanNodeSchema = z.object({
  id: NodeIdSchema,
  name: z.string(),
  kind: z.enum([
    "input",
    "output",
    "task",
    "branch",
    "join",
    "loop",
    "foreach",
    "subflow",
    "wait",
    "human",
  ]),
  scope: ScopeIdSchema,
  controlIn: z.array(ControlDependencySchema),
  dataIn: z.array(DataDependencySchema),
  controlOut: z.array(PortNameSchema),
  outputs: z.record(PortNameSchema, JsonSchemaSchema),
  /** Nodes activated or fed by this node (for pruning propagation and race subgraphs). */
  successors: z.array(NodeIdSchema),
  guard: GuardSchema,
  policy: ResolvedNodePolicySchema,
  idempotency: IdempotencySchema,
  pool: WorkerPoolSchema,
  batchGroup: z.string().nullable(),
  op: PlanOpSchema,
  redact: z.array(RedactionRuleSchema),
});
export type PlanNode = z.infer<typeof PlanNodeSchema>;

/** A scope of the plan: the root or a container body. */
export const PlanScopeSchema = z.object({
  id: ScopeIdSchema,
  parent: ScopeIdSchema.nullable(),
  kind: z.enum(["root", "loop", "foreach"]),
  /** container node id (null for root) */
  container: NodeIdSchema.nullable(),
  nodes: z.array(NodeIdSchema),
  /** deterministic topological order (ties by node id) */
  order: z.array(NodeIdSchema),
  /** nodes with no in-scope dependencies: ready at scope start */
  entries: z.array(NodeIdSchema),
  outputs: z.array(NodeIdSchema),
});
export type PlanScope = z.infer<typeof PlanScopeSchema>;

/** Decision nodes sharing one state binding, executed as a single provider request. */
export const BatchGroupSchema = z.object({
  id: z.string(),
  scope: ScopeIdSchema,
  nodes: z.array(NodeIdSchema).min(2),
  primary: ProviderHopSchema,
  /** Canonical hash of the shared `state` binding AST. */
  stateBindingHash: z.string(),
});
export type BatchGroup = z.infer<typeof BatchGroupSchema>;

/** The compiled plan. Immutable, content-hashed. */
export const ExecutionPlanSchema = z.object({
  planVersion: z.literal(1),
  workflowId: z.uuid(),
  definitionHash: z.string(),
  /** sha256 of the canonical plan JSON (excludes planHash itself). */
  planHash: z.string(),
  compilerVersion: SemverSchema,
  inputs: JsonSchemaSchema,
  outputs: JsonSchemaSchema,
  execution: ExecutionPolicySchema,
  variables: z.array(VariableSchema),
  secrets: z.array(SecretDeclSchema),
  triggers: z.array(TriggerSchema),
  nodes: z.record(NodeIdSchema, PlanNodeSchema),
  scopes: z.record(ScopeIdSchema, PlanScopeSchema),
  /** Every data dependency (for the canvas and trace viewer); duplicates PlanNode.dataIn flattened. */
  dataEdges: z.array(DataDependencySchema),
  batchGroups: z.record(z.string(), BatchGroupSchema),
  subflows: z.array(
    z.object({ node: NodeIdSchema, workflowId: z.uuid(), versionId: z.uuid().nullable() }),
  ),
  requiredCapabilities: z.array(NodeCapabilitySchema),
  pools: z.array(WorkerPoolSchema),
  /** node type id → version used at compile time */
  catalogSnapshot: z.record(NodeTypeIdSchema, SemverSchema),
  estimate: z.object({ maxCostUsd: z.number().min(0).nullable(), nodeCount: z.int().min(0) }),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/** Compiler entry points (implemented in @flowaid/workflow-compiler; pure, synchronous, browser-safe). */
export interface SubflowSignature {
  versionId: string;
  inputs: JsonSchema;
  outputs: JsonSchema;
  /** workflow ids this version references via subflow nodes (for cycle/depth checks) */
  references: string[];
}
/** Which providers/models are configured in the target workspace. */
export interface ProviderAvailability {
  providers: ReadonlySet<string>;
  models: ReadonlyArray<{ provider: string; model: string; deprecated?: string }>;
}
/** Everything `compile()`/`validate()` need besides the definition. */
export interface CompileOptions {
  catalog: NodeCatalog;
  resolveSubflow?: (
    workflowId: string,
    version: "deployed" | { versionId: string },
  ) => SubflowSignature | undefined;
  resolveTool?: (source: ToolSource) => ToolSignature | undefined;
  providers?: ProviderAvailability;
  /** Secret names bound in the target environment; enables E_SECRET_UNBOUND (publish) / W_SECRET_UNBOUND (draft). */
  boundSecrets?: ReadonlySet<SecretName>;
  /** Workspace default decision chain used when the definition's is empty. */
  defaultDecisions?: { primary: ProviderHop; failover: ProviderHop[] };
  level: "draft" | "publish";
  compilerVersion: Semver;
}
/** Result of `compile()`: a plan with non-error diagnostics, or errors. */
export type CompileResult =
  | { ok: true; plan: ExecutionPlan; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };
