/**
 * §4 Ports, manifests and port rules.
 *
 * A `NodeManifest` is the JSON projection of a node definition: what the
 * compiler, the API and the browser see. It never contains code.
 */
import { z } from "zod";
import { DataClassSchema, JsonObjectSchema, JsonPointerSchema, JsonSchemaSchema } from "./json.js";
import {
  CredentialTypeIdSchema,
  NodeTypeIdSchema,
  PortNameSchema,
  SemverSchema,
  type NodeTypeId,
} from "./ids.js";

/** A typed data port (input or output) of a node. */
export const PortSpecSchema = z.object({
  name: PortNameSchema,
  schema: JsonSchemaSchema,
  required: z.boolean(),
  description: z.string().optional(),
  dataClass: DataClassSchema.optional(),
});
export type PortSpec = z.infer<typeof PortSpecSchema>;

/** A control-out port a task may fire via `NodeResult.route`. */
export const ControlPortSpecSchema = z.object({
  name: PortNameSchema,
  label: z.string().optional(),
  description: z.string().optional(),
});
export type ControlPortSpec = z.infer<typeof ControlPortSpecSchema>;

/** Palette category of a node type. */
export const NodeCategorySchema = z.enum([
  "flow",
  "decision",
  "generation",
  "agent",
  "tool",
  "data",
  "retrieval",
  "state",
  "human",
  "safety",
  "developer",
]);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

/** Worker queue class a node executes on. */
export const WorkerPoolSchema = z.enum([
  "general",
  "code",
  "browser",
  "gpu",
  "retrieval",
  "high_memory",
]);
export type WorkerPool = z.infer<typeof WorkerPoolSchema>;

/** Capabilities a node declares; the runtime gates the matching `ctx` services on them. */
export const NodeCapabilitySchema = z.enum([
  "network",
  "credentials",
  "tools",
  "state",
  "artifacts",
  "streaming",
  "decision",
  "generation",
  "sandbox",
  "suspend",
]);
export type NodeCapability = z.infer<typeof NodeCapabilitySchema>;

/**
 * safe  = pure or naturally idempotent; retried and re-executed freely.
 * keyed = the target accepts an idempotency key (ctx.node.idempotencyKey is forwarded); retries allowed.
 * none  = irreversible; never auto-retried, never re-executed after WORKER_LOST.
 */
export const IdempotencySchema = z.enum(["safe", "keyed", "none"]);
export type Idempotency = z.infer<typeof IdempotencySchema>;
/** Static, or selected by a config value (e.g. HTTP method). Resolved by the compiler into PlanNode.idempotency. */
export const IdempotencySpecSchema = z.union([
  IdempotencySchema,
  z.object({
    byConfig: JsonPointerSchema,
    cases: z.record(z.string(), IdempotencySchema),
    default: IdempotencySchema,
  }),
]);
export type IdempotencySpec = z.infer<typeof IdempotencySpecSchema>;

/**
 * Declarative port derivation, evaluated by the compiler from the node's config (JSON only, browser-identical).
 * This replaces `ports(config)` functions; the compiler implements exactly these rule kinds.
 */
export const PortRuleSchema = z.discriminatedUnion("kind", [
  /** config[path] is string[] or an object → one control-out per element / key. */
  z.object({ kind: z.literal("controlPortsFromConfig"), path: JsonPointerSchema }),
  /** config[path] is a JSON Schema → schema of the named output port (Code, Transform, Schema Validate). */
  z.object({
    kind: z.literal("outputSchemaFromConfig"),
    port: PortNameSchema,
    path: JsonPointerSchema,
  }),
  /** config[path] is a JSON Schema → schema of the named input port. */
  z.object({
    kind: z.literal("inputSchemaFromConfig"),
    port: PortNameSchema,
    path: JsonPointerSchema,
  }),
  /** config[path] is Record<id, DecisionQuestion> → output port becomes { [id]: DecisionResult<kind> } (Batch). */
  z.object({
    kind: z.literal("decisionAnswersFromConfig"),
    port: PortNameSchema,
    path: JsonPointerSchema,
  }),
  /** Ports come from CompileOptions.resolveTool(source, config). MCP: config.serverId+config.tool; OpenAPI: config.toolsetId+config.operationId; workflow: config.workflowId. */
  z.object({ kind: z.literal("toolSignature"), source: z.enum(["mcp", "openapi", "workflow"]) }),
]);
export type PortRule = z.infer<typeof PortRuleSchema>;

/** A credential slot a node declares; bound per workflow to a symbolic secret name. */
export const CredentialSlotSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  types: z.array(CredentialTypeIdSchema).min(1),
  required: z.boolean(),
  description: z.string().optional(),
  /** tool capability scopes the credential must grant, e.g. ["github.write"] */
  scopes: z.array(z.string()).optional(),
});
export type CredentialSlot = z.infer<typeof CredentialSlotSchema>;

/** Human-facing metadata of a node type (palette, docs, deprecation). */
export const NodeMetadataSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  category: NodeCategorySchema,
  icon: z.string(),
  tags: z.array(z.string()),
  docsUrl: z.string().optional(),
  author: z.string().optional(),
  deprecated: z
    .object({ since: SemverSchema, message: z.string(), replaceWith: NodeTypeIdSchema.optional() })
    .optional(),
  /** Template over `config` for the node card subtitle, e.g. "{{ config.method }} {{ config.url }}". */
  summary: z.string().optional(),
});
export type NodeMetadata = z.infer<typeof NodeMetadataSchema>;

/** JSON projection of a NodeDefinition. This is what the compiler, the API and the browser see. Never contains code. */
export const NodeManifestSchema = z.object({
  id: NodeTypeIdSchema,
  version: SemverSchema,
  metadata: NodeMetadataSchema,
  configSchema: JsonSchemaSchema,
  inputs: z.array(PortSpecSchema),
  outputs: z.array(PortSpecSchema),
  /** If present any additional named input port is accepted; each value must satisfy `schema`. */
  dynamicInputs: z.object({ schema: JsonSchemaSchema }).optional(),
  /** Extra control-outs a task may fire via NodeResult.route (besides implicit `done`/`failed`). */
  controlPorts: z.array(ControlPortSpecSchema),
  portRules: z.array(PortRuleSchema),
  credentials: z.array(CredentialSlotSchema),
  capabilities: z.array(NodeCapabilitySchema),
  idempotency: IdempotencySpecSchema,
  pool: WorkerPoolSchema,
  /** Marks decision nodes so the compiler applies decision-config rules and batching. */
  decision: z
    .object({
      kind: z.enum([
        "boolean",
        "choice",
        "score",
        "batch",
        "gate",
        "router",
        "consensus",
        "validator",
      ]),
    })
    .optional(),
  generation: z.boolean(),
  streams: z.boolean(),
  optionProviders: z.array(z.string()),
  migrations: z.array(SemverSchema),
  /** Partial NodePolicy applied under the workflow default and above nothing else. */
  defaultPolicy: JsonObjectSchema,
});
export type NodeManifest = z.infer<typeof NodeManifestSchema>;

/** Read-only lookup of node manifests, supplied to the compiler. */
export interface NodeCatalog {
  get(id: NodeTypeId, version?: string): NodeManifest | undefined;
  list(): NodeManifest[];
}
