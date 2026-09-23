/**
 * flowaid — CONTRACTS
 *
 * The single source of truth for `@flowaid/workflow-core` (sections 1–14, 17)
 * and `@flowaid/node-sdk` (sections 15–16). Engineers split this file into the
 * two packages nearly verbatim; section headers name the destination file.
 *
 * Rules that every consumer relies on:
 *   - Zod 4 (4.6.x). `z.infer` = output type. Nested objects whose fields all
 *     carry defaults use `.prefault({})` so `{}` parses to a fully-defaulted object.
 *   - No `any`. Recursive schemas are annotated `z.ZodType<T>` with a hand-written `T`.
 *   - Ids are plain strings validated by regex (not branded) so DB rows, JSON
 *     and UI state interoperate without casts.
 *   - `workflow-core` imports nothing but `zod`. Everything in this file is
 *     browser-safe (no Node built-ins).
 *
 * Target TypeScript: 5.9, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
 */
import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────────────────
 * §1  JSON, JSON Schema, UI hints                (workflow-core/src/json.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);
export const JsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() => z.record(z.string(), JsonValueSchema));

/** RFC 6901 JSON Pointer. "" = whole value; "/a/0/b" = value.a[0].b */
export const JsonPointerSchema = z.string().regex(/^(\/([^/~]|~0|~1)*)*$/, 'JSON Pointer (RFC 6901)');
export type JsonPointer = z.infer<typeof JsonPointerSchema>;

/** RFC 6902 patch operation (used by diagnostics quick-fixes, diffs and the editor undo stack). */
export const JsonPatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: JsonPointerSchema, value: JsonValueSchema }),
  z.object({ op: z.literal('remove'), path: JsonPointerSchema }),
  z.object({ op: z.literal('replace'), path: JsonPointerSchema, value: JsonValueSchema }),
  z.object({ op: z.literal('move'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('copy'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('test'), path: JsonPointerSchema, value: JsonValueSchema }),
]);
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;
export type JsonPatch = JsonPatchOp[];

/** Data classes drive write-time redaction and retention. */
export const DataClassSchema = z.enum(['public', 'internal', 'sensitive', 'pii']);
export type DataClass = z.infer<typeof DataClassSchema>;

/** Inspector rendering hints carried on JSON Schema as `x-ui` (emitted from Zod `.meta({ 'x-ui': … })`). */
export const UiHintsSchema = z.object({
  widget: z
    .enum([
      'text', 'textarea', 'template', 'code', 'json', 'number', 'slider', 'switch', 'select', 'combobox',
      'model', 'criteria', 'levels', 'questions', 'keyvalue', 'list', 'schema', 'cron', 'binding', 'hidden',
    ])
    .optional(),
  language: z.string().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  group: z.string().optional(),
  order: z.number().optional(),
  showWhen: z
    .object({ path: z.string(), equals: JsonValueSchema.optional(), oneOf: z.array(JsonValueSchema).optional(), truthy: z.boolean().optional() })
    .optional(),
  /** Name of a manifest `optionProviders` entry; the inspector calls POST /v1/nodes/:type/options/:name */
  optionsProvider: z.string().optional(),
  /** Field may hold a literal OR a `Binding` (see §3). Compiler resolves it before execute(). */
  bindable: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});
export type UiHints = z.infer<typeof UiHintsSchema>;

export const JsonSchemaTypeSchema = z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
export type JsonSchemaType = z.infer<typeof JsonSchemaTypeSchema>;

/**
 * JSON Schema 2020-12, restricted to what `z.toJSONSchema()` emits plus flowaid extensions.
 * Unknown keywords are preserved (index signature) but ignored by the subset checker (`W_TYPE_UNVERIFIED`).
 */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: boolean | JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  enum?: JsonPrimitive[];
  const?: JsonValue;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  title?: string;
  description?: string;
  default?: JsonValue;
  examples?: JsonValue[];
  deprecated?: boolean;
  'x-ui'?: UiHints;
  'x-dataClass'?: DataClass;
  'x-secret'?: boolean;
  [keyword: string]: unknown;
}

export const JsonSchemaSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.looseObject({
    $schema: z.string().optional(),
    $id: z.string().optional(),
    $ref: z.string().optional(),
    $defs: z.record(z.string(), JsonSchemaSchema).optional(),
    type: z.union([JsonSchemaTypeSchema, z.array(JsonSchemaTypeSchema)]).optional(),
    properties: z.record(z.string(), JsonSchemaSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaSchema]).optional(),
    items: z.union([z.boolean(), JsonSchemaSchema]).optional(),
    prefixItems: z.array(JsonSchemaSchema).optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    uniqueItems: z.boolean().optional(),
    enum: z.array(JsonPrimitiveSchema).optional(),
    const: JsonValueSchema.optional(),
    anyOf: z.array(JsonSchemaSchema).optional(),
    oneOf: z.array(JsonSchemaSchema).optional(),
    allOf: z.array(JsonSchemaSchema).optional(),
    not: JsonSchemaSchema.optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.number().optional(),
    exclusiveMaximum: z.number().optional(),
    multipleOf: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional(),
    format: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    default: JsonValueSchema.optional(),
    examples: z.array(JsonValueSchema).optional(),
    deprecated: z.boolean().optional(),
    'x-ui': UiHintsSchema.optional(),
    'x-dataClass': DataClassSchema.optional(),
    'x-secret': z.boolean().optional(),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
 * §2  Identifiers                                    (workflow-core/src/ids.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

/** snake_case, ≤64 chars. Must not equal an expression function name or keyword (`E_RESERVED_ID`). */
export const NodeIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'node id: snake_case, ≤64');
export const PortNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'port name: snake_case, ≤64');
export const EdgeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
/** "flowaid.decision.choice", "flowaid.tools.http", "@community/slack.post_message" */
export const NodeTypeIdSchema = z.string().regex(/^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/);
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Symbolic secret name declared in `WorkflowDefinition.secrets`, e.g. "TYPESAFE_API_KEY". */
export const SecretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
export const VarNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/);
/** "" (root) | "loop_x#3" | "loop_x#3/each_y#0" */
export const ScopePathSchema = z.string().regex(/^$|^[a-z][a-z0-9_]{0,63}#\d+(\/[a-z][a-z0-9_]{0,63}#\d+)*$/);
/** Plan scope id: "" for the root scope, otherwise the container node id. */
export const ScopeIdSchema = z.string().regex(/^$|^[a-z][a-z0-9_]{0,63}$/);
export const ToolNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const CredentialTypeIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/); // "typesafe.api_key"

export type NodeId = z.infer<typeof NodeIdSchema>;
export type PortName = z.infer<typeof PortNameSchema>;
export type EdgeId = z.infer<typeof EdgeIdSchema>;
export type NodeTypeId = z.infer<typeof NodeTypeIdSchema>;
export type Semver = z.infer<typeof SemverSchema>;
export type SecretName = z.infer<typeof SecretNameSchema>;
export type VarName = z.infer<typeof VarNameSchema>;
export type ScopePath = z.infer<typeof ScopePathSchema>;
export type ScopeId = z.infer<typeof ScopeIdSchema>;

/** Reserved words that cannot be node ids (they are expression keywords or built-in functions). */
export const RESERVED_IDS: ReadonlySet<string> = new Set([
  'true', 'false', 'null', 'in', 'matches', 'len', 'lower', 'upper', 'trim', 'contains', 'starts_with', 'ends_with',
  'split', 'join', 'json', 'parse_json', 'keys', 'values', 'has', 'get', 'coalesce', 'min', 'max', 'abs', 'round',
  'floor', 'ceil', 'sum', 'avg', 'first', 'last', 'filter', 'map', 'any', 'all', 'sort', 'to_number', 'to_string',
  'regex_test', 'regex_match', 'now', 'format_date',
]);

/* ────────────────────────────────────────────────────────────────────────────
 * §3  References, bindings, templates, expressions   (workflow-core/src/bindings.ts, expr/)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A value reference. Canonical JSON form. The compact string form
 * (`intent.decision.value`, `$vars.threshold`, `$scope.item.title`, `$run.id`)
 * is accepted by parseRef() in templates/expressions/SDK and normalised to this.
 */
export const RefSchema = z.discriminatedUnion('kind', [
  /** Output port of a node in the same or an enclosing scope (the input node's ports included). */
  z.object({ kind: z.literal('port'), node: NodeIdSchema, port: PortNameSchema, path: JsonPointerSchema.optional() }),
  z.object({ kind: z.literal('var'), name: VarNameSchema }),
  /** Innermost enclosing container: foreach → item/index; loop → iteration/carry. */
  z.object({ kind: z.literal('scope'), field: z.enum(['item', 'index', 'iteration', 'carry']), path: JsonPointerSchema.optional() }),
  z.object({ kind: z.literal('run'), field: z.enum(['id', 'workflowId', 'workflowVersionId', 'environment', 'startedAt', 'sessionId']) }),
]);
export type Ref = z.infer<typeof RefSchema>;

export declare function parseRef(source: string): { ok: true; ref: Ref } | { ok: false; message: string };
export declare function formatRef(ref: Ref): string;

/** Renders a non-string template hole. `string` (default) requires a scalar leaf at compile time. */
export const TemplateFilterSchema = z.enum(['string', 'json', 'json_pretty', 'join_lines', 'join_comma', 'upper', 'lower', 'trim']);
export type TemplateFilter = z.infer<typeof TemplateFilterSchema>;

/** Source text of a FlowExpr expression (grammar in ARCHITECTURE.md §2.3). Parsed by the compiler. */
export const ExpressionSourceSchema = z.string().min(1).max(4000);
/** Source text of a template: text with `{{ expr | filter }}` holes; `\{{` escapes. */
export const TemplateSourceSchema = z.string().max(64_000);

/**
 * Input binding — the ONLY way data flows between nodes. Data edges on the canvas are derived from bindings.
 * `ref.default` marks the ref optional: when the producer was pruned the default is used (else the consumer is pruned).
 */
export type Binding =
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'ref'; ref: Ref; default?: JsonValue }
  | { kind: 'template'; source: string }
  | { kind: 'expr'; source: string }
  | { kind: 'object'; fields: Record<string, Binding> }
  | { kind: 'array'; items: Binding[] };

export const BindingSchema: z.ZodType<Binding> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: JsonValueSchema }),
    z.object({ kind: z.literal('ref'), ref: RefSchema, default: JsonValueSchema.optional() }),
    z.object({ kind: z.literal('template'), source: TemplateSourceSchema }),
    z.object({ kind: z.literal('expr'), source: ExpressionSourceSchema }),
    z.object({ kind: z.literal('object'), fields: z.record(z.string(), BindingSchema) }),
    z.object({ kind: z.literal('array'), items: z.array(BindingSchema) }),
  ]),
);

/** FlowExpr AST (compiled form stored in the plan). */
export type ExprAst =
  | { kind: 'literal'; value: JsonPrimitive }
  | { kind: 'ref'; ref: Ref }
  | { kind: 'ident'; name: string } // lambda parameter
  | { kind: 'unary'; op: '!' | '-'; operand: ExprAst }
  | { kind: 'binary'; op: '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'matches' | '+' | '-' | '*' | '/' | '%'; left: ExprAst; right: ExprAst }
  | { kind: 'ternary'; test: ExprAst; then: ExprAst; else: ExprAst }
  | { kind: 'member'; object: ExprAst; key: string }
  | { kind: 'index'; object: ExprAst; index: ExprAst }
  | { kind: 'call'; fn: string; args: ExprAst[] }
  | { kind: 'lambda'; param: string; body: ExprAst }
  | { kind: 'array'; items: ExprAst[] }
  | { kind: 'object'; entries: { key: string; value: ExprAst }[] };

export const ExprAstSchema: z.ZodType<ExprAst> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: JsonPrimitiveSchema }),
    z.object({ kind: z.literal('ref'), ref: RefSchema }),
    z.object({ kind: z.literal('ident'), name: z.string() }),
    z.object({ kind: z.literal('unary'), op: z.enum(['!', '-']), operand: ExprAstSchema }),
    z.object({
      kind: z.literal('binary'),
      op: z.enum(['||', '&&', '==', '!=', '<', '<=', '>', '>=', 'in', 'matches', '+', '-', '*', '/', '%']),
      left: ExprAstSchema,
      right: ExprAstSchema,
    }),
    z.object({ kind: z.literal('ternary'), test: ExprAstSchema, then: ExprAstSchema, else: ExprAstSchema }),
    z.object({ kind: z.literal('member'), object: ExprAstSchema, key: z.string() }),
    z.object({ kind: z.literal('index'), object: ExprAstSchema, index: ExprAstSchema }),
    z.object({ kind: z.literal('call'), fn: z.string(), args: z.array(ExprAstSchema) }),
    z.object({ kind: z.literal('lambda'), param: z.string(), body: ExprAstSchema }),
    z.object({ kind: z.literal('array'), items: z.array(ExprAstSchema) }),
    z.object({ kind: z.literal('object'), entries: z.array(z.object({ key: z.string(), value: ExprAstSchema })) }),
  ]),
);

