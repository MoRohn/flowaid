/**
 * §12 Compiler diagnostics: every code, its location model and optional quick fix.
 */
import { z } from "zod";
import { JsonPatchOpSchema, JsonPointerSchema } from "./json.js";
import { EdgeIdSchema, NodeIdSchema, PortNameSchema, ScopeIdSchema } from "./ids.js";

/** Every diagnostic code the compiler, publisher or importer can emit (`E_` error, `W_` warning, `I_` info). */
export const DiagnosticCodeSchema = z.enum([
  // schema & structure
  "E_SCHEMA",
  "E_DUPLICATE_NODE_ID",
  "E_DUPLICATE_EDGE_ID",
  "E_RESERVED_ID",
  "W_DUPLICATE_NAME",
  "E_NO_INPUT_NODE",
  "E_MULTIPLE_INPUT_NODES",
  "E_NO_OUTPUT_NODE",
  "E_PARENT_NOT_CONTAINER",
  "E_SCOPE_DEPTH",
  // catalog & config
  "E_UNKNOWN_NODE_TYPE",
  "E_NODE_VERSION_UNSUPPORTED",
  "I_NODE_VERSION_OUTDATED",
  "W_NODE_DEPRECATED",
  "E_CONFIG_INVALID",
  "E_PORT_RULE_INVALID",
  "E_TOOL_UNRESOLVED",
  "E_TOOL_SCHEMA_INVALID",
  "E_POOL_NOT_ALLOWED",
  "E_PLUGIN_ID_PREFIX",
  // edges & ports
  "E_EDGE_ENDPOINT_MISSING",
  "E_EDGE_CROSSES_SCOPE",
  "E_UNKNOWN_CONTROL_PORT",
  "E_SELF_EDGE",
  "E_INPUT_UNKNOWN_PORT",
  "E_INPUT_REQUIRED_MISSING",
  "E_INPUT_LITERAL_INVALID",
  "W_CONTROL_PORT_UNCONNECTED",
  // refs, templates, expressions
  "E_REF_UNKNOWN_NODE",
  "E_REF_UNKNOWN_PORT",
  "E_REF_PATH_INVALID",
  "W_REF_PATH_UNTYPED",
  "E_REF_SELF",
  "E_REF_SCOPE_VIOLATION",
  "E_SCOPE_REF_OUTSIDE_SCOPE",
  "E_TEMPLATE_SYNTAX",
  "E_TEMPLATE_OBJECT_COERCION",
  "E_EXPR_SYNTAX",
  "E_EXPR_TYPE",
  "W_EXPR_UNTYPED",
  "E_EXPR_NOT_BOOLEAN",
  "E_EXPR_REGEX_DYNAMIC",
  "E_EXPR_REGEX_UNSAFE",
  // dependency & control-flow analysis
  "E_CYCLE",
  "E_CONDITIONAL_DATA_DEP",
  "W_NULLABLE_INPUT",
  "W_UNREACHABLE",
  "E_DANGLING_DEPENDENCY",
  "I_DANGLING_OUTPUT",
  "E_CONTROL_AMBIGUOUS",
  "I_CONTROL_AND",
  "W_IMPOSSIBLE_BRANCH",
  "W_BRANCH_SHADOWED",
  "W_UNREACHABLE_ROUTE",
  "E_JOIN_CONFIG",
  "W_OUTPUT_AMBIGUOUS",
  "E_OUTPUT_UNBOUND",
  "E_OUTPUT_SCHEMA_MISMATCH",
  "I_BATCH_GROUP",
  // types
  "E_TYPE_MISMATCH",
  "W_TYPE_UNVERIFIED",
  // containers
  "W_LOOP_NO_EXIT",
  "W_LOOSE_BOUNDS",
  "E_FOREACH_NOT_ARRAY",
  "E_FOREACH_COLLECT_MISSING",
  "E_CARRY_TYPE_MISMATCH",
  // subflows
  "E_SUBFLOW_UNRESOLVED",
  "E_SUBFLOW_CYCLE",
  "E_SUBFLOW_DEPTH",
  "E_SUBFLOW_SIGNATURE",
  // secrets, variables, credentials, providers
  "E_SECRET_UNDECLARED",
  "W_SECRET_UNUSED",
  "E_SECRET_UNBOUND",
  "W_SECRET_UNBOUND",
  "E_CREDENTIAL_SLOT_UNBOUND",
  "E_CREDENTIAL_TYPE_MISMATCH",
  "E_CAPABILITY_MISSING",
  "E_VARIABLE_UNDECLARED",
  "E_VARIABLE_DEFAULT_INVALID",
  "W_VARIABLE_UNUSED",
  "E_PROVIDER_UNAVAILABLE",
  "W_PROVIDER_UNAVAILABLE",
  "W_MODEL_DEPRECATED",
  "W_FAILOVER_UNCONFIGURED",
  // decisions, human, agent, policy
  "E_DECISION_CONFIG",
  "E_HUMAN_CONFIG",
  "E_AGENT_UNBOUNDED",
  "E_RETRY_ON_IRREVERSIBLE",
  "W_RETRY_SIDE_EFFECT",
  "E_DONOTPERSIST_SIDE_EFFECT",
  // publish-time & runtime
  "E_TRIGGER_CONFLICT",
  "W_COST_ESTIMATE",
  "W_REGRESSION",
  "E_PLAN_HASH_MISMATCH",
  "E_IMPORT_UNSUPPORTED",
  "E_INTERNAL",
]);
export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;

/** One compiler finding with its location and optional quick fix. */
export const DiagnosticSchema = z.object({
  code: DiagnosticCodeSchema,
  severity: z.enum(["error", "warning", "info"]),
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
  related: z
    .array(
      z.object({
        nodeId: NodeIdSchema.optional(),
        edgeId: EdgeIdSchema.optional(),
        message: z.string(),
      }),
    )
    .optional(),
  /** RFC 6902 quick fix applied to the definition. */
  fix: z.object({ title: z.string(), patch: z.array(JsonPatchOpSchema) }).optional(),
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
