/**
 * Decision contracts as code (JEV_ENGINEERING.md §4, handbook §III).
 *
 * A production Jev question is a versioned contract: state spec, instructions, outcomes or
 * rubric, escape hatch and fallback, thresholds by consequence class with governance, allowed
 * action, escalation, model and tests. Identified `<key>@<version>` and hashed canonically;
 * the {@link interfaceOf interface} is the part a workflow is compiled against.
 */
import { z } from "zod";
import {
  DataClassSchema,
  JsonPointerSchema,
  PortNameSchema,
  ProviderHopSchema,
  type JsonSchema,
} from "@flowaid/workflow-core";
import type { JsonObject } from "@flowaid/shared";
import {
  ConsequenceClassSchema,
  ContractKeySchema,
  ContractRefSchema,
  HashSchema,
  type ConsequenceClass,
  type ContractRef,
} from "./wire.js";
import { StateSpecSchema } from "./packet/spec.js";
import { contractLabel } from "./ids.js";
import { hashJson, toJsonValue } from "./json.js";
import { JevDiagnosticSchema } from "./catalog/codes.js";

/** Routing port names a contract outcome may not use. */
export const JEV_RESERVED_PORTS: ReadonlySet<string> = new Set([
  "done",
  "failed",
  "improve",
  "human",
  "legacy",
  "selected",
]);
/** Outcome keys become control ports (static menus, score bands) — PortName regex minus the reserved routing ports. */
export const OutcomeKeySchema = PortNameSchema.refine(
  (k) => !JEV_RESERVED_PORTS.has(k),
  "reserved routing port name",
);

export const EscapeKindSchema = z.enum(["none", "other", "stop", "review", "escalate"]);
export type EscapeKind = z.infer<typeof EscapeKindSchema>;

export const OutcomeSpecSchema = z.object({
  /** Evidence conditions under which this outcome is the correct branch — distinguishing, never praise (§II.A, §VIII.F). */
  description: z.string().min(1).max(2000),
  /** Marks an escape hatch (§II.A, §X.B). */
  escape: EscapeKindSchema.optional(),
  /** Stricter consequence than the contract default for this outcome (e.g. `refund` high while `faq` low). */
  consequenceClass: ConsequenceClassSchema.optional(),
  /** false ⇒ never routed `auto` (kept behind review; e.g. during rollout, or `escalate`). */
  automatable: z.boolean().default(true),
});
export const EscapeOutcomeSpecSchema = OutcomeSpecSchema.extend({ escape: EscapeKindSchema });
export type OutcomeSpec = z.infer<typeof OutcomeSpecSchema>;
export type EscapeOutcomeSpec = z.infer<typeof EscapeOutcomeSpecSchema>;

export const StaticMenuSchema = z.object({
  source: z.literal("static"),
  /** 2..255 outcomes including escapes (TypeSafe choice limit). Keys are control ports. */
  outcomes: z.record(OutcomeKeySchema, OutcomeSpecSchema),
});
export const DynamicMenuSchema = z.object({
  source: z.literal("dynamic"),
  /** Escape outcomes appended to every live option set; at least one (E_JEV_DYNAMIC_MENU_NO_ESCAPE). */
  escapes: z.record(OutcomeKeySchema, EscapeOutcomeSpecSchema),
  /** Live options before escapes; maxOptions + |escapes| ≤ 255. */
  maxOptions: z.int().min(1).max(254).default(50),
  /** Candidate ids never reach the model as keys: `ordinal` ⇒ o1…oN, `slug` ⇒ slugified id (≤ 48 chars, collision suffix). */
  keyStrategy: z.enum(["ordinal", "slug"]).default("ordinal"),
  /** Option sets older than this at evaluation are stale ⇒ route improve (rebuild) (Table VII). */
  maxAgeMs: z.int().min(1).default(60_000),
  /** Guidance shown to authors of the menu node's description lambda (§VIII.F). */
  descriptionGuidance: z.string().max(2000).optional(),
});
export type StaticMenu = z.infer<typeof StaticMenuSchema>;
export type DynamicMenu = z.infer<typeof DynamicMenuSchema>;