export type TemplatePart =
  | { kind: 'text'; text: string }
  | { kind: 'hole'; expr: ExprAst; filter: TemplateFilter; range: { start: number; end: number } };
export const TemplatePartSchema: z.ZodType<TemplatePart> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('hole'), expr: ExprAstSchema, filter: TemplateFilterSchema, range: z.object({ start: z.int(), end: z.int() }) }),
]);
export const CompiledTemplateSchema = z.object({ parts: z.array(TemplatePartSchema) });
export type CompiledTemplate = z.infer<typeof CompiledTemplateSchema>;

export declare function parseExpression(source: string): { ok: true; ast: ExprAst } | { ok: false; message: string; offset: number };
export declare function parseTemplate(source: string): { ok: true; template: CompiledTemplate } | { ok: false; message: string; offset: number };
export interface EvalScope {
  resolve(ref: Ref): JsonValue | undefined;
  now(): string;
}
/**
 * Total, bounded (RFC-0003): 1 000 000 steps — one per AST node visited, plus one per element
 * for the array built-ins (`sort` n·log₂n) — a 1 MiB result, an 8 MiB input (values read
 * through refs), value nesting ≤ 512; regex patterns are string literals vetted for linear
 * time. Throws ExpressionError.
 */
export declare function evaluateExpression(ast: ExprAst, scope: EvalScope): JsonValue;
export declare function renderTemplate(template: CompiledTemplate, scope: EvalScope): string;

/* ────────────────────────────────────────────────────────────────────────────
 * §4  Ports, manifests, port rules                  (workflow-core/src/manifest.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const PortSpecSchema = z.object({
  name: PortNameSchema,
  schema: JsonSchemaSchema,
  required: z.boolean(),
  description: z.string().optional(),
  dataClass: DataClassSchema.optional(),
});
export type PortSpec = z.infer<typeof PortSpecSchema>;

export const ControlPortSpecSchema = z.object({ name: PortNameSchema, label: z.string().optional(), description: z.string().optional() });
export type ControlPortSpec = z.infer<typeof ControlPortSpecSchema>;

export const NodeCategorySchema = z.enum(['flow', 'decision', 'generation', 'agent', 'tool', 'data', 'retrieval', 'state', 'human', 'safety', 'developer']);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const WorkerPoolSchema = z.enum(['general', 'code', 'browser', 'gpu', 'retrieval', 'high_memory']);
export type WorkerPool = z.infer<typeof WorkerPoolSchema>;

export const NodeCapabilitySchema = z.enum([
  'network', 'credentials', 'tools', 'state', 'artifacts', 'streaming', 'decision', 'generation', 'sandbox', 'suspend',
]);
export type NodeCapability = z.infer<typeof NodeCapabilitySchema>;

/**
 * safe  = pure or naturally idempotent; retried and re-executed freely.
 * keyed = the target accepts an idempotency key (ctx.node.idempotencyKey is forwarded); retries allowed.
 * none  = irreversible; never auto-retried, never re-executed after WORKER_LOST.
 */
export const IdempotencySchema = z.enum(['safe', 'keyed', 'none']);
export type Idempotency = z.infer<typeof IdempotencySchema>;
/** Static, or selected by a config value (e.g. HTTP method). Resolved by the compiler into PlanNode.idempotency. */
export const IdempotencySpecSchema = z.union([
  IdempotencySchema,
  z.object({ byConfig: JsonPointerSchema, cases: z.record(z.string(), IdempotencySchema), default: IdempotencySchema }),
]);
export type IdempotencySpec = z.infer<typeof IdempotencySpecSchema>;

/**
 * Declarative port derivation, evaluated by the compiler from the node's config (JSON only, browser-identical).
 * This replaces `ports(config)` functions; the compiler implements exactly these rule kinds.
 */
export const PortRuleSchema = z.discriminatedUnion('kind', [
  /** config[path] is string[] or an object → one control-out per element / key. */
  z.object({ kind: z.literal('controlPortsFromConfig'), path: JsonPointerSchema }),
  /** config[path] is a JSON Schema → schema of the named output port (Code, Transform, Schema Validate). */
  z.object({ kind: z.literal('outputSchemaFromConfig'), port: PortNameSchema, path: JsonPointerSchema }),
  /** config[path] is a JSON Schema → schema of the named input port. */
  z.object({ kind: z.literal('inputSchemaFromConfig'), port: PortNameSchema, path: JsonPointerSchema }),
  /** config[path] is Record<id, DecisionQuestion> → output port becomes { [id]: DecisionResult<kind> } (Batch). */
  z.object({ kind: z.literal('decisionAnswersFromConfig'), port: PortNameSchema, path: JsonPointerSchema }),
  /** Ports come from CompileOptions.resolveTool(source, config). MCP: config.serverId+config.tool; OpenAPI: config.toolsetId+config.operationId; workflow: config.workflowId. */
  z.object({ kind: z.literal('toolSignature'), source: z.enum(['mcp', 'openapi', 'workflow']) }),
]);
export type PortRule = z.infer<typeof PortRuleSchema>;

export const CredentialSlotSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  types: z.array(CredentialTypeIdSchema).min(1),
  required: z.boolean(),
  description: z.string().optional(),
  /** tool capability scopes the credential must grant, e.g. ["github.write"] */
  scopes: z.array(z.string()).optional(),
});
export type CredentialSlot = z.infer<typeof CredentialSlotSchema>;

export const NodeMetadataSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  category: NodeCategorySchema,
  icon: z.string(),
  tags: z.array(z.string()),
  docsUrl: z.string().optional(),
  author: z.string().optional(),
  deprecated: z.object({ since: SemverSchema, message: z.string(), replaceWith: NodeTypeIdSchema.optional() }).optional(),
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
  decision: z.object({ kind: z.enum(['boolean', 'choice', 'score', 'batch', 'gate', 'router', 'consensus', 'validator']) }).optional(),
  generation: z.boolean(),
  streams: z.boolean(),
  optionProviders: z.array(z.string()),
  migrations: z.array(SemverSchema),
  /** Partial NodePolicy applied under the workflow default and above nothing else. */
  defaultPolicy: JsonObjectSchema,
});
export type NodeManifest = z.infer<typeof NodeManifestSchema>;

export interface NodeCatalog {
  get(id: NodeTypeId, version?: string): NodeManifest | undefined;
  list(): NodeManifest[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * §5  Policies                                       (workflow-core/src/policy.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const ErrorCodeSchema = z.enum([
  // validation / compile
  'WORKFLOW_VALIDATION_ERROR', 'SCHEMA_VALIDATION_ERROR',
  // execution
  'NODE_EXECUTION_ERROR', 'TOOL_EXECUTION_ERROR', 'PROVIDER_ERROR', 'PROVIDER_RATE_LIMITED', 'PROVIDER_OVERLOADED',
  'CREDENTIAL_ERROR', 'TIMEOUT_ERROR', 'RATE_LIMIT_ERROR', 'CANCELLED_ERROR', 'BOUNDS_EXCEEDED',
  'INPUT_MISSING', 'OUTPUT_SCHEMA_MISMATCH', 'EXPRESSION_ERROR', 'SANDBOX_ERROR', 'WORKER_LOST',
  'NONIDEMPOTENT_INTERRUPTED', 'HUMAN_APPROVAL_REQUIRED', 'HUMAN_TASK_EXPIRED', 'SUBFLOW_ERROR', 'NO_OUTPUT', 'NETWORK_ERROR',
  // api
  'NOT_FOUND', 'CONFLICT', 'UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE', 'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const BackoffSchema = z.object({
  type: z.enum(['none', 'fixed', 'exponential']).default('exponential'),
  initialMs: z.int().min(0).default(500),
  maxMs: z.int().min(0).default(30_000),
  factor: z.number().min(1).default(2),
  jitter: z.boolean().default(true),
});
export const RetryPolicySchema = z.object({
  maxAttempts: z.int().min(1).max(20).default(1),
  backoff: BackoffSchema.prefault({}),
  /** Error codes that are retried. Default: every error whose instance has retryable=true. */
  retryOn: z.array(ErrorCodeSchema).optional(),
  /** Permit retries on idempotency 'none' nodes (compiler: W_RETRY_SIDE_EFFECT instead of E_RETRY_ON_IRREVERSIBLE). */
  allowOnIrreversible: z.boolean().default(false),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const PrivacyPolicySchema = z.object({
  sensitive: z.boolean().default(false),
  containsPII: z.boolean().default(false),
  /** Outputs are kept in worker memory for the run only and stored as { "$redacted": true }. */
  doNotPersist: z.boolean().default(false),
  /** JSON pointers into input/output replaced by "[REDACTED]" before persistence. */
  redactFields: z.array(JsonPointerSchema).default([]),
});
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>;

export const NodePolicySchema = z.object({
  timeoutMs: z.int().min(1).optional(),
  retry: RetryPolicySchema.optional(),
  /** route ⇒ fires control-out `failed`; ignore ⇒ outputs null, fires `done`. */
  onError: z.enum(['fail', 'route', 'ignore']).default('fail'),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
  pool: WorkerPoolSchema.optional(),
  privacy: PrivacyPolicySchema.optional(),
});
export type NodePolicy = z.infer<typeof NodePolicySchema>;

export const ModelRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** One hop of a decision failover chain. `human` suspends the node for a reviewer and is always last. */
export const ProviderHopSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('typesafe'), model: z.string().default('jev-latest') }),
  z.object({ provider: z.literal('llm'), model: ModelRefSchema }),
  z.object({ provider: z.literal('rule') }),
  z.object({ provider: z.literal('human') }),
  z.object({ provider: z.literal('custom'), id: z.string().min(1), model: z.string().optional() }),
]);
export type ProviderHop = z.infer<typeof ProviderHopSchema>;

export const DecisionPolicySchema = z.object({
  primary: ProviderHopSchema.default({ provider: 'typesafe', model: 'jev-latest' }),
  failover: z.array(ProviderHopSchema).default([]),
  /** Compiler-computed batch groups are executed as one provider request. */
  batching: z.boolean().default(true),
});

export const ExecutionPolicySchema = z.object({
  timeoutMs: z.int().min(1000).default(15 * 60_000),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
  /** Global guard against runaway graphs (counts every node run incl. iterations). */
  maxNodeRuns: z.int().min(1).max(100_000).default(2_000),
  maxSubflowDepth: z.int().min(1).max(16).default(4),
  /** Concurrent node executions per run. */
  concurrency: z.int().min(1).max(64).default(8),
  defaultRetry: RetryPolicySchema.prefault({}),
  defaultNodeTimeoutMs: z.int().min(1).default(120_000),
  decisions: DecisionPolicySchema.prefault({}),
  privacy: PrivacyPolicySchema.prefault({}),
  retention: z.enum(['standard', 'short', 'long', 'none']).default('standard'),
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export const BoundsSchema = z.object({
  maxIterations: z.int().min(1).max(10_000),
  timeoutMs: z.int().min(1).optional(),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
});
export type Bounds = z.infer<typeof BoundsSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §6  Nodes, edges, definition                       (workflow-core/src/nodes.ts, definition.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

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
export const InputNodeSchema = z.object({ ...CommonNodeShape, kind: z.literal('input') });

/** Workflow exit. `value` must be assignable to `outputs`. Several allowed. */
export const OutputNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('output'),
  value: BindingSchema,
  /** Run outcome label (e.g. "rejected"); reported in RUN_COMPLETED.outcome. */
  outcome: z.string().max(64).optional(),
  /** Complete the run as soon as this output completes, cancelling still-running siblings. Default: wait for the root scope to drain. */
  earlyExit: z.boolean().default(false),
});

/** Ordinary executor node. Ports from the manifest (+ port rules). */
export const TaskNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('task'),
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
  kind: z.literal('branch'),
  mode: z.enum(['first', 'all']).default('first'),
  cases: z.array(z.object({ port: PortNameSchema, when: ExpressionSourceSchema, label: z.string().max(80).optional() })).min(1).max(64),
  defaultPort: PortNameSchema.default('default'),
});

