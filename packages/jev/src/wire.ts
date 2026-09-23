/**
 * RFC-0013 wire types (JEV_ENGINEERING.md §12.1, CONTRACTS.ts §7.1 once accepted).
 *
 * These are the only Jev types that run events, node outputs and plans must carry. Until J-08
 * moves them into `@flowaid/workflow-core` they are defined here verbatim; `wire.test.ts`
 * checks parity with the §12.1 code block of the addendum, so the two cannot drift.
 */
import { z } from "zod";
import {
  JsonObjectSchema,
  JsonPrimitiveSchema,
  NodeIdSchema,
  PortNameSchema,
  ProviderAttemptSchema,
  ScopePathSchema,
} from "@flowaid/workflow-core";

export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const ContractKeySchema = z
  .string()
  .max(96)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/);
export const ConsequenceClassSchema = z.enum(["low", "medium", "high", "irreversible"]);
export const JevRouteSchema = z.enum(["auto", "improve", "human"]);
export const RolloutDispositionSchema = z.enum(["active", "canary", "holdback", "shadow"]);
export const DecisionModeSchema = z.enum(["live", "shadow", "replay", "evaluation"]);
export const PolicyVerdictSchema = z.enum(["allow", "review", "deny"]);
export const RouteReasonSchema = z.enum([
  "zone_auto",
  "zone_improve",
  "zone_human",
  "margin_below_min",
  "thresholds_illustrative",
  "consequence_irreversible",
  "outcome_not_automatable",
  "escape_outcome",
  "stop_outcome",
  "provider_uncalibrated",
  "model_version_changed",
  "improve_budget_exhausted",
  "blind_retry_blocked",
  "packet_over_budget",
  "stale_evidence",
  "stale_option",
  "state_race",
  "fallback_outcome",
  "rollout_shadow",
  "rollout_holdback",
  "rollout_scope",
  "policy_review",
  "policy_deny",
  "legacy_gate",
]);
export type ConsequenceClass = z.infer<typeof ConsequenceClassSchema>;
export type JevRoute = z.infer<typeof JevRouteSchema>;
export type RouteReason = z.infer<typeof RouteReasonSchema>;
export type RolloutDisposition = z.infer<typeof RolloutDispositionSchema>;
export type DecisionMode = z.infer<typeof DecisionModeSchema>;
export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>;

/** Identifies the semantic program (Table III contract_version). */
export const ContractRefSchema = z.object({
  key: ContractKeySchema,
  version: z.int().min(1),
  hash: HashSchema,
  origin: z.enum(["registry", "implicit"]),
});
export type ContractRef = z.infer<typeof ContractRefSchema>;

