/**
 * §6 Workflow definition: variables, secrets, triggers, layout, the document
 * schema and its content hash.
 */
import { z } from "zod";
import { sha256Json } from "@flowaid/shared";
import {
  JsonObjectSchema,
  JsonPointerSchema,
  JsonSchemaSchema,
  JsonValueSchema,
  type JsonValue,
} from "./json.js";
import {
  CredentialTypeIdSchema,
  NodeIdSchema,
  SecretNameSchema,
  ToolNameSchema,
  VarNameSchema,
} from "./ids.js";
import { ControlEdgeSchema, WorkflowNodeSchema } from "./nodes.js";
import { ExecutionPolicySchema } from "./policy.js";

/** A workflow variable (`$vars.<name>`), sourced from the definition, the environment or the run input. */
export const VariableSchema = z.object({
  name: VarNameSchema,
  schema: JsonSchemaSchema,
  default: JsonValueSchema.optional(),
  /** definition: value from `default`; environment: from environments.variables / deployment overrides; run_input: from the run request. */
  source: z.enum(["definition", "environment", "run_input"]).default("definition"),
  description: z.string().max(500).optional(),
});
export type Variable = z.infer<typeof VariableSchema>;

/** A symbolic secret the workflow needs, bound to a credential per environment. */
export const SecretDeclSchema = z.object({
  name: SecretNameSchema,
  credentialType: CredentialTypeIdSchema,
  required: z.boolean().default(true),
  description: z.string().max(500).optional(),
});
export type SecretDecl = z.infer<typeof SecretDeclSchema>;

/** How runs of this workflow are started. */
export const TriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("webhook"),
    path: z.string().regex(/^[a-z0-9-]{3,64}$/),
    signature: z.enum(["none", "hmac_sha256", "token"]).default("hmac_sha256"),
    responseMode: z.enum(["sync", "async", "stream"]).default("async"),
    /** JSON pointer into { body, headers, query, method } → workflow input; default "/body". */
    inputPointer: JsonPointerSchema.default("/body"),
    allowedHeaders: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal("schedule"),
    cron: z.string().min(9),
    timezone: z.string().default("UTC"),
    input: JsonValueSchema.default({}),
  }),
  z.object({ type: z.literal("mcp"), toolName: ToolNameSchema, description: z.string().max(1000) }),
  z.object({ type: z.literal("event"), eventName: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

/** Canvas positions and viewport. Ignored by the compiler and by `definitionHash`. */
export const LayoutSchema = z.object({
  nodes: z.record(
    NodeIdSchema,
    z.object({
      x: z.number(),
      y: z.number(),
      w: z.number().optional(),
      h: z.number().optional(),
      collapsed: z.boolean().optional(),
    }),
  ),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

/** The `$schema` value every workflow definition document carries. */
export const WORKFLOW_SCHEMA_URI = "https://flowaid.dev/schemas/workflow/v1" as const;

/** Canonical, UI-independent workflow document. */
export const WorkflowDefinitionSchema = z.object({
  $schema: z.literal(WORKFLOW_SCHEMA_URI),
  id: z.uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(""),
  /** Object schema; each top-level property is an output port of the input node. */
  inputs: JsonSchemaSchema,
  /** Object schema; every output node's `value` must be assignable to it. */
  outputs: JsonSchemaSchema,
  nodes: z.array(WorkflowNodeSchema).min(2),
  edges: z.array(ControlEdgeSchema).default([]),
  variables: z.array(VariableSchema).default([]),
  secrets: z.array(SecretDeclSchema).default([]),
  triggers: z.array(TriggerSchema).default([]),
  execution: ExecutionPolicySchema.prefault({}),
  /** Ignored by the compiler; excluded from definitionHash. */
  layout: LayoutSchema.optional(),
  metadata: JsonObjectSchema.default({}),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/**
 * Converts a value to plain JSON the way `JSON.stringify` would: `undefined`
 * properties are dropped, `undefined` array elements become `null`. Values that
 * are not JSON-representable at all (functions, symbols, bigints, non-finite
 * numbers) are rejected with a `TypeError` so a hash is never computed over a
 * silently altered document.
 */
function toPlainJson(value: unknown, path: string): JsonValue {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value))
        throw new TypeError(`definitionHash: non-finite number at ${path || "(root)"}`);
      return value;
    case "object": {
      if (value === null) return null;
      if (Array.isArray(value)) {
        return value.map((item: unknown, i) =>
          item === undefined ? null : toPlainJson(item, `${path}/${i}`),
        );
      }
      const out: { [key: string]: JsonValue } = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        out[key] = toPlainJson(item, `${path}/${key}`);
      }
      return out;
    }
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(
        `definitionHash: ${typeof value} is not a JSON value at ${path || "(root)"}`,
      );
  }
}

/** Compares two ids for a stable, locale-independent sort. */
function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Throws a `TypeError` naming the first id that appears twice in `items`. */
function assertUniqueIds(items: readonly { id: string }[], what: "node" | "edge"): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new TypeError(`definitionHash: duplicate ${what} id '${item.id}'`);
    seen.add(item.id);
  }
}

/**
 * The canonical form hashed by {@link definitionHash}: `layout` and `metadata`
 * removed, `nodes` and `edges` sorted by id, `undefined` properties dropped.
 * Object key order is irrelevant because the hash uses `stableStringify`.
 * Duplicate node or edge ids have no canonical order and throw a `TypeError`
 * (the compiler reports them as diagnostics; a hash is never computed over
 * such a document).
 */
export function canonicalDefinition(def: WorkflowDefinition): JsonValue {
  const { layout: _layout, metadata: _metadata, nodes, edges, ...rest } = def;
  assertUniqueIds(nodes, "node");
  assertUniqueIds(edges, "edge");
  return toPlainJson(
    {
      ...rest,
      nodes: [...nodes].sort(compareIds),
      edges: [...edges].sort(compareIds),
    },
    "",
  );
}

/**
 * sha256 of the canonical definition (layout and metadata removed, keys
 * sorted, nodes/edges sorted by id).
 *
 * The document is parsed with {@link WorkflowDefinitionSchema} first (RFC-0008),
 * so a raw JSON document and its parsed form hash identically and every
 * schema default (`execution.concurrency`, `description: ''`, trigger
 * defaults, …) is part of the hash whether the author wrote it or not.
 * Parsing is idempotent, so hashing an already parsed definition is free of
 * surprises; a document the schema rejects throws the `ZodError`, and
 * duplicate node/edge ids throw a `TypeError`. Changing a default in
 * `policy.ts`/`definition.ts` therefore changes the hash of every stored
 * definition that omitted it — a hash-changing release (`VERSIONS.md`).
 */
export function definitionHash(def: unknown): string {
  return sha256Json(canonicalDefinition(WorkflowDefinitionSchema.parse(def)));
}