/** Explicit multi-input join. Arrivals = incoming control edges. `inputs` are collected into output `values` (refs to pruned producers yield null here). */
export const JoinNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('join'),
  mode: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('all') }),
      z.object({ type: z.literal('any') }),
      z.object({ type: z.literal('count'), n: z.int().min(1) }),
      /** first arrival wins; private subgraphs of the other inputs are cancelled/skipped. */
      z.object({ type: z.literal('race') }),
    ])
    .default({ type: 'all' }),
  timeoutMs: z.int().min(1).optional(),
  inputs: z.record(PortNameSchema, BindingSchema).default({}),
});

/** While/Until/Retry-style loop over a body (nodes with parent === this.id). */
export const LoopNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('loop'),
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
  onExhausted: z.enum(['route', 'fail']).default('route'),
});

/** Map/ForEach over an array with bounded concurrency. Body nodes have parent === this.id. */
export const ForEachNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('foreach'),
  items: BindingSchema,
  /** Schema of $scope.item; inferred from `items` when omitted. */
  itemSchema: JsonSchemaSchema.optional(),
  concurrency: z.int().min(1).max(64).default(4),
  failurePolicy: z.enum(['fail_fast', 'collect', 'skip']).default('fail_fast'),
  bounds: BoundsSchema,
  /** Body-scope binding collected per item into output `results`. Required when `results` is consumed. */
  collect: BindingSchema.optional(),
  /** Sequential reduce after collection: FlowExpr over $acc, $value, $index → output `reduced`. */
  reduce: z.object({ initial: JsonValueSchema, expr: ExpressionSourceSchema }).optional(),
});

export const SubflowNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('subflow'),
  workflowId: z.uuid(),
  version: z.union([z.literal('deployed'), z.object({ versionId: z.uuid() })]).default('deployed'),
  /** child input key → binding */
  inputs: z.record(z.string(), BindingSchema).default({}),
  timeoutMs: z.int().min(1).optional(),
});

export const WaitNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('wait'),
  until: z.discriminatedUnion('type', [
    z.object({ type: z.literal('delay'), ms: z.int().min(1).max(30 * 24 * 3600_000) }),
    z.object({ type: z.literal('timestamp'), at: BindingSchema }),
    z.object({
      type: z.literal('event'),
      eventName: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
      timeoutMs: z.int().min(1),
      payloadSchema: JsonSchemaSchema.optional(),
    }),
  ]),
});

export const HumanModeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approval') }),
  /** Reviewer may edit `value` (validated by `schema`); approved value flows out of port `value`. */
  z.object({ type: z.literal('review'), value: BindingSchema, schema: JsonSchemaSchema }),
  z.object({ type: z.literal('form'), schema: JsonSchemaSchema }),
  z.object({ type: z.literal('choice'), options: z.array(z.object({ id: PortNameSchema, label: z.string().max(80) })).min(2).max(32) }),
]);
export type HumanMode = z.infer<typeof HumanModeSchema>;

/** Durable human task. Control-outs: approval/review → approved|rejected; form → submitted; choice → one per option id; + expired (onExpire='route'). */
export const HumanNodeSchema = z.object({
  ...CommonNodeShape,
  kind: z.literal('human'),
  mode: HumanModeSchema,
  title: BindingSchema,
  context: z.record(z.string(), BindingSchema).default({}),
  /** user ids or "role:<role>" / "group:<id>"; empty = anyone with runs:approve */
  assignees: z.array(z.string()).default([]),
  expiresInMs: z.int().min(1).optional(),
  onExpire: z.enum(['fail', 'route', 'escalate']).default('fail'),
  escalation: z.object({ afterMs: z.int().min(1), to: z.array(z.string()).min(1) }).optional(),
  /** Allow a signed single-use review link for non-members. */
  externalReview: z.boolean().default(false),
});

/** Canvas-only annotation; dropped by the compiler. */
export const NoteNodeSchema = z.object({ ...CommonNodeShape, kind: z.literal('note'), text: z.string().max(4000) });

export const WorkflowNodeSchema = z.discriminatedUnion('kind', [
  InputNodeSchema, OutputNodeSchema, TaskNodeSchema, BranchNodeSchema, JoinNodeSchema, LoopNodeSchema,
  ForEachNodeSchema, SubflowNodeSchema, WaitNodeSchema, HumanNodeSchema, NoteNodeSchema,
]);
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type NodeKind = WorkflowNode['kind'];
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

export const VariableSchema = z.object({
  name: VarNameSchema,
  schema: JsonSchemaSchema,
  default: JsonValueSchema.optional(),
  /** definition: value from `default`; environment: from environments.variables / deployment overrides; run_input: from the run request. */
  source: z.enum(['definition', 'environment', 'run_input']).default('definition'),
  description: z.string().max(500).optional(),
});
export type Variable = z.infer<typeof VariableSchema>;

export const SecretDeclSchema = z.object({
  name: SecretNameSchema,
  credentialType: CredentialTypeIdSchema,
  required: z.boolean().default(true),
  description: z.string().max(500).optional(),
});
export type SecretDecl = z.infer<typeof SecretDeclSchema>;

