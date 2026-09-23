/**
 * State packets (JEV_ENGINEERING.md §5.1–§5.2, handbook §IV, Table IV).
 *
 * The object sent as TypeSafe `state` for a contract-bound question is always a
 * {@link StatePacket}: the handbook's seven functional fields in canonical order. Which bound
 * values may enter it, under which role, data class, budget and freshness rule, is declared by
 * the contract's {@link StateSpec} — least privilege is a declaration, not a filter.
 */
import { z } from "zod";
import { DataClassSchema, JsonObjectSchema, JsonSchemaSchema } from "@flowaid/workflow-core";
import { TYPESAFE_LIMITS } from "../limits.js";

/** Observable evidence for the next judgment (§IV.B) with provenance and freshness. */
export const EvidenceItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/), // cited by verifiers and generation prompts (§VIII.E)
  kind: z.string().min(1).max(64), // 'official_docs' | 'launch_post' | 'tool_result' | 'customer_message' | …
  supports: z.array(z.string().max(64)).max(32).default([]), // claims / aspects this item bears on (support relations)
  summary: z.string().max(4000).optional(), // observable content, not a conclusion (§IV.B)
  source: z
    .object({ uri: z.string().max(2048).optional(), ref: z.string().max(256).optional() })
    .optional(),
  observedAt: z.iso.datetime().optional(), // freshness (§IV.D)
  version: z.string().max(128).optional(), // content version or hash (Table VII "Re-fetch and version")
  verified: z.boolean().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/** An output that already exists (draft, report, patch, file). */
export const ArtifactItemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/),
  kind: z.string().min(1).max(64), // 'draft' | 'report' | 'patch' | 'file' | …
  ref: z.string().max(512).optional(), // artifact id / path
  hash: z.string().max(128).optional(), // Table VII "Resolve current path and hash"
  summary: z.string().max(2000).optional(),
});
export type ArtifactItem = z.infer<typeof ArtifactItemSchema>;

/** The compact, current, evidence-based packet sent as TypeSafe `state` (Table IV). */
export const StatePacketSchema = z.object({
  goal: z.string().max(2000).optional(), // defines success for the current task
  facts: JsonObjectSchema.optional(), // what the system currently knows (exact values)
  artifacts: z.array(ArtifactItemSchema).optional(), // outputs that already exist
  evidence: z.array(EvidenceItemSchema).optional(), // supports the next semantic judgment
  constraints: JsonObjectSchema.optional(), // boundaries the system may not cross
  options: JsonObjectSchema.optional(), // what can happen now (context; the menu itself is in the question)
  stateVersion: z.string(), // "<runId>:<scope>@<seq>" — the exact evaluated snapshot
});
export type StatePacket = z.infer<typeof StatePacketSchema>;

/** Functional role of a declared field (Table IV). */
export const PacketRoleSchema = z.enum([
  "goal",
  "fact",
  "artifact",
  "evidence",
  "constraint",
  "option",
]);
export type PacketRole = z.infer<typeof PacketRoleSchema>;

/** One declared state field of a contract (§5.2). */
export const PacketFieldSpecSchema = z.object({
  role: PacketRoleSchema,
  /** Why the field is present (§IV.E); shown in review and the packet viewer. */
  description: z.string().min(1).max(500),
  /** JSON Schema of the bound value; evidence/artifact roles expect arrays of Evidence/ArtifactItem. */
  schema: JsonSchemaSchema,
  required: z.boolean().default(true),
  /** Highest data class the field may carry. */
  dataClass: DataClassSchema.default("internal"),
  /** Applied before sending when the provider is not eligible for the field's class (§5.6); 'error' fails the node. */
  redact: z.enum(["error", "mask", "hash", "drop"]).default("error"),
  /** Declared minimization (§IV.E): max serialized characters of this field. */
  maxChars: z.int().min(1).max(120_000).optional(),
  overflow: z.enum(["error", "truncate_marked"]).default("error"),
  /** Freshness (§IV.D): evidence/artifact items older than maxAgeMs are stale. */
  freshness: z
    .object({ maxAgeMs: z.int().min(1), requireVersion: z.boolean().default(false) })
    .optional(),
  /** role evidence/artifact: declared selection — never ad-hoc truncation. */
  selection: z
    .object({
      maxItems: z.int().min(1).max(200).default(20),
      order: z.enum(["as_bound", "observed_desc"]).default("as_bound"),
    })
    .optional(),
});
export type PacketFieldSpec = z.infer<typeof PacketFieldSpecSchema>;

/** Batching latency class (§VI.D). */
export const LatencyClassSchema = z.enum(["interactive", "standard", "batch"]);
export type LatencyClass = z.infer<typeof LatencyClassSchema>;

/** The state part of a decision contract (§III.B field 1, §5.2). */
export const StateSpecSchema = z.object({
  /** Constant goal text; alternatively one field with role 'goal'. */
  goal: z.string().max(2000).optional(),
  fields: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), PacketFieldSpecSchema)
    .refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 64, "1..64 fields"),
  /** Compactness budget in estimated tokens (chars / 3.5). ≤ 30 000 so the longest question fits the 32k limit. */
  maxTokens: z
    .int()
    .min(256)
    .max(TYPESAFE_LIMITS.maxPacketTokens)
    .default(TYPESAFE_LIMITS.defaultPacketTokens),
  /** Declared maximum data class of the packet — least privilege and the batching privacy class. */
  privacyClass: DataClassSchema,
  /** Batching latency class: interactive = a user is waiting; standard; batch = background. */
  latencyClass: LatencyClassSchema.default("standard"),
  /** 'strict' re-checks versioned sources after evaluation; 'record' records the race (§VI.C). */
  consistency: z.enum(["record", "strict"]).default("record"),
});
export type StateSpec = z.infer<typeof StateSpecSchema>;
/** Author-facing input form of {@link StateSpec} (defaults optional). */
export type StateSpecInput = z.input<typeof StateSpecSchema>;