/** Links to the evaluated evidence snapshot (Table III state_reference). */
export const StateReferenceSchema = z.object({
  stateVersion: z.string().max(200), // "<runId>:<scope>@<seq>"
  packetHash: HashSchema, // sha256 of the packet as sent
  snapshotId: z.string().nullable(), // decision_snapshots key; null when not persisted
  fidelity: z.enum(["exact", "redacted", "not_persisted"]),
});
/** Explains the operating zone (Table III selected_threshold). */
export const ThresholdAppliedSchema = z.object({
  consequenceClass: ConsequenceClassSchema,
  autoAt: z.number().min(0).max(1).nullable(),
  improveAt: z.number().min(0).max(1).nullable(),
  minMargin: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(), // routing confidence used (§6.2); null without an evaluation
  margin: z.number().min(0).max(1).nullable(),
  illustrative: z.boolean(),
  source: z.string().max(300), // "support.router@4#/routing/thresholds/low" | "legacy:<gateNodeId>"
});
/** Identifies the option-set version (§VIII.H). */
export const OptionSetRefSchema = z.object({
  version: HashSchema,
  source: z.enum(["static", "dynamic"]),
  size: z.int().min(1).max(255),
  escapeKeys: z.array(z.string()),
  counts: z
    .object({
      original: z.int().min(0),
      kept: z.int().min(0),
      eligible: z.int().min(0),
      shortlisted: z.int().min(0),
      final: z.int().min(0),
    })
    .nullable(),
  ageMs: z.int().min(0).nullable(),
});
/** Connects judgment to execution (Table III resulting_action): what the policy permitted and the runtime fired. */
export const AuthorizedActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fire_port"), port: PortNameSchema }),
  z.object({ kind: z.literal("tool_call"), tool: z.string(), proposalHash: HashSchema }),
  z.object({
    kind: z.literal("human_review"),
    port: PortNameSchema.nullable(),
    inline: z.boolean(),
  }),
  z.object({ kind: z.literal("improve"), port: PortNameSchema }),
  z.object({ kind: z.literal("legacy"), port: PortNameSchema }),
  z.object({
    kind: z.literal("none"),
    reason: z.enum(["shadow", "denied", "external_routing"]),
  }),
]);
export const PolicyRecordSchema = z.object({
  id: z.string().max(200), // 'jev.default@1' | 'tool_gate:<nodeId>' | 'legacy_gate'
  verdict: PolicyVerdictSchema,
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullable() })),
  proofId: HashSchema.nullable(), // compile-time authority proof (§6.6)
});
/** One authority policy applied to the distribution (§III.E: one judgment, several policies). */
export const RoutingRecordSchema = z.object({
  routedBy: z.object({ nodeId: NodeIdSchema, nodeRunId: z.uuid() }),
  consequenceClass: ConsequenceClassSchema, // Table III consequence_class
  threshold: ThresholdAppliedSchema,
  route: JevRouteSchema, // Table III route
  reasons: z.array(RouteReasonSchema),
  disposition: RolloutDispositionSchema,
  policy: PolicyRecordSchema,
  authorizedAction: AuthorizedActionSchema,
  at: z.iso.datetime(),
});
export const ExecutedActionSchema = z.object({
  kind: z.enum(["node", "tool_call", "human_task"]),
  nodeId: NodeIdSchema.nullable(),
  nodeRunId: z.uuid().nullable(),
  toolCallId: z.string().nullable(),
  humanTaskId: z.uuid().nullable(),
  status: z.enum(["completed", "failed", "skipped", "cancelled"]),
  failure: z.enum(["stale_option", "error"]).nullable(),
  at: z.iso.datetime(),
});
export const DecisionOverrideSchema = z.object({
  by: z.string(),
  at: z.iso.datetime(),
  from: z.string().nullable(),
  to: z.string(),
  route: JevRouteSchema.nullable(),
  reason: z.string().max(4000).nullable(),
  source: z.enum(["human_task", "api"]),
});
export const DecisionReceiptSchema = z.object({
  receiptId: z.uuid(),
  runId: z.uuid(),
  nodeRunId: z.uuid(),
  nodeId: NodeIdSchema,
  scope: ScopePathSchema,
  question: z.string().min(1).max(64), // node id for single decisions, the author's key in bundles
  bundleId: z.string().max(200),
  batchId: z.string().max(200).nullable(), // provider request; null when no request was made
  mode: DecisionModeSchema,
  contract: ContractRefSchema,
  kind: z.enum(["boolean", "choice", "score"]),
  stateReference: StateReferenceSchema,
  evidenceScope: z.object({ fields: z.array(z.string()), evidenceIds: z.array(z.string()) }), // §VI.C
  optionSet: OptionSetRefSchema.nullable(), // choice only
  rubric: z.array(z.string()).nullable(), // score level texts as evaluated (§II.G)
  outcome: z.string().nullable(),
  escape: z.enum(["none", "other", "stop", "review", "escalate"]).nullable(),
  distribution: z.record(z.string(), z.number().min(0).max(1)), // Table III full_distribution; {} only for a fallback or an unevaluated holdback (§6.7)
  bandMass: z.record(z.string(), z.number().min(0).max(1)).nullable(),
  value: JsonPrimitiveSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  model: z.object({ provider: z.string(), requested: z.string(), resolved: z.string().nullable() }),
  requestId: z.string().nullable(),
  latencyMs: z.int().min(0),
  costUsd: z.number().min(0),
  attempts: z.array(ProviderAttemptSchema),
  reused: z.boolean(), // blind-retry guard reused an earlier distribution
  staleness: z.object({
    optionSetAgeMs: z.int().min(0).nullable(),
    staleEvidence: z.array(z.string()),
    raceRecorded: z.boolean(),
  }),
  routings: z.array(RoutingRecordSchema), // [] until routed
  at: z.iso.datetime(),
});
export type DecisionReceipt = z.infer<typeof DecisionReceiptSchema>;
/** Compact output port `receipt` of contract nodes. */
export const ReceiptRefSchema = z.object({
  receiptId: z.uuid(),
  contract: ContractRefSchema,
  outcome: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  route: JevRouteSchema.nullable(),
  disposition: RolloutDispositionSchema.nullable(),
  consequenceClass: ConsequenceClassSchema.nullable(),
  stateVersion: z.string(),
});
/** Run-start resolution of one contract key in the run's environment (RUN_CREATED.contracts). */
export const ResolvedContractSchema = z.object({
  key: ContractKeySchema,
  via: z.enum(["deployed", "pinned", "undeployed", "local"]), // §4.4 step 4; implicit contracts are never resolved here (§4.4 step 5)
  environmentId: z.uuid().nullable(),
  /** `calibrated`: computed per version and environment at run start (§6.4). */
  active: z
    .object({
      version: z.int().min(1),
      hash: HashSchema,
      interfaceHash: HashSchema,
      stage: z.enum(["shadow", "active", "paused"]),
      calibrated: z.boolean(),
    })
    .nullable(),
  candidate: z
    .object({
      version: z.int().min(1),
      hash: HashSchema,
      interfaceHash: HashSchema,
      stage: z.enum(["shadow", "canary"]),
      calibrated: z.boolean(),
    })
    .nullable(),
  guardrails: JsonObjectSchema, // RolloutGuardrails, validated by @flowaid/jev
  guardrailsHash: HashSchema,
});

export type StateReference = z.infer<typeof StateReferenceSchema>;
export type ThresholdApplied = z.infer<typeof ThresholdAppliedSchema>;
export type OptionSetRef = z.infer<typeof OptionSetRefSchema>;
export type AuthorizedAction = z.infer<typeof AuthorizedActionSchema>;
export type PolicyRecord = z.infer<typeof PolicyRecordSchema>;
export type RoutingRecord = z.infer<typeof RoutingRecordSchema>;
export type ExecutedAction = z.infer<typeof ExecutedActionSchema>;
export type DecisionOverride = z.infer<typeof DecisionOverrideSchema>;
export type ReceiptRef = z.infer<typeof ReceiptRefSchema>;
export type ResolvedContract = z.infer<typeof ResolvedContractSchema>;