export const TriggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }),
  z.object({
    type: z.literal('webhook'),
    path: z.string().regex(/^[a-z0-9-]{3,64}$/),
    signature: z.enum(['none', 'hmac_sha256', 'token']).default('hmac_sha256'),
    responseMode: z.enum(['sync', 'async', 'stream']).default('async'),
    /** JSON pointer into { body, headers, query, method } → workflow input; default "/body". */
    inputPointer: JsonPointerSchema.default('/body'),
    allowedHeaders: z.array(z.string()).default([]),
  }),
  z.object({ type: z.literal('schedule'), cron: z.string().min(9), timezone: z.string().default('UTC'), input: JsonValueSchema.default({}) }),
  z.object({ type: z.literal('mcp'), toolName: ToolNameSchema, description: z.string().max(1000) }),
  z.object({ type: z.literal('event'), eventName: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const LayoutSchema = z.object({
  nodes: z.record(NodeIdSchema, z.object({ x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional(), collapsed: z.boolean().optional() })),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const WORKFLOW_SCHEMA_URI = 'https://flowaid.dev/schemas/workflow/v1' as const;

export const WorkflowDefinitionSchema = z.object({
  $schema: z.literal(WORKFLOW_SCHEMA_URI),
  id: z.uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).default(''),
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
 * sha256 of the canonical definition (layout and metadata removed, keys sorted, nodes/edges sorted by id).
 * RFC-0008: the document is parsed with `WorkflowDefinitionSchema` first (idempotent on parsed input), so a raw
 * JSON document and its parsed form hash identically and every resolved schema default is part of the hash
 * (a default change is a hash-changing release, VERSIONS.md); a document the schema rejects throws the
 * `ZodError`; duplicate node or edge ids throw a `TypeError`.
 */
export declare function definitionHash(def: unknown): string;

/* ────────────────────────────────────────────────────────────────────────────
 * §7  DecisionResult                                 (workflow-core/src/decision.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const TokenUsageSchema = z.object({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  cacheReadTokens: z.int().min(0).optional(),
  cacheWriteTokens: z.int().min(0).optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Price per million tokens captured at emit time so historical cost never drifts when the catalog changes. */
export const PriceSnapshotSchema = z.object({
  inputPerMTok: z.number().min(0),
  outputPerMTok: z.number().min(0),
  cacheReadPerMTok: z.number().min(0).optional(),
  cacheWritePerMTok: z.number().min(0).optional(),
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const ProviderAttemptSchema = z.object({
  provider: z.string(),
  model: z.string(),
  outcome: z.enum(['ok', 'error', 'skipped_unhealthy']),
  errorCode: ErrorCodeSchema.optional(),
  latencyMs: z.int().min(0),
});
export type ProviderAttempt = z.infer<typeof ProviderAttemptSchema>;

const DecisionBaseShape = {
  /** [0,1]; boolean = max(pYes, 1-pYes); choice/score = provider's distribution-derived confidence. Comparable across kinds. */
  confidence: z.number().min(0).max(1),
  /** "typesafe" | "llm" | "rule" | "human" | custom id */
  provider: z.string(),
  /** resolved model id, e.g. "jev-1.13.0" (never the alias) */
  model: z.string(),
  latencyMs: z.int().min(0),
  usage: TokenUsageSchema.optional(),
  costUsd: z.number().min(0),
  requestId: z.string().optional(),
  raw: JsonValueSchema.optional(),
  /** Failover chain actually walked, visible in traces. */
  attempts: z.array(ProviderAttemptSchema),
};

export const BooleanDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal('boolean'),
  value: z.boolean(),
  pYes: z.number().min(0).max(1),
  probabilities: z.object({ true: z.number().min(0).max(1), false: z.number().min(0).max(1) }),
});
export const ChoiceDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal('choice'),
  value: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
export const ScoreDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal('score'),
  /** probability-weighted fractional score in [0, levels.length-1] */
  value: z.number().min(0),
  /** value / (levels.length - 1) */
  normalized: z.number().min(0).max(1),
  level: z.int().min(0),
  levelLabel: z.string(),
  levels: z.array(z.string()).min(2).max(10),
  /** keyed "0".."n-1" */
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
export const DecisionResultSchema = z.discriminatedUnion('kind', [BooleanDecisionSchema, ChoiceDecisionSchema, ScoreDecisionSchema]);
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export type BooleanDecision = z.infer<typeof BooleanDecisionSchema>;
export type ChoiceDecision = z.infer<typeof ChoiceDecisionSchema>;
export type ScoreDecision = z.infer<typeof ScoreDecisionSchema>;
export type DecisionKind = DecisionResult['kind'];

/** Generic form named in the product spec; the kind-specific schemas above are its concrete instances. */
export interface DecisionResultOf<T extends boolean | string | number> {
  kind: DecisionKind;
  value: T;
  confidence: number;
  probabilities?: Record<string, number>;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: TokenUsage;
  costUsd: number;
  raw?: JsonValue;
  attempts: ProviderAttempt[];
}

/** JSON Schema of DecisionResult per kind — the output port schema `decision` of decision nodes. Generated once via z.toJSONSchema. */
export declare const DecisionResultJsonSchema: Record<DecisionKind, JsonSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §8  Errors                                          (workflow-core/src/errors.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  runId?: string;
  nodeId?: NodeId;
  nodeRunId?: string;
  /** redacted before persistence */
  details?: JsonValue;
  cause?: ErrorInfo;
}
export const ErrorInfoSchema: z.ZodType<ErrorInfo> = z.lazy(() =>
  z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    runId: z.string().optional(),
    nodeId: NodeIdSchema.optional(),
    nodeRunId: z.string().optional(),
    details: JsonValueSchema.optional(),
    cause: ErrorInfoSchema.optional(),
  }),
);

export interface ErrorContext {
  runId?: string;
  nodeId?: NodeId;
  nodeRunId?: string;
}

export abstract class FlowaidError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly retryable: boolean;
  readonly httpStatus: number = 500;
  readonly details: JsonValue | undefined;

  constructor(message: string, details?: JsonValue, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
  }

  toInfo(ctx?: ErrorContext): ErrorInfo {
    const info: ErrorInfo = { code: this.code, message: this.message, retryable: this.retryable };
    if (ctx?.runId !== undefined) info.runId = ctx.runId;
    if (ctx?.nodeId !== undefined) info.nodeId = ctx.nodeId;
    if (ctx?.nodeRunId !== undefined) info.nodeRunId = ctx.nodeRunId;
    if (this.details !== undefined) info.details = this.details;
    if (this.cause instanceof FlowaidError) info.cause = this.cause.toInfo();
    return info;
  }
}

export class WorkflowValidationError extends FlowaidError {
  readonly code = 'WORKFLOW_VALIDATION_ERROR' as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`${diagnostics.length} diagnostic(s)`, { diagnostics: diagnostics as unknown as JsonValue });
  }
}
export class SchemaValidationError extends FlowaidError {
  readonly code = 'SCHEMA_VALIDATION_ERROR' as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
  constructor(message: string, readonly issues: readonly { path: string; message: string }[]) {
    super(message, { issues: issues.map((i) => ({ path: i.path, message: i.message })) });
  }
}
export class NodeExecutionError extends FlowaidError {
  readonly code = 'NODE_EXECUTION_ERROR' as const;
  constructor(message: string, readonly retryable: boolean, details?: JsonValue, options?: { cause?: unknown }) {
    super(message, details, options);
  }
}
export class ToolExecutionError extends FlowaidError {
  readonly code = 'TOOL_EXECUTION_ERROR' as const;
  override readonly httpStatus = 502;
  constructor(message: string, readonly retryable: boolean, readonly tool: string, details?: JsonValue) {
    super(message, details);
  }
}
export class ProviderError extends FlowaidError {
  readonly code = 'PROVIDER_ERROR' as const;
  override readonly httpStatus = 502;
  constructor(message: string, readonly retryable: boolean, readonly provider: string, details?: JsonValue) {
    super(message, details);
  }
}
export class ProviderRateLimitedError extends FlowaidError {
  readonly code = 'PROVIDER_RATE_LIMITED' as const;
  readonly retryable = true;
  override readonly httpStatus = 429;
  constructor(readonly provider: string, readonly retryAfterMs?: number) {
    super(`${provider} rate limited`, retryAfterMs === undefined ? undefined : { retryAfterMs });
  }
}
export class ProviderOverloadedError extends FlowaidError {
  readonly code = 'PROVIDER_OVERLOADED' as const;
  readonly retryable = true;
  override readonly httpStatus = 503;
  constructor(readonly provider: string) {
    super(`${provider} overloaded`);
  }
}
export class CredentialError extends FlowaidError {
  readonly code = 'CREDENTIAL_ERROR' as const;
  readonly retryable = false;
  override readonly httpStatus = 401;
}
export class TimeoutError extends FlowaidError {
  readonly code = 'TIMEOUT_ERROR' as const;
  readonly retryable = true;
  override readonly httpStatus = 504;
}
export class RateLimitError extends FlowaidError {
  readonly code = 'RATE_LIMIT_ERROR' as const;
  readonly retryable = true;
  override readonly httpStatus = 429;
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message, retryAfterMs === undefined ? undefined : { retryAfterMs });
  }
}
export class CancelledError extends FlowaidError {
  readonly code = 'CANCELLED_ERROR' as const;
  readonly retryable = false;
  override readonly httpStatus = 409;
}
export class BoundsExceededError extends FlowaidError {
  readonly code = 'BOUNDS_EXCEEDED' as const;
  readonly retryable = false;
  constructor(
    readonly bound: 'maxIterations' | 'timeoutMs' | 'maxCostUsd' | 'maxTokens' | 'maxNodeRuns' | 'maxSubflowDepth',
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`${bound} exceeded (${actual} > ${limit})`, { bound, limit, actual });
  }
}
export class InputMissingError extends FlowaidError {
  readonly code = 'INPUT_MISSING' as const;
  readonly retryable = false;
}
export class OutputSchemaMismatchError extends FlowaidError {
  readonly code = 'OUTPUT_SCHEMA_MISMATCH' as const;
  readonly retryable = false;
}
export class ExpressionError extends FlowaidError {
  readonly code = 'EXPRESSION_ERROR' as const;
  readonly retryable = false;
}
export class SandboxError extends FlowaidError {
  readonly code = 'SANDBOX_ERROR' as const;
  readonly retryable = false;
}
export class WorkerLostError extends FlowaidError {
  readonly code = 'WORKER_LOST' as const;
  readonly retryable = true;
}
export class NonIdempotentInterruptedError extends FlowaidError {
  readonly code = 'NONIDEMPOTENT_INTERRUPTED' as const;
  readonly retryable = false;
}
export class HumanApprovalRequired extends FlowaidError {
  readonly code = 'HUMAN_APPROVAL_REQUIRED' as const;
  readonly retryable = false;
  override readonly httpStatus = 202;
  constructor(readonly humanTaskId: string) {
    super('Human approval required', { humanTaskId });
  }
}
export class HumanTaskExpiredError extends FlowaidError {
  readonly code = 'HUMAN_TASK_EXPIRED' as const;
  readonly retryable = false;
}
export class SubflowError extends FlowaidError {
  readonly code = 'SUBFLOW_ERROR' as const;
  constructor(message: string, readonly retryable: boolean, readonly childRunId: string, details?: JsonValue) {
    super(message, details);
  }
}
export class NoOutputError extends FlowaidError {
  readonly code = 'NO_OUTPUT' as const;
  readonly retryable = false;
}
export class NetworkError extends FlowaidError {
  readonly code = 'NETWORK_ERROR' as const;
  readonly retryable = true;
  override readonly httpStatus = 502;
}
export class NotFoundError extends FlowaidError {
  readonly code = 'NOT_FOUND' as const;
  readonly retryable = false;
  override readonly httpStatus = 404;
}
export class ConflictError extends FlowaidError {
  readonly code = 'CONFLICT' as const;
  readonly retryable = false;
  override readonly httpStatus = 409;
}
export class UnauthorizedError extends FlowaidError {
  readonly code = 'UNAUTHORIZED' as const;
  readonly retryable = false;
  override readonly httpStatus = 401;
}
export class ForbiddenError extends FlowaidError {
  readonly code = 'FORBIDDEN' as const;
  readonly retryable = false;
  override readonly httpStatus = 403;
}
export class BadRequestError extends FlowaidError {
  readonly code = 'BAD_REQUEST' as const;
  readonly retryable = false;
  override readonly httpStatus = 400;
}
export class PayloadTooLargeError extends FlowaidError {
  readonly code = 'PAYLOAD_TOO_LARGE' as const;
  readonly retryable = false;
  override readonly httpStatus = 413;
}
export class InternalError extends FlowaidError {
  readonly code = 'INTERNAL' as const;
  readonly retryable = false;
}

/** Wraps unknown throws: FlowaidError passthrough; AbortError → CancelledError; everything else → InternalError. */
export declare function toFlowaidError(u: unknown): FlowaidError;

/** Wire envelope for HTTP errors (snake_case per product spec). */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    run_id: z.string().optional(),
    node_id: z.string().optional(),
    node_run_id: z.string().optional(),
    details: JsonValueSchema.optional(),
    request_id: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §9  Human request / response                       (workflow-core/src/human.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

/** What a reviewer sees. Already redacted. Stored in human_tasks.request. */
export const HumanRequestSchema = z.object({
  title: z.string().max(200),
  context: JsonObjectSchema,
  mode: z.discriminatedUnion('type', [
    z.object({ type: z.literal('approval') }),
    z.object({ type: z.literal('review'), value: JsonValueSchema, schema: JsonSchemaSchema }),
    z.object({ type: z.literal('form'), schema: JsonSchemaSchema }),
    z.object({ type: z.literal('choice'), options: z.array(z.object({ id: PortNameSchema, label: z.string() })).min(2) }),
  ]),
  assignees: z.array(z.string()),
  expiresAt: z.iso.datetime().nullable(),
  externalReview: z.boolean(),
  /** Why the task exists: a human node, a task-node suspension (agent tool approval), or a decision failover to `human`. */
  origin: z.enum(['human_node', 'task_suspend', 'decision_failover']),
});
export type HumanRequest = z.infer<typeof HumanRequestSchema>;

/** Wire format for POST /v1/human-tasks/:id/respond and for HUMAN_APPROVAL_RECEIVED. */
export const HumanResponseSchema = z.discriminatedUnion('action', [
  /** approval/review. `value` = edited value in review mode. */
  z.object({ action: z.literal('approve'), value: JsonValueSchema.optional(), comment: z.string().max(4000).optional() }),
  z.object({ action: z.literal('reject'), comment: z.string().max(4000).optional() }),
  z.object({ action: z.literal('choose'), option: PortNameSchema, comment: z.string().max(4000).optional() }),
  z.object({ action: z.literal('submit'), value: JsonValueSchema }),
  /** Reassigns; the task stays open. */
  z.object({ action: z.literal('escalate'), to: z.array(z.string()).min(1), comment: z.string().max(4000).optional() }),
]);
export type HumanResponse = z.infer<typeof HumanResponseSchema>;

/** Output port `decision` of a human node. */
export const HumanDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'choose', 'submit', 'expire']),
  option: PortNameSchema.nullable(),
  by: z.string(),
  at: z.iso.datetime(),
  comment: z.string().nullable(),
});
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §10  Run, NodeRun, statuses                        (workflow-core/src/run.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const RunStatusSchema = z.enum([
  'queued', 'starting', 'running', 'waiting', 'waiting_for_human', 'retrying', 'completed', 'failed', 'cancelled', 'timed_out',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['completed', 'failed', 'cancelled', 'timed_out']);

export const NodeRunStatusSchema = z.enum(['pending', 'running', 'waiting', 'retry_wait', 'completed', 'failed', 'skipped', 'cancelled', 'reused']);
export type NodeRunStatus = z.infer<typeof NodeRunStatusSchema>;

export const RunModeSchema = z.enum(['sync', 'async']);
export type RunMode = z.infer<typeof RunModeSchema>;
export const RunOriginSchema = z.enum(['api', 'ui', 'webhook', 'schedule', 'mcp', 'evaluation', 'subflow', 'replay', 'restart', 'fork']);
export type RunOrigin = z.infer<typeof RunOriginSchema>;

export const RunSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workflowId: z.uuid(),
  workflowVersionId: z.uuid(),
  environmentId: z.uuid(),
  status: RunStatusSchema,
  origin: RunOriginSchema,
  mode: RunModeSchema,
  input: JsonValueSchema,
  output: JsonValueSchema.nullable(),
  outcome: z.string().nullable(),
  error: ErrorInfoSchema.nullable(),
  parentRunId: z.uuid().nullable(),
  parentNodeRunId: z.uuid().nullable(),
  sourceRunId: z.uuid().nullable(),
  sessionId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  lastSeq: z.int().min(0),
  usage: TokenUsageSchema,
  costUsd: z.number().min(0),
  nodeRunCount: z.int().min(0),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const NodeRunSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  nodeId: NodeIdSchema,
  scope: ScopePathSchema,
  attempt: z.int().min(1),
  status: NodeRunStatusSchema,
  kind: z.string(),
  nodeType: NodeTypeIdSchema.nullable(),
  nodeName: z.string(),
  input: JsonValueSchema.nullable(),
  /** inline ≤ 64 KiB, else { "$artifact": id } */
  output: JsonValueSchema.nullable(),
  firedPorts: z.array(PortNameSchema),
  decision: DecisionResultSchema.nullable(),
  error: ErrorInfoSchema.nullable(),
  usage: TokenUsageSchema.nullable(),
  costUsd: z.number().min(0),
  latencyMs: z.int().min(0).nullable(),
  queueLatencyMs: z.int().min(0).nullable(),
  idempotencyKey: z.string().nullable(),
  inputHash: z.string().nullable(),
  reusedFromNodeRunId: z.uuid().nullable(),
  pool: WorkerPoolSchema,
  scheduledSeq: z.int().min(1),
  endedSeq: z.int().min(1).nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});
