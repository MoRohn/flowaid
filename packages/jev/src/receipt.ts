/**
 * Decision receipts (JEV_ENGINEERING.md §12, handbook §III.D Table III, §III.G, §VI.D, §X.F).
 *
 * *"Every production decision should produce a receipt… the minimum unit for auditing,
 * calibration, incident review, and comparison between contract versions."* A receipt links
 * judgment (full distribution, never winner-only), snapshot (state version + packet hash),
 * contract version, option-set version, rubric, threshold, consequence class, route, policy and
 * authorised action — the safe order *judge → policy → execute → record* made visible.
 *
 * Receipts are immutable; `ReceiptChain` links them in a tamper-evident hash chain (each link
 * commits to the receipt hash and the previous link), so an audit can prove that no receipt of
 * a run or contract was altered, dropped or reordered.
 */
import { z } from "zod";
import type { DecisionResult, ProviderAttempt } from "@flowaid/workflow-core";
import { staticOptionSetRef } from "./menu.js";
import type { DecisionContractBody, EscapeKind } from "./contract.js";
import { hashJson } from "./json.js";
import { routingSignal } from "./routing/confidence.js";
import type { RouteResult } from "./routing/route.js";
import {
  DecisionReceiptSchema,
  HashSchema,
  type AuthorizedAction,
  type ContractRef,
  type DecisionMode,
  type DecisionReceipt,
  type OptionSetRef,
  type PolicyRecord,
  type ReceiptRef,
  type RolloutDisposition,
  type RoutingRecord,
  type StateReference,
} from "./wire.js";

/** Everything {@link buildReceipt} needs; the judgment is read from `decision` under `contract`. */
export interface BuildReceiptInput {
  receiptId: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  scope: string;
  /** Node id for single decisions, the author's key in bundles. */
  question: string;
  bundleId: string;
  batchId: string | null;
  mode: DecisionMode;
  contract: DecisionContractBody;
  contractRef: ContractRef;
  stateReference: StateReference;
  evidenceScope: { fields: string[]; evidenceIds: string[] };
  /** Dynamic menus: the live option set ref; static menus are derived from the contract. */
  optionSet?: OptionSetRef | null;
  /** null for a fallback or an unevaluated holdback (distribution `{}`). */
  decision: DecisionResult | null;
  /** Overrides the outcome read from the decision (e.g. the fallback outcome). */
  outcome?: string | null;
  escape?: EscapeKind | null;
  model: { provider: string; requested: string; resolved: string | null };
  requestId?: string | null;
  latencyMs?: number;
  costUsd?: number;
  attempts?: ProviderAttempt[];
  reused?: boolean;
  staleness?: DecisionReceipt["staleness"];
  routings?: RoutingRecord[];
  at: string;
}

/** Builds and validates a receipt (§12.1). Throws a `ZodError` when a field is out of contract. */
export function buildReceipt(input: BuildReceiptInput): DecisionReceipt {
  const body = input.contract;
  const q = body.question;
  const signal = input.decision ? routingSignal(body, input.decision) : null;
  const outcome =
    input.outcome !== undefined ? input.outcome : (signal?.outcome ?? body.fallbackOutcome);
  const escape = input.escape !== undefined ? input.escape : (signal?.escape ?? null);
  let optionSet: OptionSetRef | null = null;
  if (q.kind === "choice") optionSet = input.optionSet ?? staticOptionSetRef(body);
  const receipt: DecisionReceipt = {
    receiptId: input.receiptId,
    runId: input.runId,
    nodeRunId: input.nodeRunId,
    nodeId: input.nodeId,
    scope: input.scope,
    question: input.question,
    bundleId: input.bundleId,
    batchId: input.batchId,
    mode: input.mode,
    contract: input.contractRef,
    kind: q.kind,
    stateReference: input.stateReference,
    evidenceScope: {
      fields: [...input.evidenceScope.fields],
      evidenceIds: [...input.evidenceScope.evidenceIds],
    },
    optionSet,
    rubric: q.kind === "score" ? [...q.levels] : null,
    outcome,
    escape,
    distribution: signal ? { ...signal.distribution } : {},
    bandMass: signal?.bandMass ? { ...signal.bandMass } : null,
    value: input.decision ? input.decision.value : null,
    confidence: signal ? signal.confidence : null,
    model: { ...input.model },
    requestId: input.requestId ?? input.decision?.requestId ?? null,
    latencyMs: input.latencyMs ?? input.decision?.latencyMs ?? 0,
    costUsd: input.costUsd ?? input.decision?.costUsd ?? 0,
    attempts: input.attempts ?? input.decision?.attempts ?? [],
    reused: input.reused ?? false,
    staleness: input.staleness ?? {
      optionSetAgeMs: optionSet?.ageMs ?? null,
      staleEvidence: [],
      raceRecorded: false,
    },
    routings: input.routings ?? [],
    at: input.at,
  };
  return DecisionReceiptSchema.parse(receipt);
}