/** Ordinal band that turns a score into a routable outcome: levels minLevel..maxLevel (inclusive) fire `port` in the auto zone. */
export const ScoreBandSchema = z.object({
  port: OutcomeKeySchema,
  minLevel: z.int().min(0),
  maxLevel: z.int().min(0),
  consequenceClass: ConsequenceClassSchema.optional(),
  automatable: z.boolean().default(true),
});
export type ScoreBand = z.infer<typeof ScoreBandSchema>;

export const ContractQuestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    /** Operational definition; identifiers are not instructions (§III.A). */
    instructions: z.string().min(1).max(8000),
    menu: z.discriminatedUnion("source", [StaticMenuSchema, DynamicMenuSchema]),
  }),
  z.object({
    kind: z.literal("score"),
    instructions: z.string().min(1).max(8000),
    /** 2..10 ordered verbal anchors of observable evidence; 3–5 preferred (§II.B, §II.G). */
    levels: z.array(z.string().min(1).max(2000)).min(2).max(10),
    /** Bands must cover 0..levels.length-1 exactly once; absent ⇒ the score is a measurement, routed by confidence only. */
    bands: z.array(ScoreBandSchema).min(2).max(10).optional(),
  }),
  z.object({
    kind: z.literal("boolean"), // TypeSafe "noul": P(yes); 0.5 = evidence does not separate yes from no (§II.C)
    instructions: z.string().min(1).max(8000),
    /** `true.description`/`false.description` are sent as the noul criteria; ports are fixed `yes`/`no`. */
    outcomes: z.object({
      true: OutcomeSpecSchema.omit({ escape: true }),
      false: OutcomeSpecSchema.omit({ escape: true }),
    }),
    /** value = pYes ≥ yesAt — the application-defined band (§II.C). */
    yesAt: z.number().min(0).max(1).default(0.5),
  }),
]);
export type ContractQuestion = z.infer<typeof ContractQuestionSchema>;
export type ChoiceContractQuestion = Extract<ContractQuestion, { kind: "choice" }>;
export type ScoreContractQuestion = Extract<ContractQuestion, { kind: "score" }>;
export type BooleanContractQuestion = Extract<ContractQuestion, { kind: "boolean" }>;

export const ZoneThresholdsSchema = z
  .object({
    /** confidence ≥ autoAt ⇒ auto; null ⇒ this class never automates. */
    autoAt: z.number().min(0).max(1).nullable(),
    /** improveAt ≤ confidence < autoAt ⇒ improve; null ⇒ no improve zone. Below ⇒ human. */
    improveAt: z.number().min(0).max(1).nullable(),
    /** choice/score bands: top1 − top2 < minMargin demotes one zone (auto → improve → human). */
    minMargin: z.number().min(0).max(1).optional(),
  })
  .refine(
    (t) => t.autoAt === null || t.improveAt === null || t.improveAt <= t.autoAt,
    "improveAt must be ≤ autoAt",
  );
export type ZoneThresholds = z.infer<typeof ZoneThresholdsSchema>;

export const RollbackTriggerSchema = z.object({
  metric: z.enum([
    "override_rate",
    "auto_error_rate",
    "review_rate",
    "escape_rate",
    "ece",
    "stale_option_rate",
    "recovery_cost_usd",
  ]),
  op: z.enum([">", ">="]),
  value: z.number(),
  window: z.enum(["1h", "24h", "7d"]),
  minSamples: z.int().min(1).default(50),
  action: z
    .enum(["pause_candidate", "rollback_active", "pause_active", "alert_only"])
    .default("pause_candidate"),
});
export type RollbackTrigger = z.infer<typeof RollbackTriggerSchema>;

/** Thresholds are production configuration (§V.C Threshold Governance). */
export const ThresholdGovernanceSchema = z.object({
  owner: z.string().min(1),
  rationale: z.string().min(1).max(4000),
  evaluationWindow: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    source: z.enum(["shadow", "canary", "production", "evaluation", "illustrative"]),
    labeled: z.int().min(0),
    calibrationSnapshotIds: z.array(z.uuid()).default([]),
  }),
  rollbackCondition: RollbackTriggerSchema,
  approvedBy: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});