export type NodeRun = z.infer<typeof NodeRunSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §11  Events                                        (workflow-core/src/events.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

const EventBase = { runId: z.uuid(), seq: z.int().min(0), at: z.iso.datetime() };
/** Every node-level event carries the full address so the live canvas can attribute it inside concurrent iterations. */
const NodeEventBase = { ...EventBase, nodeRunId: z.uuid(), nodeId: NodeIdSchema, scope: ScopePathSchema, attempt: z.int().min(1) };

export const WaitReasonSchema = z.enum(['timer', 'human', 'subflow', 'event', 'delegated']);
export type WaitReason = z.infer<typeof WaitReasonSchema>;
export const TimerPurposeSchema = z.enum(['retry', 'wait', 'human_expiry', 'human_escalation', 'node_timeout', 'join_timeout', 'run_deadline', 'loop_timeout']);
export type TimerPurpose = z.infer<typeof TimerPurposeSchema>;

export const RunEventSchema = z.discriminatedUnion('type', [
  // ── run lifecycle ──
  z.object({ ...EventBase, type: z.literal('RUN_CREATED'), workflowVersionId: z.uuid(), environmentId: z.uuid(), origin: RunOriginSchema, mode: RunModeSchema, input: JsonValueSchema, planHash: z.string(), idempotencyKey: z.string().nullable(), sourceRunId: z.uuid().nullable() }),
  z.object({ ...EventBase, type: z.literal('RUN_STARTED'), workerId: z.string(), leaseUntil: z.iso.datetime(), deadlineAt: z.iso.datetime() }),
  z.object({ ...EventBase, type: z.literal('RUN_LEASE_TAKEN'), workerId: z.string(), previousWorkerId: z.string().nullable(), reason: z.enum(['expired', 'released', 'resume', 'control']) }),
  z.object({ ...EventBase, type: z.literal('RUN_WAITING'), reason: WaitReasonSchema, nodeRunIds: z.array(z.uuid()) }),
  z.object({ ...EventBase, type: z.literal('RUN_RESUMED'), reason: WaitReasonSchema, nodeRunId: z.uuid().nullable() }),
  z.object({ ...EventBase, type: z.literal('RUN_CANCEL_REQUESTED'), by: z.string(), reason: z.string().nullable() }),
  z.object({ ...EventBase, type: z.literal('RUN_OUTPUT'), nodeRunId: z.uuid(), nodeId: NodeIdSchema, output: JsonValueSchema, outcome: z.string().nullable(), earlyExit: z.boolean() }),
  z.object({ ...EventBase, type: z.literal('RUN_COMPLETED'), output: JsonValueSchema, outcome: z.string().nullable(), usage: TokenUsageSchema, costUsd: z.number().min(0), durationMs: z.int().min(0) }),
  z.object({ ...EventBase, type: z.literal('RUN_FAILED'), error: ErrorInfoSchema, usage: TokenUsageSchema, costUsd: z.number().min(0), durationMs: z.int().min(0) }),
  z.object({ ...EventBase, type: z.literal('RUN_CANCELLED'), by: z.string(), usage: TokenUsageSchema, costUsd: z.number().min(0), durationMs: z.int().min(0) }),
  z.object({ ...EventBase, type: z.literal('RUN_TIMED_OUT'), timeoutMs: z.int(), usage: TokenUsageSchema, costUsd: z.number().min(0), durationMs: z.int().min(0) }),
  z.object({ ...EventBase, type: z.literal('CHECKPOINT_CREATED'), checkpointSeq: z.int().min(0) }),

  // ── node lifecycle ──
  z.object({ ...NodeEventBase, type: z.literal('NODE_SCHEDULED'), kind: z.string(), nodeType: NodeTypeIdSchema.nullable(), inputHash: z.string(), idempotencyKey: z.string().nullable(), reusedFromNodeRunId: z.uuid().nullable(), batchId: z.string().nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_STARTED'), input: JsonValueSchema, pool: WorkerPoolSchema, workerId: z.string() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_COMPLETED'), output: JsonValueSchema, firedPorts: z.array(PortNameSchema), usage: TokenUsageSchema.nullable(), costUsd: z.number().min(0), latencyMs: z.int().min(0), reused: z.boolean() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_FAILED'), error: ErrorInfoSchema, firedPorts: z.array(PortNameSchema), latencyMs: z.int().min(0), terminal: z.boolean() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_RETRIED'), error: ErrorInfoSchema, nextAttempt: z.int().min(2), delayMs: z.int().min(0), timerId: z.uuid() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_SKIPPED'), reason: z.enum(['pruned', 'race_lost', 'parent_failed', 'disabled', 'early_exit']) }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_CANCELLED'), reason: z.enum(['run_cancelled', 'race_lost', 'early_exit', 'parent_failed']) }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_WAITING'), reason: WaitReasonSchema, ref: z.string(), state: JsonValueSchema.nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('NODE_DELEGATED'), pool: WorkerPoolSchema, jobId: z.string() }),

  // ── control flow ──
  z.object({ ...NodeEventBase, type: z.literal('BRANCH_EVALUATED'), taken: z.array(PortNameSchema), evaluations: z.array(z.object({ port: PortNameSchema, result: z.boolean() })) }),
  z.object({ ...NodeEventBase, type: z.literal('JOIN_ARRIVED'), edgeId: EdgeIdSchema, from: NodeIdSchema, status: z.enum(['fired', 'pruned']), arrived: z.int().min(0), expected: z.int().min(0) }),
  z.object({ ...NodeEventBase, type: z.literal('LOOP_ITERATION_STARTED'), iteration: z.int().min(0), childScope: ScopePathSchema, carry: JsonValueSchema }),
  z.object({ ...NodeEventBase, type: z.literal('LOOP_ITERATION_COMPLETED'), iteration: z.int().min(0), childScope: ScopePathSchema, carry: JsonValueSchema, result: JsonValueSchema, exit: z.boolean(), usage: TokenUsageSchema, costUsd: z.number().min(0) }),
  z.object({ ...NodeEventBase, type: z.literal('LOOP_EXITED'), iterations: z.int().min(0), reason: z.enum(['exit_condition', 'max_iterations', 'timeout', 'max_cost', 'max_tokens', 'body_failed', 'items_done']) }),
  z.object({ ...NodeEventBase, type: z.literal('FOREACH_STARTED'), itemCount: z.int().min(0), concurrency: z.int().min(1) }),
  z.object({ ...NodeEventBase, type: z.literal('FOREACH_ITEM_COMPLETED'), index: z.int().min(0), childScope: ScopePathSchema, status: z.enum(['completed', 'failed', 'skipped']), result: JsonValueSchema.nullable(), error: ErrorInfoSchema.nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('SUBFLOW_STARTED'), childRunId: z.uuid(), childVersionId: z.uuid(), depth: z.int().min(1) }),
  z.object({ ...NodeEventBase, type: z.literal('SUBFLOW_COMPLETED'), childRunId: z.uuid(), status: RunStatusSchema, output: JsonValueSchema.nullable(), error: ErrorInfoSchema.nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('TIMER_SET'), timerId: z.uuid(), fireAt: z.iso.datetime(), purpose: TimerPurposeSchema }),
  z.object({ ...NodeEventBase, type: z.literal('TIMER_FIRED'), timerId: z.uuid(), purpose: TimerPurposeSchema }),
  z.object({ ...NodeEventBase, type: z.literal('EVENT_RECEIVED'), eventName: z.string(), payload: JsonValueSchema }),

  // ── intelligence ──
  z.object({ ...NodeEventBase, type: z.literal('DECISION_REQUESTED'), batchId: z.string(), questionCount: z.int().min(1), provider: z.string(), model: z.string(), stateHash: z.string(), questions: z.array(z.string()) }),
  z.object({ ...NodeEventBase, type: z.literal('DECISION_COMPLETED'), batchId: z.string(), question: z.string(), decision: DecisionResultSchema, priceSnapshot: PriceSnapshotSchema.nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('PROVIDER_FAILOVER'), from: z.string(), to: z.string(), error: ErrorInfoSchema }),
  z.object({ ...NodeEventBase, type: z.literal('GENERATION_STARTED'), provider: z.string(), model: z.string(), promptHash: z.string(), stream: z.boolean() }),
  z.object({ ...NodeEventBase, type: z.literal('GENERATION_COMPLETED'), provider: z.string(), model: z.string(), usage: TokenUsageSchema, costUsd: z.number().min(0), priceSnapshot: PriceSnapshotSchema.nullable(), finishReason: z.string(), outputChars: z.int().min(0), latencyMs: z.int().min(0) }),
  z.object({ ...NodeEventBase, type: z.literal('TOOL_CALLED'), toolCallId: z.string(), tool: z.string(), source: z.enum(['mcp', 'openapi', 'workflow', 'builtin', 'http']), args: JsonValueSchema, capability: z.string().nullable(), coerced: z.boolean() }),
  z.object({ ...NodeEventBase, type: z.literal('TOOL_RETURNED'), toolCallId: z.string(), tool: z.string(), ok: z.boolean(), result: JsonValueSchema.nullable(), error: ErrorInfoSchema.nullable(), latencyMs: z.int().min(0) }),

  // ── human ──
  z.object({ ...NodeEventBase, type: z.literal('HUMAN_APPROVAL_REQUESTED'), humanTaskId: z.uuid(), request: HumanRequestSchema }),
  z.object({ ...NodeEventBase, type: z.literal('HUMAN_APPROVAL_RECEIVED'), humanTaskId: z.uuid(), response: HumanResponseSchema, by: z.string() }),
  z.object({ ...NodeEventBase, type: z.literal('HUMAN_TASK_ESCALATED'), humanTaskId: z.uuid(), to: z.array(z.string()), reason: z.enum(['timer', 'reviewer']) }),
  z.object({ ...NodeEventBase, type: z.literal('HUMAN_TASK_EXPIRED'), humanTaskId: z.uuid(), action: z.enum(['fail', 'route', 'escalate']) }),

  // ── telemetry ──
  z.object({ ...NodeEventBase, type: z.literal('LOG'), level: z.enum(['debug', 'info', 'warn', 'error']), message: z.string(), data: JsonValueSchema.nullable() }),
  z.object({ ...NodeEventBase, type: z.literal('METRIC'), name: z.string(), value: z.number(), labels: z.record(z.string(), z.string()) }),
  z.object({ ...NodeEventBase, type: z.literal('ARTIFACT_CREATED'), artifactId: z.uuid(), name: z.string(), mimeType: z.string(), bytes: z.int().min(0), dataClass: DataClassSchema }),
  z.object({ ...NodeEventBase, type: z.literal('STATE_WRITTEN'), namespace: z.string(), key: z.string(), bytes: z.int().min(0) }),

  // ── ephemeral (seq = 0, never persisted, fanned out to SSE only) ──
  z.object({ ...NodeEventBase, type: z.literal('GENERATION_DELTA'), ephemeral: z.literal(true), channel: z.enum(['text', 'thinking', 'tool_args']), delta: z.string(), index: z.int().min(0) }),
  z.object({ ...EventBase, type: z.literal('HEARTBEAT'), ephemeral: z.literal(true) }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];
export type DurableRunEvent = Exclude<RunEvent, { ephemeral: true }>;
export type EphemeralRunEvent = Extract<RunEvent, { ephemeral: true }>;
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;
export const TERMINAL_EVENT_TYPES: ReadonlySet<RunEventType> = new Set<RunEventType>(['RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELLED', 'RUN_TIMED_OUT']);

/* ────────────────────────────────────────────────────────────────────────────
 * §12  Diagnostics                                   (workflow-core/src/diagnostics.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const DiagnosticCodeSchema = z.enum([
  // schema & structure
  'E_SCHEMA', 'E_DUPLICATE_NODE_ID', 'E_DUPLICATE_EDGE_ID', 'E_RESERVED_ID', 'W_DUPLICATE_NAME',
  'E_NO_INPUT_NODE', 'E_MULTIPLE_INPUT_NODES', 'E_NO_OUTPUT_NODE', 'E_PARENT_NOT_CONTAINER', 'E_SCOPE_DEPTH',
  // catalog & config
  'E_UNKNOWN_NODE_TYPE', 'E_NODE_VERSION_UNSUPPORTED', 'I_NODE_VERSION_OUTDATED', 'W_NODE_DEPRECATED', 'E_CONFIG_INVALID',
  'E_PORT_RULE_INVALID', 'E_TOOL_UNRESOLVED', 'E_TOOL_SCHEMA_INVALID', 'E_POOL_NOT_ALLOWED', 'E_PLUGIN_ID_PREFIX',
  // edges & ports
  'E_EDGE_ENDPOINT_MISSING', 'E_EDGE_CROSSES_SCOPE', 'E_UNKNOWN_CONTROL_PORT', 'E_SELF_EDGE',
  'E_INPUT_UNKNOWN_PORT', 'E_INPUT_REQUIRED_MISSING', 'E_INPUT_LITERAL_INVALID', 'W_CONTROL_PORT_UNCONNECTED',
  // refs, templates, expressions
  'E_REF_UNKNOWN_NODE', 'E_REF_UNKNOWN_PORT', 'E_REF_PATH_INVALID', 'W_REF_PATH_UNTYPED', 'E_REF_SELF',
  'E_REF_SCOPE_VIOLATION', 'E_SCOPE_REF_OUTSIDE_SCOPE', 'E_TEMPLATE_SYNTAX', 'E_TEMPLATE_OBJECT_COERCION',
  'E_EXPR_SYNTAX', 'E_EXPR_TYPE', 'W_EXPR_UNTYPED', 'E_EXPR_NOT_BOOLEAN', 'E_EXPR_REGEX_DYNAMIC', 'E_EXPR_REGEX_UNSAFE',
  // dependency & control-flow analysis
  'E_CYCLE', 'E_CONDITIONAL_DATA_DEP', 'W_NULLABLE_INPUT', 'W_UNREACHABLE', 'E_DANGLING_DEPENDENCY', 'I_DANGLING_OUTPUT',
  'E_CONTROL_AMBIGUOUS', 'I_CONTROL_AND', 'W_IMPOSSIBLE_BRANCH', 'W_BRANCH_SHADOWED', 'W_UNREACHABLE_ROUTE',
  'E_JOIN_CONFIG', 'W_OUTPUT_AMBIGUOUS', 'E_OUTPUT_UNBOUND', 'E_OUTPUT_SCHEMA_MISMATCH', 'I_BATCH_GROUP',
  // types
  'E_TYPE_MISMATCH', 'W_TYPE_UNVERIFIED',
  // containers
  'W_LOOP_NO_EXIT', 'W_LOOSE_BOUNDS', 'E_FOREACH_NOT_ARRAY', 'E_FOREACH_COLLECT_MISSING', 'E_CARRY_TYPE_MISMATCH',
  // subflows
  'E_SUBFLOW_UNRESOLVED', 'E_SUBFLOW_CYCLE', 'E_SUBFLOW_DEPTH', 'E_SUBFLOW_SIGNATURE',
  // secrets, variables, credentials, providers
  'E_SECRET_UNDECLARED', 'W_SECRET_UNUSED', 'E_SECRET_UNBOUND', 'W_SECRET_UNBOUND', 'E_CREDENTIAL_SLOT_UNBOUND',
  'E_CREDENTIAL_TYPE_MISMATCH', 'E_CAPABILITY_MISSING', 'E_VARIABLE_UNDECLARED', 'E_VARIABLE_DEFAULT_INVALID', 'W_VARIABLE_UNUSED',
  'E_PROVIDER_UNAVAILABLE', 'W_PROVIDER_UNAVAILABLE', 'W_MODEL_DEPRECATED', 'W_FAILOVER_UNCONFIGURED',
  // decisions, human, agent, policy
  'E_DECISION_CONFIG', 'E_HUMAN_CONFIG', 'E_AGENT_UNBOUNDED', 'E_RETRY_ON_IRREVERSIBLE', 'W_RETRY_SIDE_EFFECT', 'E_DONOTPERSIST_SIDE_EFFECT',
  // publish-time & runtime
  'E_TRIGGER_CONFLICT', 'W_COST_ESTIMATE', 'W_REGRESSION', 'E_PLAN_HASH_MISMATCH', 'E_IMPORT_UNSUPPORTED', 'E_INTERNAL',
]);
export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;

export const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  /** Where the canvas/inspector renders it. `path` is a JSON pointer into the definition document. */
  location: z.object({
    nodeId: NodeIdSchema.optional(),
    edgeId: EdgeIdSchema.optional(),
    port: PortNameSchema.optional(),
    path: JsonPointerSchema.optional(),
    /** JSON pointer inside the node's `inputs` (e.g. "/state/fields/message"). */
    bindingPath: JsonPointerSchema.optional(),
    /** Character range inside a template/expression source. */
    range: z.object({ start: z.int().min(0), end: z.int().min(0) }).optional(),
    scope: ScopeIdSchema.optional(),
  }),
  related: z.array(z.object({ nodeId: NodeIdSchema.optional(), edgeId: EdgeIdSchema.optional(), message: z.string() })).optional(),
  /** RFC 6902 quick fix applied to the definition. */
  fix: z.object({ title: z.string(), patch: z.array(JsonPatchOpSchema) }).optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §13  ExecutionPlan                                 (workflow-core/src/plan.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Disjunctive normal form over branch predicates: the node can run iff some clause holds.
 * `[[]]` = unconditional (always). `[]` = never (only produced for unreachable nodes, which are dropped).
 */
export const GuardSchema = z.array(z.array(z.object({ node: NodeIdSchema, port: PortNameSchema })));
export type Guard = z.infer<typeof GuardSchema>;

export const DataDependencySchema = z.object({
  from: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  to: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  path: JsonPointerSchema.optional(),
  /** Producer may be pruned when the consumer runs; the binding carries a default. */
  optional: z.boolean(),
  via: z.enum(['ref', 'template', 'expr', 'hoisted']),
});
export type DataDependency = z.infer<typeof DataDependencySchema>;

export const ControlDependencySchema = z.object({
  edgeId: EdgeIdSchema,
  from: z.object({ node: NodeIdSchema, port: PortNameSchema }),
  /** Exclusive group index: OR within a group, AND across groups (ARCHITECTURE.md §5.3). */
  group: z.int().min(0),
});
export type ControlDependency = z.infer<typeof ControlDependencySchema>;

export type CompiledBinding =
  | { kind: 'literal'; value: JsonValue; schema: JsonSchema }
  | { kind: 'ref'; ref: Ref; optional: boolean; default?: JsonValue; schema: JsonSchema }
  | { kind: 'template'; template: CompiledTemplate; schema: JsonSchema }
  | { kind: 'expr'; ast: ExprAst; schema: JsonSchema }
  | { kind: 'object'; fields: Record<string, CompiledBinding>; schema: JsonSchema }
  | { kind: 'array'; items: CompiledBinding[]; schema: JsonSchema };

export const CompiledBindingSchema: z.ZodType<CompiledBinding> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: JsonValueSchema, schema: JsonSchemaSchema }),
    z.object({ kind: z.literal('ref'), ref: RefSchema, optional: z.boolean(), default: JsonValueSchema.optional(), schema: JsonSchemaSchema }),
    z.object({ kind: z.literal('template'), template: CompiledTemplateSchema, schema: JsonSchemaSchema }),
    z.object({ kind: z.literal('expr'), ast: ExprAstSchema, schema: JsonSchemaSchema }),
    z.object({ kind: z.literal('object'), fields: z.record(z.string(), CompiledBindingSchema), schema: JsonSchemaSchema }),
    z.object({ kind: z.literal('array'), items: z.array(CompiledBindingSchema), schema: JsonSchemaSchema }),
  ]),
);