/** The default policy record when only the routing engine and the compile-time proof applied. */
export function defaultPolicyRecord(input: {
  route: RouteResult;
  proofId?: string | null;
  id?: string;
}): PolicyRecord {
  const verdict = input.route.route === "auto" ? "allow" : "review";
  return {
    id: input.id ?? "jev.default@1",
    verdict,
    checks: [
      {
        name: "allowed_action_proof",
        ok: true,
        detail:
          input.proofId === undefined || input.proofId === null
            ? "no compile-time proof supplied"
            : null,
      },
      { name: "route", ok: input.route.route === "auto", detail: input.route.reasons.join(", ") },
    ],
    proofId: input.proofId ?? null,
  };
}

/** The action a route authorises (§6.6): the auto port, the improve port or a human review. */
export function authorizedActionFor(
  route: RouteResult,
  options: { inlineEscalation?: boolean; shadow?: boolean } = {},
): AuthorizedAction {
  if (options.shadow === true) return { kind: "none", reason: "shadow" };
  switch (route.route) {
    case "auto":
      return route.port === null
        ? { kind: "none", reason: "external_routing" }
        : { kind: "fire_port", port: route.port };
    case "improve":
      return { kind: "improve", port: "improve" };
    case "human":
      return options.inlineEscalation === true
        ? { kind: "human_review", port: null, inline: true }
        : { kind: "human_review", port: "human", inline: false };
  }
}

/** A routing record (one authority policy applied to the distribution, §III.E). */
export function routingRecord(input: {
  route: RouteResult;
  routedBy: { nodeId: string; nodeRunId: string };
  disposition?: RolloutDisposition;
  policy?: PolicyRecord;
  authorizedAction?: AuthorizedAction;
  at: string;
}): RoutingRecord {
  return {
    routedBy: { ...input.routedBy },
    consequenceClass: input.route.consequenceClass,
    threshold: { ...input.route.threshold },
    route: input.route.route,
    reasons: [...input.route.reasons],
    disposition: input.disposition ?? "active",
    policy: input.policy ?? defaultPolicyRecord({ route: input.route }),
    authorizedAction: input.authorizedAction ?? authorizedActionFor(input.route),
    at: input.at,
  };
}

/** Appends a routing to a receipt (a new receipt: receipts are immutable values). */
export function withRouting(receipt: DecisionReceipt, routing: RoutingRecord): DecisionReceipt {
  return DecisionReceiptSchema.parse({ ...receipt, routings: [...receipt.routings, routing] });
}

/** The compact `receipt` output port of contract nodes (first routing). */
export function receiptRef(receipt: DecisionReceipt): ReceiptRef {
  const first = receipt.routings[0];
  return {
    receiptId: receipt.receiptId,
    contract: receipt.contract,
    outcome: receipt.outcome,
    confidence: receipt.confidence,
    route: first?.route ?? null,
    disposition: first?.disposition ?? null,
    consequenceClass: first?.consequenceClass ?? null,
    stateVersion: receipt.stateReference.stateVersion,
  };
}

/** A problem found by {@link checkReceipt}. */
export interface ReceiptIssue {
  check:
    | "distribution_present"
    | "distribution_sums_to_one"
    | "outcome_in_distribution"
    | "confidence_matches"
    | "route_reasons"
    | "auto_port";
  message: string;
}

/**
 * Structural checks behind reconstruction step 4 (§12.3) and winner-only logging (§X.F): a full
 * distribution (unless an explicit fallback/holdback) summing to 1 ± 0.01, the outcome inside
 * it, and every routing explained by reasons with an authorised port for auto routes.
 */
