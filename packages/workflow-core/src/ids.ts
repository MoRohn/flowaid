/**
 * §2 Identifiers.
 *
 * Ids are plain strings validated by regex (not branded) so DB rows, JSON and
 * UI state interoperate without casts.
 */
import { z } from "zod";
import { EXPRESSION_FUNCTION_NAMES, EXPRESSION_KEYWORDS } from "./expr/functions.js";

/** snake_case, ≤64 chars. Must not equal an expression function name or keyword (`E_RESERVED_ID`). */
export const NodeIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "node id: snake_case, ≤64");
/** snake_case, ≤64 chars. */
export const PortNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, "port name: snake_case, ≤64");
/** Control edge id: lowercase alphanumerics, `_` and `-`, ≤80 chars. */
export const EdgeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
/** "flowaid.decision.choice", "flowaid.tools.http", "@community/slack.post_message" */
export const NodeTypeIdSchema = z
  .string()
  .regex(/^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/);
/** Strict `MAJOR.MINOR.PATCH` version string. */
export const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
/** Symbolic secret name declared in `WorkflowDefinition.secrets`, e.g. "TYPESAFE_API_KEY". */
export const SecretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
/** Workflow variable name (`$vars.<name>`): lowercase first letter, then alphanumerics and `_`. */
export const VarNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/);
/** "" (root) | "loop_x#3" | "loop_x#3/each_y#0" */
export const ScopePathSchema = z
  .string()
  .regex(/^$|^[a-z][a-z0-9_]{0,63}#\d+(\/[a-z][a-z0-9_]{0,63}#\d+)*$/);
/** Plan scope id: "" for the root scope, otherwise the container node id. */
export const ScopeIdSchema = z.string().regex(/^$|^[a-z][a-z0-9_]{0,63}$/);
/** Tool name as exposed to models (MCP-compatible). */
export const ToolNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** Credential type id, e.g. "typesafe.api_key". */
export const CredentialTypeIdSchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9_]*)+$/);

export type NodeId = z.infer<typeof NodeIdSchema>;
export type PortName = z.infer<typeof PortNameSchema>;
export type EdgeId = z.infer<typeof EdgeIdSchema>;
export type NodeTypeId = z.infer<typeof NodeTypeIdSchema>;
export type Semver = z.infer<typeof SemverSchema>;
export type SecretName = z.infer<typeof SecretNameSchema>;
export type VarName = z.infer<typeof VarNameSchema>;
export type ScopePath = z.infer<typeof ScopePathSchema>;
export type ScopeId = z.infer<typeof ScopeIdSchema>;

/** Reserved words that cannot be node ids: the expression keywords and the built-in function names, derived from their one definition. */
export const RESERVED_IDS: ReadonlySet<string> = new Set<string>([
  ...EXPRESSION_KEYWORDS,
  ...EXPRESSION_FUNCTION_NAMES,
]);