export const RedactionRuleSchema = z.object({
  /** JSON pointer into the node's input ("/in/…") or output ("/out/…") value. */
  pointer: JsonPointerSchema,
  dataClass: DataClassSchema,
  mode: z.enum(['mask', 'hash', 'drop']),
});
export type RedactionRule = z.infer<typeof RedactionRuleSchema>;

export const ResolvedNodePolicySchema = z.object({
  timeoutMs: z.int().min(1),
  retry: RetryPolicySchema,
  onError: z.enum(['fail', 'route', 'ignore']),
  maxCostUsd: z.number().positive().nullable(),
  maxTokens: z.int().min(1).nullable(),
  privacy: PrivacyPolicySchema,
});
export type ResolvedNodePolicy = z.infer<typeof ResolvedNodePolicySchema>;

/** Tool signature resolved at compile time (MCP tool, OpenAPI operation, workflow-as-tool). Same shape as ToolDefinition (§14). */
export const ToolSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mcp'), serverId: z.uuid(), tool: ToolNameSchema }),
  z.object({ kind: z.literal('openapi'), toolsetId: z.uuid(), operationId: ToolNameSchema }),
  z.object({ kind: z.literal('workflow'), workflowId: z.uuid() }),
  z.object({ kind: z.literal('builtin'), id: ToolNameSchema }),
  z.object({ kind: z.literal('http') }),
]);
export type ToolSource = z.infer<typeof ToolSourceSchema>;

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

export const PlanOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input') }),
  z.object({ kind: z.literal('output'), value: CompiledBindingSchema, outcome: z.string().nullable(), earlyExit: z.boolean() }),
  z.object({
    kind: z.literal('task'),
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
  z.object({ kind: z.literal('branch'), mode: z.enum(['first', 'all']), cases: z.array(z.object({ port: PortNameSchema, when: ExprAstSchema, source: z.string() })), defaultPort: PortNameSchema }),
  z.object({
    kind: z.literal('join'),
    mode: z.discriminatedUnion('type', [
      z.object({ type: z.literal('all') }), z.object({ type: z.literal('any') }), z.object({ type: z.literal('count'), n: z.int().min(1) }), z.object({ type: z.literal('race') }),
    ]),
    timeoutMs: z.int().min(1).nullable(),
    inputs: z.record(PortNameSchema, CompiledBindingSchema),
    /** edge id → nodes reachable only through that input (aborted/skipped when it loses a race). */
    privateSubgraphs: z.record(EdgeIdSchema, z.array(NodeIdSchema)),
  }),
  z.object({
    kind: z.literal('loop'),
    carrySchema: JsonSchemaSchema,
    initialCarry: JsonObjectSchema,
    next: z.record(z.string(), CompiledBindingSchema),
    result: z.record(z.string(), CompiledBindingSchema),
    exitWhen: ExprAstSchema.nullable(),
    bounds: BoundsSchema,
    onExhausted: z.enum(['route', 'fail']),
    bodyScope: ScopeIdSchema,
  }),
  z.object({
    kind: z.literal('foreach'),
    items: CompiledBindingSchema,
    itemSchema: JsonSchemaSchema,
    concurrency: z.int().min(1),
    failurePolicy: z.enum(['fail_fast', 'collect', 'skip']),
    bounds: BoundsSchema,
    collect: CompiledBindingSchema.nullable(),
    reduce: z.object({ initial: JsonValueSchema, expr: ExprAstSchema }).nullable(),
    bodyScope: ScopeIdSchema,
  }),
  z.object({
    kind: z.literal('subflow'),
    workflowId: z.uuid(),
    /** null = resolve the environment's deployment at run start */
    versionId: z.uuid().nullable(),
    inputs: z.record(z.string(), CompiledBindingSchema),
    inputSchema: JsonSchemaSchema,
    outputSchema: JsonSchemaSchema,
    timeoutMs: z.int().min(1).nullable(),
  }),
  z.object({
    kind: z.literal('wait'),
    until: z.discriminatedUnion('type', [
      z.object({ type: z.literal('delay'), ms: z.int().min(1) }),
      z.object({ type: z.literal('timestamp'), at: CompiledBindingSchema }),
      z.object({ type: z.literal('event'), eventName: z.string(), timeoutMs: z.int().min(1), payloadSchema: JsonSchemaSchema.nullable() }),
    ]),
  }),
  z.object({
    kind: z.literal('human'),
    mode: z.discriminatedUnion('type', [
      z.object({ type: z.literal('approval') }),
      z.object({ type: z.literal('review'), value: CompiledBindingSchema, schema: JsonSchemaSchema }),
      z.object({ type: z.literal('form'), schema: JsonSchemaSchema }),
      z.object({ type: z.literal('choice'), options: z.array(z.object({ id: PortNameSchema, label: z.string() })) }),
    ]),
    title: CompiledBindingSchema,
    context: z.record(z.string(), CompiledBindingSchema),
    assignees: z.array(z.string()),
    expiresInMs: z.int().min(1).nullable(),
    onExpire: z.enum(['fail', 'route', 'escalate']),
    escalation: z.object({ afterMs: z.int().min(1), to: z.array(z.string()) }).nullable(),
    externalReview: z.boolean(),
  }),
]);
export type PlanOp = z.infer<typeof PlanOpSchema>;