export function checkReceipt(receipt: DecisionReceipt): ReceiptIssue[] {
  const issues: ReceiptIssue[] = [];
  const entries = Object.entries(receipt.distribution);
  const fallback = receipt.routings.some(
    (r) => r.reasons.includes("fallback_outcome") || r.reasons.includes("rollout_holdback"),
  );
  if (entries.length === 0) {
    if (!fallback)
      issues.push({
        check: "distribution_present",
        message: "no distribution: a winner-only receipt cannot be calibrated or audited",
      });
  } else {
    const sum = entries.reduce((s, [, p]) => s + p, 0);
    if (Math.abs(sum - 1) > 0.01)
      issues.push({
        check: "distribution_sums_to_one",
        message: `distribution sums to ${sum.toFixed(4)}`,
      });
    const keyed =
      receipt.kind === "score" && receipt.bandMass !== null
        ? receipt.bandMass
        : receipt.distribution;
    if (receipt.outcome !== null && receipt.kind !== "score" && !(receipt.outcome in keyed)) {
      issues.push({
        check: "outcome_in_distribution",
        message: `outcome "${receipt.outcome}" is not in the distribution`,
      });
    }
  }
  for (const r of receipt.routings) {
    if (r.reasons.length === 0)
      issues.push({
        check: "route_reasons",
        message: `routing by ${r.routedBy.nodeId} has no reasons`,
      });
    if (
      r.route === "auto" &&
      r.authorizedAction.kind !== "fire_port" &&
      r.authorizedAction.kind !== "none" &&
      r.authorizedAction.kind !== "tool_call"
    ) {
      issues.push({
        check: "auto_port",
        message: `auto routing by ${r.routedBy.nodeId} authorises ${r.authorizedAction.kind}`,
      });
    }
    if (
      r.threshold.confidence !== null &&
      receipt.confidence !== null &&
      Math.abs(r.threshold.confidence - receipt.confidence) > 1e-9
    ) {
      issues.push({
        check: "confidence_matches",
        message: `routing by ${r.routedBy.nodeId} used confidence ${r.threshold.confidence}, the receipt records ${receipt.confidence}`,
      });
    }
  }
  return issues;
}

/* ─────────────────────────────── hash chain ─────────────────────────────── */

/** `sha256Json` of the canonical receipt. */
export function receiptHash(receipt: DecisionReceipt): string {
  return hashJson(DecisionReceiptSchema.parse(receipt));
}

/** One link of a receipt hash chain. */
export const ReceiptChainLinkSchema = z.object({
  seq: z.int().min(0),
  receiptId: z.uuid(),
  receiptHash: HashSchema,
  prevChainHash: HashSchema.nullable(),
  /** `sha256Json({ seq, receiptId, receiptHash, prevChainHash })`. */
  chainHash: HashSchema,
});
export type ReceiptChainLink = z.infer<typeof ReceiptChainLinkSchema>;

function linkHash(
  seq: number,
  receiptId: string,
  receiptHashValue: string,
  prevChainHash: string | null,
): string {
  return hashJson({ seq, receiptId, receiptHash: receiptHashValue, prevChainHash });
}

/** Appends a receipt to a chain (returns the new link; the chain array is not mutated). */
export function chainLink(
  chain: readonly ReceiptChainLink[],
  receipt: DecisionReceipt,
): ReceiptChainLink {
  const prev = chain[chain.length - 1] ?? null;
  const seq = prev === null ? 0 : prev.seq + 1;
  const rh = receiptHash(receipt);
  const prevChainHash = prev?.chainHash ?? null;
  return {
    seq,
    receiptId: receipt.receiptId,
    receiptHash: rh,
    prevChainHash,
    chainHash: linkHash(seq, receipt.receiptId, rh, prevChainHash),
  };
}

/** Builds the chain of receipts in order. */
export function buildReceiptChain(receipts: readonly DecisionReceipt[]): ReceiptChainLink[] {
  const chain: ReceiptChainLink[] = [];
  for (const r of receipts) chain.push(chainLink(chain, r));
  return chain;
}

/** Verdict of {@link verifyReceiptChain}. */
export type ChainVerdict =
  | { ok: true; head: string | null }
  | {
      ok: false;
      brokenAt: number;
      reason: "sequence" | "link_hash" | "prev_hash" | "receipt_hash" | "length";
    };

/**
 * Verifies a chain: contiguous sequence, every link hash, every back-pointer and — when the
 * receipts are supplied — every receipt hash (a changed, dropped or reordered receipt fails).
 */
export function verifyReceiptChain(
  chain: readonly ReceiptChainLink[],
  receipts?: readonly DecisionReceipt[],
): ChainVerdict {
  if (receipts !== undefined && receipts.length !== chain.length)
    return { ok: false, brokenAt: Math.min(receipts.length, chain.length), reason: "length" };
  let prev: ReceiptChainLink | null = null;
  for (const [i, link] of chain.entries()) {
    if (link.seq !== i) return { ok: false, brokenAt: i, reason: "sequence" };
    if (link.prevChainHash !== (prev?.chainHash ?? null))
      return { ok: false, brokenAt: i, reason: "prev_hash" };
    if (link.chainHash !== linkHash(link.seq, link.receiptId, link.receiptHash, link.prevChainHash))
      return { ok: false, brokenAt: i, reason: "link_hash" };
    const receipt = receipts?.[i];
    if (
      receipt !== undefined &&
      (receipt.receiptId !== link.receiptId || receiptHash(receipt) !== link.receiptHash)
    ) {
      return { ok: false, brokenAt: i, reason: "receipt_hash" };
    }
    prev = link;
  }
  return { ok: true, head: prev?.chainHash ?? null };
}