export type ThresholdGovernance = z.infer<typeof ThresholdGovernanceSchema>;

export const ImproveActionSchema = z.object({
  kind: z.enum([
    "collect_evidence",
    "deterministic_check",
    "narrow_options",
    "ask_user",
    "stronger_model",
  ]),
  /** How the state will improve — "Confidence without a different next action is decoration" (§V.B). */
  description: z.string().min(1).max(500),
});
export type ImproveAction = z.infer<typeof ImproveActionSchema>;

export const RoutingPolicySchema = z.object({
  /** Default consequence class of the action this judgment may authorise (§III.B field 6). */
  consequenceClass: ConsequenceClassSchema,
  /** Operating zones per class (§V.A, Table V). `irreversible` is not configurable: always human (§III.E). */
  thresholds: z
    .object({
      low: ZoneThresholdsSchema.optional(),
      medium: ZoneThresholdsSchema.optional(),
      high: ZoneThresholdsSchema.optional(),
    })
    .prefault({}),
  /** Required before a version may run as `canary` or become `active` in an environment. */
  governance: ThresholdGovernanceSchema.optional(),
  /** Routes of escape outcomes; `review` and `escalate` always route human. */
  escapeRoutes: z
    .object({
      none: z.enum(["improve", "human"]).default("human"),
      other: z.enum(["improve", "human"]).default("human"),
      stop: z.enum(["auto", "human"]).default("auto"),
    })
    .prefault({}),
  improve: z
    .object({
      actions: z.array(ImproveActionSchema).min(1),
      /** Improve rounds per decision lineage; each must change the packet, the option set or the contract (§V.B, §X.E). */
      maxRounds: z.int().min(1).max(5).default(2),
    })
    .optional(),
  /** Applies when `calibrated` is false (§6.4). */
  uncalibratedProviders: z.enum(["human", "improve", "allow"]).default("human"),
  /** Provider resolved a model other than `model.expectResolved` (semantic drift source). */
  onModelChange: z.enum(["continue", "human"]).default("continue"),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicySchema>;

export const ActionKindSchema = z.enum([
  "internal_routing",
  "select_model",
  "select_worker",
  "retrieval_filter",
  "annotate",
  "tool_call",
  "external_message",
  "publish",
  "purchase",
  "delete",
  "permission_change",
  "data_write",
  "money_movement",
  "represent_user",
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;
/** Upper bound on the authority the result may lead to (§III.B field 7). Proven by the compiler (§6.6). */
export const AllowedActionSchema = z.object({
  kinds: z.array(ActionKindSchema).min(1),
  /** Tool capabilities an auto route may reach, e.g. ['github.write']; [] ⇒ none. */
  capabilities: z.array(z.string().regex(/^[a-z0-9_-]+\.[a-z0-9_*.-]+$/)).default([]),
  /** Ceiling for every node reachable from an auto port. */
  maxConsequence: ConsequenceClassSchema,
  externalSideEffects: z.boolean().default(false),
});
export type AllowedAction = z.infer<typeof AllowedActionSchema>;

/** Where uncertain or consequential cases go (§III.B field 8). */
export const EscalationSchema = z.object({
  /** HumanNode.assignees format: user ids, "role:<r>", "group:<id>"; [] = anyone with runs:approve. */
  assignees: z.array(z.string()).default([]),
  /** choice: reviewer picks an outcome (becomes a label); approval: approve/reject the proposed outcome. */
  mode: z.enum(["choice", "approval"]).default("choice"),
  expiresInMs: z.int().min(1).optional(),
  onExpire: z.enum(["fail", "route", "escalate"]).default("route"),
  /** Written review/labeling rubric (§IX.E Labels and Adjudication). */
  rubric: z.string().max(8000).default(""),
});
export type Escalation = z.infer<typeof EscalationSchema>;

/** Model version (§III.B field 9). The alias is requested; the resolved version is recorded on every receipt. */
export const ContractModelSchema = z.object({
  primary: ProviderHopSchema.default({ provider: "typesafe", model: "jev-latest" }),
  failover: z.array(ProviderHopSchema).default([]),
  /** Resolved model the calibration was measured on, e.g. 'jev-1.13.0'. */
  expectResolved: z.string().optional(),
});
export type ContractModel = z.infer<typeof ContractModelSchema>;

export const FixtureCategorySchema = z.enum([
  "normal",
  "ambiguous",
  "missing_evidence",
  "adversarial",
  "stale_options",
  "rare_class",
  "no_fit",
  "incident",
  "ladder",
]);
export type FixtureCategory = z.infer<typeof FixtureCategorySchema>;
export const ContractTestsSchema = z.object({
  /** §III.F / §IX.C categories; `stale_options` applies to dynamic menus, `rare_class`/`no_fit` to choice. */
  requiredCategories: z
    .array(FixtureCategorySchema)
    .default([
      "normal",
      "ambiguous",
      "missing_evidence",
      "adversarial",
      "stale_options",
      "rare_class",
      "no_fit",
    ]),
  minPerCategory: z.int().min(1).default(3),
  minAccuracy: z.number().min(0).max(1).default(0.9),
  requireMonotonicity: z.boolean().default(true),
});

export const DecisionContractBodySchema = z.object({
  key: ContractKeySchema,
  version: z.int().min(1),
  title: z.string().min(1).max(120),
  /** The branch this contract controls and why it is semantic (inventory entry, §I.G). */
  purpose: z.string().min(1).max(2000),
  /** Accountable owner for review, thresholds and incidents. */
  owner: z.string().min(1),
  question: ContractQuestionSchema, // fields 2–3: instructions, options or rubric
  /** Field 4: used when evaluation cannot run. An escape key; null ⇒ human. */
  fallbackOutcome: z.string().nullable().default(null),
  state: StateSpecSchema, // field 1 (§5.2)
  routing: RoutingPolicySchema, // fields 5–6
  allowedAction: AllowedActionSchema, // field 7
  escalation: EscalationSchema.prefault({}), // field 8
  model: ContractModelSchema.prefault({}), // field 9 (field 10 = key@version + hash)
  tests: ContractTestsSchema.prefault({}),
  /** Required when version > 1: what changes in behaviour and why (§III.D Review). */
  changelog: z.string().max(4000).default(""),
  lintSuppressions: z
    .array(
      z.object({
        code: z.string(),
        path: JsonPointerSchema.optional(),
        reason: z.string().min(10),
      }),
    )
    .default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
export type DecisionContractBody = z.infer<typeof DecisionContractBodySchema>;
/** Author-facing input form (every defaulted field optional). */
export type DecisionContractInput = z.input<typeof DecisionContractBodySchema>;

/** Node config field of every contract-bound node. `'deployed'` follows the environment's deployment; a number pins a version. */
export const ContractBindingSchema = z.object({
  key: ContractKeySchema,
  version: z.union([z.int().min(1), z.literal("deployed")]).default("deployed"),
});
export type ContractBinding = z.infer<typeof ContractBindingSchema>;

export const ReviewCheckSchema = z.enum([
  "fields_necessary",
  "outcomes_distinguishable",
  "escape_hatch",
  "ranges_routed",
  "action_narrower",
  "exact_rules_in_code",
  "regression_replayed",
  "changes_explained",
]);
export type ReviewCheck = z.infer<typeof ReviewCheckSchema>;
export const ContractReviewSchema = z.object({
  by: z.string(),
  at: z.iso.datetime(),
  verdict: z.enum(["approved", "changes_requested"]),
  checklist: z.record(ReviewCheckSchema, z.boolean()),
  comment: z.string().max(4000).nullable(),
  /** jev.replay job whose report was reviewed (required for version > 1 with labeled history). */
  replayJobId: z.uuid().nullable(),
  contractTestJobId: z.uuid().nullable(),
});
export type ContractReview = z.infer<typeof ContractReviewSchema>;
export const ContractVersionStatusSchema = z.enum([
  "in_review",
  "approved",
  "rejected",
  "deprecated",
]);
export type ContractVersionStatus = z.infer<typeof ContractVersionStatusSchema>;
export const DecisionContractVersionSchema = z.object({
  contractId: z.uuid(),
  ref: ContractRefSchema,
  interfaceHash: HashSchema,
  body: DecisionContractBodySchema,
  status: ContractVersionStatusSchema,
  /** Lint findings at submit time. `JevDiagnostic` until RFC-0014 adds the Jev codes to `DiagnosticSchema` (J-08). */
  diagnostics: z.array(JevDiagnosticSchema),
  review: ContractReviewSchema.nullable(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type DecisionContractVersion = z.infer<typeof DecisionContractVersionSchema>;

/* ──────────────────────────── identity and hashing ──────────────────────────── */

/** Parses (and applies defaults to) a contract body; throws a `ZodError` when invalid. */
export function parseContract(input: unknown): DecisionContractBody {
  return DecisionContractBodySchema.parse(input);
}

/** Canonical JSON of a contract body: defaults applied, absent optionals dropped. */
export function canonicalContract(body: DecisionContractBody): JsonObject {
  const value = toJsonValue(DecisionContractBodySchema.parse(body));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("contract body is not a JSON object");
  }
  return value;
}

/** `sha256Json` of the canonical body (keys sorted, defaults applied): identifies the semantic program. */
export function contractHash(body: DecisionContractBody): string {
  return hashJson(canonicalContract(body));
}

/** The `ContractRef` of a registry (or implicit) contract body. */
export function contractRef(
  body: DecisionContractBody,
  origin: ContractRef["origin"] = "registry",
): ContractRef {
  return { key: body.key, version: body.version, hash: contractHash(body), origin };
}

/** `key@version` of a body. */
export function labelOf(body: Pick<DecisionContractBody, "key" | "version">): string {
  return contractLabel(body.key, body.version);
}

/* ─────────────────────────────── outcomes ─────────────────────────────── */

/** The escape outcomes of a choice contract, keyed by outcome key (empty for score/boolean). */
export function escapeOutcomes(body: DecisionContractBody): Record<string, EscapeKind> {
  const out: Record<string, EscapeKind> = {};
  const q = body.question;
  if (q.kind !== "choice") return out;
  if (q.menu.source === "static") {
    for (const [key, spec] of Object.entries(q.menu.outcomes))
      if (spec.escape) out[key] = spec.escape;
  } else {
    for (const [key, spec] of Object.entries(q.menu.escapes)) out[key] = spec.escape;
  }
  return out;
}

/** The escape kind of an outcome key, or null when the key is not an escape. */
export function escapeOf(body: DecisionContractBody, outcome: string | null): EscapeKind | null {
  if (outcome === null) return null;
  return escapeOutcomes(body)[outcome] ?? null;
}

/**
 * Outcome keys the model answers over for a static menu (non-escape and escape, in declaration
 * order), the escape keys for a dynamic menu, `true`/`false` for booleans and `0..n-1` for scores.
 */
export function declaredOutcomeKeys(body: DecisionContractBody): string[] {
  const q = body.question;
  switch (q.kind) {
    case "choice":
      return q.menu.source === "static"
        ? Object.keys(q.menu.outcomes)
        : Object.keys(q.menu.escapes);
    case "boolean":
      return ["true", "false"];
    case "score":
      return q.levels.map((_, i) => String(i));
  }
}

/** Per-outcome consequence class and automatable flag, when the contract declares them. */
export interface OutcomeTraits {
  consequenceClass: ConsequenceClass | null;
  automatable: boolean;
}

/** Consequence override and automatable flag of an outcome (option key, band port, or 'true'/'false'). */
export function outcomeTraits(body: DecisionContractBody, outcome: string | null): OutcomeTraits {
  const none: OutcomeTraits = { consequenceClass: null, automatable: true };
  if (outcome === null) return none;
  const q = body.question;
  switch (q.kind) {
    case "choice": {
      const spec = q.menu.source === "static" ? q.menu.outcomes[outcome] : q.menu.escapes[outcome];
      return spec
        ? { consequenceClass: spec.consequenceClass ?? null, automatable: spec.automatable }
        : none;
    }
    case "boolean": {
      const spec =
        outcome === "true" ? q.outcomes.true : outcome === "false" ? q.outcomes.false : undefined;
      return spec
        ? { consequenceClass: spec.consequenceClass ?? null, automatable: spec.automatable }
        : none;
    }
    case "score": {
      const band = q.bands?.find((b) => b.port === outcome);
      return band
        ? { consequenceClass: band.consequenceClass ?? null, automatable: band.automatable }
        : none;
    }
  }
}

/** Every consequence class a routed outcome of this contract can carry (default class plus overrides). */
export function reachableConsequenceClasses(body: DecisionContractBody): ConsequenceClass[] {
  const classes = new Set<ConsequenceClass>([body.routing.consequenceClass]);
  const q = body.question;
  const add = (cc: ConsequenceClass | undefined): void => {
    if (cc) classes.add(cc);
  };
  if (q.kind === "choice") {
    const specs =
      q.menu.source === "static" ? Object.values(q.menu.outcomes) : Object.values(q.menu.escapes);
    for (const s of specs) add(s.consequenceClass);
  } else if (q.kind === "boolean") {
    add(q.outcomes.true.consequenceClass);
    add(q.outcomes.false.consequenceClass);
  } else {
    for (const b of q.bands ?? []) add(b.consequenceClass);
  }
  return [...classes];
}

/* ──────────────────────────────── ports ──────────────────────────────── */

/** How the node owning the contract routes (§4.5). */
export interface OutcomePortsOptions {
  /** `inline` (default): the decide node fires routing ports; `external`: only `done`, a route node owns routing. */
  routing?: "inline" | "external";
  /** The node exposes a `legacy` port (rollout holdback path). */
  legacyPort?: boolean;
}

/** The auto-capable ports of a contract: outcomes fired in the auto zone (§6.6). */
export function autoPorts(body: DecisionContractBody): string[] {
  const q = body.question;
  const stopAuto = body.routing.escapeRoutes.stop === "auto";
  const hasStop = Object.entries(escapeOutcomes(body)).some(([, kind]) => kind === "stop");
  const stop = stopAuto && hasStop ? ["stop"] : [];
  switch (q.kind) {
    case "choice":
      if (q.menu.source === "static") {
        return [
          ...Object.entries(q.menu.outcomes)
            .filter(([, spec]) => spec.escape === undefined)
            .map(([key]) => key),
          ...stop,
        ];
      }
      return ["selected", ...stop];
    case "boolean":
      return ["yes", "no"];
    case "score":
      return q.bands ? q.bands.map((b) => b.port) : [];
  }
}

/**
 * Control-outs of a contract-bound decide node (§4.5 table): inline routing fires one port per
 * non-escape outcome (or `selected`, band ports, `yes`/`no`), `stop` when stop routes auto,
 * `improve` when the contract declares improve actions, `human`, and `legacy` when enabled.
 * Unbanded scores are measurements and fire `done`; external routing fires only `done`.
 */
export function outcomePorts(
  body: DecisionContractBody,
  options: OutcomePortsOptions = {},
): string[] {
  const routing = options.routing ?? "inline";
  if (routing === "external") return ["done"];
  const q = body.question;
  if (q.kind === "score" && !q.bands) return ["done"];
  const ports = autoPorts(body);
  if (body.routing.improve) ports.push("improve");
  ports.push("human");
  if (options.legacyPort === true) ports.push("legacy");
  return ports;
}

/** The port an outcome fires in the auto zone (option key, `selected`, band port, `yes`/`no`, `stop`). */
export function portForOutcome(body: DecisionContractBody, outcome: string): string | null {
  const q = body.question;
  const escape = escapeOf(body, outcome);
  if (escape === "stop") return "stop";
  if (escape !== null) return null;
  switch (q.kind) {
    case "choice":
      return q.menu.source === "static" ? (q.menu.outcomes[outcome] ? outcome : null) : "selected";
    case "boolean":
      return outcome === "true" ? "yes" : outcome === "false" ? "no" : null;
    case "score":
      return q.bands?.some((b) => b.port === outcome) === true ? outcome : null;
  }
}

/* ────────────────────────────── interface ────────────────────────────── */

/** The part of a contract a workflow is compiled against (§4.1). */
export interface ContractInterface {
  kind: ContractQuestion["kind"];
  /** Routable ports under inline routing (sorted). */
  ports: string[];
  /** Escape outcome keys → kind. */
  escapes: Record<string, EscapeKind>;
  /** Static outcome keys (choice, static menu), sorted; [] otherwise. */
  outcomes: string[];
  /** Score level count, null for other kinds. */
  levels: number | null;
  /** Score bands (port → [min, max]), null when unbanded or not a score. */
  bands: Record<string, [number, number]> | null;
  /** Choice menu source, null for other kinds. */
  menuSource: "static" | "dynamic" | null;
  /** Declared state fields: role, JSON Schema and required flag. */
  state: Record<string, { role: string; schema: JsonSchema; required: boolean }>;
}

/**
 * The compile-time interface of a contract: kind, routable ports, escapes, outcome keys, level
 * count, bands, menu source and the state fields' names, roles, schemas and `required` flags.
 * Instructions, descriptions, thresholds, governance, model, tests and changelog are not
 * interface — they change behaviour without changing wiring.
 */
export function interfaceOf(body: DecisionContractBody): ContractInterface {
  const q = body.question;
  const state: ContractInterface["state"] = {};
  for (const name of Object.keys(body.state.fields).sort()) {
    const field = body.state.fields[name];
    if (field) state[name] = { role: field.role, schema: field.schema, required: field.required };
  }
  let bands: ContractInterface["bands"] = null;
  if (q.kind === "score" && q.bands) {
    bands = {};
    for (const b of q.bands) bands[b.port] = [b.minLevel, b.maxLevel];
  }
  return {
    kind: q.kind,
    ports: outcomePorts(body).sort(),
    escapes: escapeOutcomes(body),
    outcomes:
      q.kind === "choice" && q.menu.source === "static" ? Object.keys(q.menu.outcomes).sort() : [],
    levels: q.kind === "score" ? q.levels.length : null,
    bands,
    menuSource: q.kind === "choice" ? q.menu.source : null,
    state,
  };
}

/** `sha256Json(interfaceOf(body))`: versions with equal interface hashes are interchangeable at run start. */
export function interfaceHash(body: DecisionContractBody): string {
  return hashJson(interfaceOf(body));
}

/** Two contract versions can replace each other in a compiled workflow. */
export function isInterfaceCompatible(a: DecisionContractBody, b: DecisionContractBody): boolean {
  return interfaceHash(a) === interfaceHash(b);
}

/* ─────────────────────────────── JSON Schema ─────────────────────────────── */

function toJsonSchema(schema: z.ZodType): JsonObject {
  const value = toJsonValue(z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("JSON Schema generation did not produce an object");
  }
  return value;
}

/** JSON Schema (draft 2020-12, input form) of a contract body, for manifests, editors and OpenAPI. */
export const DecisionContractBodyJsonSchema: JsonObject = toJsonSchema(DecisionContractBodySchema);
/** JSON Schema of a node's `contract` config field. */
export const ContractBindingJsonSchema: JsonObject = toJsonSchema(ContractBindingSchema);
/** JSON Schema of a frozen contract version. */
export const DecisionContractVersionJsonSchema: JsonObject = toJsonSchema(
  DecisionContractVersionSchema,
);
/** Exposed so other modules can generate their constants the same way. */
export { toJsonSchema as jsonSchemaOf };

/** Data classes in ascending order of sensitivity. */
export const DATA_CLASS_ORDER = DataClassSchema.options;