export const PlanNodeSchema = z.object({
  id: NodeIdSchema,
  name: z.string(),
  kind: z.enum(['input', 'output', 'task', 'branch', 'join', 'loop', 'foreach', 'subflow', 'wait', 'human']),
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

export const PlanScopeSchema = z.object({
  id: ScopeIdSchema,
  parent: ScopeIdSchema.nullable(),
  kind: z.enum(['root', 'loop', 'foreach']),
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

export const BatchGroupSchema = z.object({
  id: z.string(),
  scope: ScopeIdSchema,
  nodes: z.array(NodeIdSchema).min(2),
  primary: ProviderHopSchema,
  /** Canonical hash of the shared `state` binding AST. */
  stateBindingHash: z.string(),
});
export type BatchGroup = z.infer<typeof BatchGroupSchema>;

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
  subflows: z.array(z.object({ node: NodeIdSchema, workflowId: z.uuid(), versionId: z.uuid().nullable() })),
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
export interface ProviderAvailability {
  providers: ReadonlySet<string>;
  models: ReadonlyArray<{ provider: string; model: string; deprecated?: string }>;
}
export interface CompileOptions {
  catalog: NodeCatalog;
  resolveSubflow?: (workflowId: string, version: 'deployed' | { versionId: string }) => SubflowSignature | undefined;
  resolveTool?: (source: ToolSource) => ToolSignature | undefined;
  providers?: ProviderAvailability;
  /** Secret names bound in the target environment; enables E_SECRET_UNBOUND (publish) / W_SECRET_UNBOUND (draft). */
  boundSecrets?: ReadonlySet<SecretName>;
  /** Workspace default decision chain used when the definition's is empty. */
  defaultDecisions?: { primary: ProviderHop; failover: ProviderHop[] };
  level: 'draft' | 'publish';
  compilerVersion: Semver;
}
export type CompileResult = { ok: true; plan: ExecutionPlan; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };
export declare function compile(definition: unknown, options: CompileOptions): CompileResult;
export declare function validate(definition: unknown, options: CompileOptions): Diagnostic[];
export type SubsetResult = { ok: true; verified: boolean } | { ok: false; reason: string; path: string };
/** Is every value valid under `source` also valid under `target`? Undecidable keywords ⇒ ok with verified=false (W_TYPE_UNVERIFIED). */
export declare function isSubschema(source: JsonSchema, target: JsonSchema): SubsetResult;
/** Walks a JSON pointer through properties/items/prefixItems/additionalProperties/$defs. */
export declare function projectSchema(schema: JsonSchema, pointer: JsonPointer): { ok: true; schema: JsonSchema; typed: boolean } | { ok: false; reason: string };

/* ────────────────────────────────────────────────────────────────────────────
 * §14  Tools                                          (workflow-core/src/tools.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

export const ToolResultSchema = z.object({
  ok: z.boolean(),
  /** text for a model */
  content: z.string(),
  /** parsed output when outputSchema exists */
  structured: JsonValueSchema.optional(),
  artifacts: z.array(z.object({ artifactId: z.uuid(), name: z.string(), mimeType: z.string() })).optional(),
  sources: z.array(z.object({ title: z.string().optional(), url: z.string().optional(), snippet: z.string().optional(), score: z.number().optional() })).optional(),
  usage: TokenUsageSchema.optional(),
  error: ErrorInfoSchema.optional(),
  /** argument coercions applied before validation (trace-visible) */
  coerced: z.array(z.object({ path: JsonPointerSchema, from: z.string(), to: z.string() })).optional(),
  latencyMs: z.int().min(0),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * §15  Providers                                      (providers/src/types.ts — interfaces only live here)
 * ──────────────────────────────────────────────────────────────────────────── */

/** TypeSafe "state": text, object, or array of text. Objects are sent verbatim. */
export type DecisionState = string | JsonObject | string[];

export const DecisionQuestionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('boolean'), instructions: z.string().min(1), criteria: z.object({ true: z.string(), false: z.string() }).optional() }),
  /** key → description; 2..255 options; keys ^[a-z0-9_]{1,64}$ (compiler-enforced so they can be control ports) */
  z.object({ kind: z.literal('choice'), instructions: z.string().min(1), options: z.record(z.string(), z.string()) }),
  /** 2..10 ordered level descriptions */
  z.object({ kind: z.literal('score'), instructions: z.string().min(1), levels: z.array(z.string()).min(2).max(10) }),
]);
export type DecisionQuestion = z.infer<typeof DecisionQuestionSchema>;
export type BooleanQuestion = Extract<DecisionQuestion, { kind: 'boolean' }>;
export type ChoiceQuestion = Extract<DecisionQuestion, { kind: 'choice' }>;
export type ScoreQuestion = Extract<DecisionQuestion, { kind: 'score' }>;

export interface DecisionCallContext {
  signal: AbortSignal;
  runId: string;
  nodeRunId: string;
  idempotencyKey: string | null;
  /** boolean threshold for value = pYes >= threshold (default 0.5) */
  booleanThreshold?: number;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'down';
  errorRate1m: number;
  p95LatencyMs: number;
  consecutiveFailures: number;
  lastErrorCode?: ErrorCode;
  checkedAt: string;
}

export interface DecisionProvider {
  readonly id: string; // "typesafe" | "llm" | "rule" | "human" | custom
  readonly model: string;
  readonly capabilities: { batch: boolean; maxQuestions: number; maxStateTokens: number; kinds: readonly DecisionKind[]; text: boolean; images: boolean };
  decideBoolean(state: DecisionState, question: BooleanQuestion, ctx: DecisionCallContext): Promise<BooleanDecision>;
  decideChoice(state: DecisionState, question: ChoiceQuestion, ctx: DecisionCallContext): Promise<ChoiceDecision>;
  decideScore(state: DecisionState, question: ScoreQuestion, ctx: DecisionCallContext): Promise<ScoreDecision>;
  /** Native batching: independent questions over one state in one request. Result keys mirror `questions`. */
  batch(state: DecisionState, questions: Record<string, DecisionQuestion>, ctx: DecisionCallContext): Promise<{ answers: Record<string, DecisionResult>; usage: TokenUsage; model: string; requestId: string | null; latencyMs: number }>;
  health(): ProviderHealth;
}

export interface ContentPartText { type: 'text'; text: string }
export interface ContentPartImage { type: 'image'; mimeType: string; data: string }
export type ContentPart = ContentPartText | ContentPartImage;
export interface ToolCall { id: string; name: string; args: JsonValue }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
export interface GenerationRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  responseFormat?: { type: 'text' } | { type: 'json_schema'; schema: JsonSchema; strict: boolean };
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stop?: string[];
  seed?: number;
  metadata?: Record<string, string>;
}
export interface GenerationResult {
  text: string;
  toolCalls: ToolCall[];
  structured?: JsonValue;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';
  usage: TokenUsage;
  costUsd: number;
  priceSnapshot: PriceSnapshot | null;
  latencyMs: number;
  provider: string;
  model: string;
  raw?: JsonValue;
}
export type GenerationChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; index: number; id?: string; name?: string; argsDelta: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; finishReason: GenerationResult['finishReason'] };

export interface GenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: { tools: boolean; jsonSchema: boolean; vision: boolean; streaming: boolean; thinking: boolean; maxContext: number };
  generate(req: GenerationRequest, ctx: DecisionCallContext): Promise<GenerationResult>;
  stream(req: GenerationRequest, ctx: DecisionCallContext): AsyncIterable<GenerationChunk>;
  health(): ProviderHealth;
}
export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], ctx: DecisionCallContext): Promise<{ vectors: number[][]; usage: TokenUsage; costUsd: number }>;
  health(): ProviderHealth;
}

export interface ModelInfo {
  provider: string;
  model: string;
  aliases?: string[];
  kind: 'decision' | 'chat' | 'embedding' | 'rerank';
  contextTokens?: number;
  maxOutputTokens?: number;
  pricing?: PriceSnapshot;
  deprecated?: string;
  capabilities: Record<string, boolean>;
}

/** A provider factory registered by a provider package or a node package. */
export interface ProviderFactory<T extends DecisionProvider | GenerationProvider | EmbeddingProvider> {
  id: string;
  kind: 'decision' | 'generation' | 'embedding';
  /** credential type this provider needs (undefined for rule/human/ollama-without-auth) */
  credentialType?: string;
  create(opts: { model: string; credential: Record<string, string> | undefined; options?: JsonObject; http: SafeFetch; catalog: ModelCatalog }): T;
}
export interface ModelCatalog {
  get(provider: string, model: string): ModelInfo | undefined;
  list(filter?: { provider?: string; kind?: ModelInfo['kind'] }): ModelInfo[];
  resolveAlias(provider: string, model: string): string;
  price(provider: string, model: string, usage: TokenUsage): { costUsd: number; snapshot: PriceSnapshot | null };
}

/* ────────────────────────────────────────────────────────────────────────────
 * §16  Node SDK                                       (node-sdk/src/index.ts)
 * ──────────────────────────────────────────────────────────────────────────── */

/** SSRF-guarded fetch honouring the node's AbortSignal and the workspace egress policy. */
export type SafeFetch = (url: string, init?: RequestInit & { maxRedirects?: number; maxBytes?: number }) => Promise<Response>;

export interface NodeLogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, data?: JsonValue): void;
}
export interface CredentialAccess {
  /** Decrypted credential for a declared slot. Throws CredentialError for undeclared/unbound slots. Audited. */
  get(slot: string): Promise<Record<string, string>>;
  has(slot: string): boolean;
}
export interface ProviderAccess {
  /** Failover chain [primary, ...failover]; every hop visible in DecisionResult.attempts. `human` suspends (see NodeResult). */
  decision(chain: readonly ProviderHop[], opts?: { credentialSlot?: string }): DecisionProvider;
  generation(ref: ModelRef, opts?: { credentialSlot?: string }): GenerationProvider;
  embedding(ref: ModelRef, opts?: { credentialSlot?: string }): EmbeddingProvider;
}
export interface ToolAccess {
  list(): Promise<ToolDefinition[]>;
  /** Emits TOOL_CALLED/TOOL_RETURNED; checks capability against the bound credential's scopes. */
  call(source: ToolSource, name: string, args: JsonValue, opts?: { timeoutMs?: number }): Promise<ToolResult>;
}
export interface StateAccess {
  get(namespace: 'run' | 'session' | 'workspace', key: string): Promise<JsonValue | null>;
  set(namespace: 'run' | 'session' | 'workspace', key: string, value: JsonValue, opts?: { ttlMs?: number }): Promise<void>;
  /** compare-and-set on the entry version; returns false when the version moved */
  cas(namespace: 'run' | 'session' | 'workspace', key: string, expectedVersion: number, value: JsonValue): Promise<boolean>;
}
export interface ArtifactAccess {
  put(name: string, data: Uint8Array | string, mimeType: string, opts?: { dataClass?: DataClass }): Promise<{ $artifact: string }>;
  get(id: string): Promise<Uint8Array>;
  url(id: string, ttlMs: number): Promise<string>;
}
export type NodeEmittable =
  | { type: 'METRIC'; name: string; value: number; labels?: Record<string, string> }
  | { type: 'ARTIFACT_CREATED'; artifactId: string; name: string; mimeType: string; bytes: number; dataClass: DataClass };
export interface EventAccess {
  emit(event: NodeEmittable): void;
  /** GENERATION_DELTA (ephemeral) */
  stream(channel: 'text' | 'thinking' | 'tool_args', delta: string): void;
}
export interface BudgetAccess {
  remainingCostUsd: number | null;
  remainingTokens: number | null;
  remainingMs: number;
}
/** What the node waits for when it returns NodeResult.suspend. */
export type SuspendRequest =
  | { kind: 'human'; request: Omit<HumanRequest, 'origin'> }
  | { kind: 'event'; eventName: string; timeoutMs?: number };
/** Present on re-entry after a suspension. */
export type ResumeInfo =
  | { kind: 'human'; state: JsonValue; response: HumanResponse; by: string; humanTaskId: string }
  | { kind: 'event'; state: JsonValue; payload: JsonValue }
  | { kind: 'timeout'; state: JsonValue };

export interface ExecutionContext<TConfig = JsonObject> {
  readonly run: { id: string; workflowId: string; workflowVersionId: string; environmentId: string; environment: string; workspaceId: string; origin: RunOrigin; startedAt: string; sessionId: string | null };
  readonly node: { id: NodeId; name: string; type: NodeTypeId; scope: ScopePath; attempt: number; nodeRunId: string; idempotencyKey: string | null; idempotency: Idempotency };
  /** rendered (templates/bindables resolved) and validated */
  readonly config: TConfig;
  readonly vars: Readonly<Record<string, JsonValue>>;
  readonly scope: { item?: JsonValue; index?: number; iteration?: number; carry?: JsonObject };
  /** cancellation + node timeout; nodes MUST pass it to every I/O call */
  readonly signal: AbortSignal;
  readonly logger: NodeLogger;
  readonly credentials: CredentialAccess;
  readonly providers: ProviderAccess;
  readonly tools: ToolAccess;
  readonly state: StateAccess;
  readonly artifacts: ArtifactAccess;
  readonly events: EventAccess;
  readonly budget: BudgetAccess;
  readonly http: SafeFetch;
  readonly clock: { now(): Date };
  readonly resume?: ResumeInfo;
}

export type NodeResult<TOutput> =
  | {
      kind: 'ok';
      output: TOutput;
      /** a declared control port to fire instead of `done` */
      route?: PortName;
      usage?: TokenUsage;
      costUsd?: number;
      decision?: DecisionResult;
    }
  /** Durable suspension; the runtime persists `state` and re-invokes execute() with ctx.resume. Requires capability 'suspend'. */
  | { kind: 'suspend'; wait: SuspendRequest; state: JsonValue }
  | { kind: 'error'; error: FlowaidError };

export interface OptionItem { value: string; label: string; description?: string; group?: string }
export interface OptionContext { workspaceId: string; credentials: CredentialAccess; http: SafeFetch; signal: AbortSignal; search?: string }
export type OptionProvider<TConfig> = (args: { config: Partial<TConfig>; ctx: OptionContext }) => Promise<OptionItem[]>;

export interface NodeDefinition<
  TConfig extends z.ZodObject = z.ZodObject,
  TInput extends z.ZodObject = z.ZodObject,
  TOutput extends z.ZodObject = z.ZodObject,
> {
  id: NodeTypeId;
  version: Semver;
  metadata: NodeMetadata;
  /** Fields with .meta({ 'x-ui': { widget: 'template' } }) accept {{ }} templates; .meta({ 'x-ui': { bindable: true } }) accept Bindings. */
  configSchema: TConfig;
  /** one property per input port; .optional() ⇒ required:false */
  inputSchema: TInput;
  /** one property per output port */
  outputSchema: TOutput;
  dynamicInputs?: z.ZodType;
  controlPorts?: readonly ControlPortSpec[];
  portRules?: readonly PortRule[];
  credentials?: readonly CredentialSlot[];
  capabilities: readonly NodeCapability[];
  idempotency: IdempotencySpec;
  pool?: WorkerPool;
  decision?: NodeManifest['decision'];
  generation?: boolean;
  streams?: boolean;
  defaultPolicy?: Partial<NodePolicy>;
  optionProviders?: Record<string, OptionProvider<z.output<TConfig>>>;
  /** keyed by the version the config comes FROM; must yield a config valid for the next declared version */
  migrations?: Record<string, (config: JsonValue) => JsonValue>;
  execute(ctx: ExecutionContext<z.output<TConfig>>, input: z.output<TInput>): Promise<NodeResult<z.output<TOutput>>>;
}
export type AnyNodeDefinition = NodeDefinition<z.ZodObject, z.ZodObject, z.ZodObject>;

export function defineNode<C extends z.ZodObject, I extends z.ZodObject, O extends z.ZodObject>(def: NodeDefinition<C, I, O>): NodeDefinition<C, I, O> {
  return def;
}

export interface CredentialTypeDefinition<S extends z.ZodObject = z.ZodObject> {
  id: string; // "typesafe.api_key"
  name: string;
  /** Fields; z.string().meta({ 'x-secret': true }) marks encrypted + redacted fields. Others are `publicFields`. */
  schema: S;
  /** Connection probe used by POST /v1/credentials/:id/test (runs in the worker). */
  test?: (value: z.output<S>, http: SafeFetch, signal: AbortSignal) => Promise<{ ok: boolean; message?: string }>;
  /** tool capability scopes this credential type may grant */
  scopes?: readonly string[];
}

export interface NodePackage {
  /** npm name; NodeTypeId prefix for third-party packages ("@community/slack" → "@community/slack.<name>") */
  name: string;
  version: Semver;
  nodes: readonly AnyNodeDefinition[];
  credentialTypes?: readonly CredentialTypeDefinition[];
  providers?: readonly ProviderFactory<DecisionProvider | GenerationProvider | EmbeddingProvider>[];
  /** SDK semver range the package was built against */
  sdk: string;
}
export function definePackage(pkg: NodePackage): NodePackage {
  return pkg;
}

/** Builds the JSON manifest (z.toJSONSchema target draft-2020-12 per schema). */
export declare function toManifest(def: AnyNodeDefinition): NodeManifest;

/* ────────────────────────────────────────────────────────────────────────────
 * §17  Store and infrastructure interfaces           (workflow-core/src/store.ts)
 *      Implemented by @flowaid/database (Postgres) and by in-memory test doubles in workflow-runtime/testing.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface HumanTask {
  id: string;
  workspaceId: string;
  runId: string;
  nodeRunId: string;
  nodeId: NodeId;
  scope: ScopePath;
  workflowId: string;
  request: HumanRequest;
  status: 'open' | 'responded' | 'expired' | 'cancelled';
  response: HumanResponse | null;
  respondedBy: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface RunTimer {
  id: string;
  runId: string;
  nodeRunId: string | null;
  purpose: TimerPurpose;
  fireAt: string;
}

export interface LeaseInfo {
  runId: string;
  workerId: string;
  leaseUntil: string;
  lastSeq: number;
}

export interface AppendOptions {
  /** Fencing: the append fails with WorkerLostError unless runs.lease_owner === leaseOwner and runs.last_seq === expectedSeq. */
  leaseOwner: string;
  expectedSeq: number;
}

export interface RunStore {
  createRun(run: Run, created: RunEventOf<'RUN_CREATED'>): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  /** Appends durable events with dense seq, applies projections (runs, node_runs, human_tasks, run_timers) in ONE transaction, then notifies. */
  appendEvents(runId: string, events: readonly Omit<DurableRunEvent, 'seq' | 'runId' | 'at'>[], opts: AppendOptions): Promise<{ firstSeq: number; lastSeq: number }>;
  listEvents(runId: string, afterSeq: number, limit: number, types?: readonly RunEventType[]): Promise<DurableRunEvent[]>;
  listNodeRuns(runId: string): Promise<NodeRun[]>;
  getNodeOutput(runId: string, scope: ScopePath, nodeId: NodeId): Promise<{ output: JsonValue; nodeRunId: string; attempt: number } | null>;
  /** (nodeId, scope, inputHash) → recorded output/decision for recorded replay, restart and fork. */
  recordedOutputs(runId: string): Promise<Map<string, { nodeRunId: string; output: JsonValue; firedPorts: PortName[]; decision: DecisionResult | null }>>;
  saveCheckpoint(runId: string, seq: number, state: JsonValue): Promise<void>;
  latestCheckpoint(runId: string, maxSeq: number): Promise<{ seq: number; state: JsonValue } | null>;
  acquireLease(runId: string, workerId: string, ttlMs: number): Promise<LeaseInfo | null>;
  renewLease(runId: string, workerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(runId: string, workerId: string): Promise<void>;
  expiredLeases(now: Date, limit: number): Promise<LeaseInfo[]>;
  dueTimers(now: Date, limit: number): Promise<RunTimer[]>;
  markTimerFired(timerId: string): Promise<boolean>;
  cancelRequest(runId: string): Promise<{ by: string; reason: string | null; at: string } | null>;
  getHumanTask(id: string): Promise<HumanTask | null>;
  /** CAS open → responded; returns false if the task was not open. */
  respondHumanTask(id: string, response: HumanResponse, by: string): Promise<boolean>;
}

export interface ArtifactStore {
  put(input: { workspaceId: string; runId: string | null; nodeRunId: string | null; name: string; mimeType: string; data: Uint8Array; dataClass: DataClass }): Promise<{ id: string; sha256: string; bytes: number }>;
  get(id: string): Promise<Uint8Array>;
  signedUrl(id: string, ttlMs: number): Promise<string>;
  delete(id: string): Promise<void>;
}

export type QueueName = `run:${WorkerPool}` | 'run:control' | 'schedule' | 'ingest' | 'evaluation' | 'trace_review';
export type Job =
  | { type: 'run.start'; runId: string }
  | { type: 'run.resume'; runId: string; reason: WaitReason | 'manual_retry' | 'recovery' }
  | { type: 'run.control'; runId: string; action: 'cancel'; by: string; reason: string | null }
  | { type: 'run.signal'; runId: string; signal: { type: 'subflow_completed'; childRunId: string } | { type: 'delegated_result'; nodeRunId: string } | { type: 'event'; eventName: string; payload: JsonValue } }
  | { type: 'node.exec'; runId: string; nodeRunId: string; pool: WorkerPool }
  | { type: 'timer.fire'; runId: string; timerId: string }
  | { type: 'schedule.tick'; scheduleId: string; at: string }
  | { type: 'ingest.source'; sourceId: string }
  | { type: 'evaluation.run'; evaluationRunId: string }
  | { type: 'trace_review.run'; runId: string };

export interface QueueDriver {
  enqueue(queue: QueueName, job: Job, opts?: { delayMs?: number; jobId?: string; priority?: number }): Promise<void>;
  consume(queue: QueueName, handler: (job: Job) => Promise<void>, opts: { concurrency: number }): Promise<{ stop(): Promise<void> }>;
  /** Accelerator for run_timers (authoritative rows live in Postgres). May be a no-op for the Postgres driver. */
  scheduleTimer(timer: RunTimer): Promise<void>;
  cancelTimer(timerId: string): Promise<void>;
  close(): Promise<void>;
}

export interface EventBus {
  /** Payload carries ids only ({ runId, fromSeq, toSeq }) or an ephemeral event; subscribers re-read durable events by seq. */
  publish(channel: string, message: JsonValue): Promise<void>;
  subscribe(channel: string, onMessage: (message: JsonValue) => void): Promise<() => Promise<void>>;
}

export interface CredentialRepository {
  getCiphertext(credentialId: string): Promise<{ workspaceId: string; type: string; ciphertext: string; wrappedDataKey: string; keyVersion: number; provider: string; externalRef: string | null; scopes: string[] } | null>;
  resolveBinding(workflowId: string, environmentId: string, secretName: SecretName): Promise<string | null>;
  touch(credentialId: string, usedAt: Date): Promise<void>;
}
