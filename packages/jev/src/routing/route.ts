/**
 * Confidence × consequence routing (JEV_ENGINEERING.md §6.3–§6.5, handbook §V, Table V).
 *
 * `route()` is the pure, deterministic routing engine: a contract's declarative
 * {@link RoutingPolicy} (per-class zones, escape routes, improve actions, uncalibrated and
 * model-change policies) applied to one decision. Precedence (each step may only lower
 * authority, auto > improve > human):
 *
 *  0. over budget with a wired narrowing/evidence improve action → improve; no decision or
 *     over budget → the fallback outcome (routed by its escape) or human
 *  1. blind retry → human
 *  2. escape outcomes → review|escalate ⇒ human; stop ⇒ escapeRoutes.stop; none|other ⇒ escapeRoutes
 *  3. consequence class = max(contract, outcome/band, override); irreversible → human (before any confidence test, §V.E)
 *  4. fuzzy-mapped label → treated as escape `other`
 *  5. zone from the class's thresholds (or the Table V illustrative defaults); margin demotion
 *  6. non-automatable outcome → cap improve
 *  7. stale evidence / option set → cap improve
 *  8. uncalibrated → cap per `uncalibratedProviders`
 *  9. model changed with `onModelChange: 'human'` → human
 * 10. improve without declared/wired improve actions or with the round budget spent → human
 */
import type { DecisionResult } from "@flowaid/workflow-core";
import {
  escapeOf,
  outcomeTraits,
  portForOutcome,
  type DecisionContractBody,
  type EscapeKind,
  type ZoneThresholds,
} from "../contract.js";
import { maxConsequence } from "../consequence.js";
import { labelOf } from "../contract.js";
import type { ConsequenceClass, JevRoute, RouteReason, ThresholdApplied } from "../wire.js";
import { routingSignal, type RoutingSignal } from "./confidence.js";

/** Table V zones used when a contract omits a class (flagged `thresholds_illustrative`, §6.3). */
export const ILLUSTRATIVE_THRESHOLDS: Readonly<
  Record<Exclude<ConsequenceClass, "irreversible">, ZoneThresholds>
> = Object.freeze({
  low: { autoAt: 0.9, improveAt: 0.7 },
  medium: { autoAt: null, improveAt: 0.7 },
  high: { autoAt: null, improveAt: null },
});

/** Everything `route()` needs about one decision. */
export interface RouteInput {
  contract: DecisionContractBody;
  /** null ⇒ evaluation could not run (hops exhausted, over budget, stale menu without improve). */
  decision: DecisionResult | null;
  /** Overrides the outcome read from the decision (e.g. a dynamic menu's selected key). */
  outcome?: string | null;
  /** Overrides the escape kind read from the contract. */
  escape?: EscapeKind | null;
  /** A route node may only RAISE the class. */
  consequenceOverride?: ConsequenceClass | null;
  /** §6.4: typesafe hop, not fuzzy-mapped, and the acting version carries calibration evidence where required. */
  calibrated: boolean;
  /** An LLM adapter fuzzy-mapped an unknown label onto an option (conflict C4). */
  fuzzy?: boolean;
  /** Resolved model ≠ `model.expectResolved`. */
  modelChanged?: boolean;
  improveRoundsUsed?: number;
  /** Same (contractHash, packetHash, optionSetVersion) already evaluated in this lineage. */
  blindRetry?: boolean;
  stale?: { evidence: boolean; optionSet: boolean };
  /** A strict-consistency source changed between snapshot and answer (§8.4). */
  stateRace?: boolean;
  overBudget?: boolean;
  /** The node wires its `improve` port (default: true when the contract declares improve actions). */
  improveWired?: boolean;
}

/** The route, its reasons and the operating zone that explains it. */
export interface RouteResult {
  route: JevRoute;
  reasons: RouteReason[];
  consequenceClass: ConsequenceClass;
  threshold: ThresholdApplied;
  /** Option key | band port | 'true' | 'false' | level | the fallback outcome; null when none applies. */
  outcome: string | null;
  escape: EscapeKind | null;
  /** The control port authorised in the auto zone (null unless route is `auto`). */
  port: string | null;
}

const RANK: Record<JevRoute, number> = { human: 0, improve: 1, auto: 2 };

function capAt(route: JevRoute, cap: JevRoute): JevRoute {
  return RANK[route] <= RANK[cap] ? route : cap;
}

function thresholdsFor(
  body: DecisionContractBody,
  cc: Exclude<ConsequenceClass, "irreversible">,
): { zones: ZoneThresholds; illustrative: boolean; source: string } {
  const declared = body.routing.thresholds[cc];
  if (declared)
    return {
      zones: declared,
      illustrative: false,
      source: `${labelOf(body)}#/routing/thresholds/${cc}`,
    };
  return {
    zones: ILLUSTRATIVE_THRESHOLDS[cc],
    illustrative: true,
    source: `illustrative:table_v/${cc}`,
  };
}

function applied(
  cc: ConsequenceClass,
  zones: ZoneThresholds | null,
  signal: RoutingSignal | null,
  illustrative: boolean,
  source: string,
): ThresholdApplied {
  return {
    consequenceClass: cc,
    autoAt: zones?.autoAt ?? null,
    improveAt: zones?.improveAt ?? null,
    minMargin: zones?.minMargin ?? null,
    confidence: signal?.confidence ?? null,
    margin: signal?.margin ?? null,
    illustrative,
    source,
  };
}

function hasNarrowingImprove(body: DecisionContractBody): boolean {
  return (
    body.routing.improve?.actions.some(
      (a) => a.kind === "narrow_options" || a.kind === "collect_evidence",
    ) === true
  );
}

/** Routes an escape outcome (§6.4 step 2 and the fallback of step 0). */
function escapeRoute(
  body: DecisionContractBody,
  escape: EscapeKind,
): { route: JevRoute; reason: RouteReason } {
  switch (escape) {
    case "review":
    case "escalate":
      return { route: "human", reason: "escape_outcome" };
    case "stop":
      return { route: body.routing.escapeRoutes.stop, reason: "stop_outcome" };
    case "none":
      return { route: body.routing.escapeRoutes.none, reason: "escape_outcome" };
    case "other":
      return { route: body.routing.escapeRoutes.other, reason: "escape_outcome" };
  }
}

/** Step 10: an improve route needs declared actions, a wired port and remaining rounds. */
function improveGuard(input: RouteInput, route: JevRoute, reasons: RouteReason[]): JevRoute {
  if (route !== "improve") return route;
  const improve = input.contract.routing.improve;
  const wired = input.improveWired ?? improve !== undefined;
  if (!improve || !wired || (input.improveRoundsUsed ?? 0) >= improve.maxRounds) {
    reasons.push("improve_budget_exhausted");
    return "human";
  }
  return route;
}

function finish(
  input: RouteInput,
  route: JevRoute,
  reasons: RouteReason[],
  cc: ConsequenceClass,
  threshold: ThresholdApplied,
  outcome: string | null,
  escape: EscapeKind | null,
): RouteResult {
  const guarded = improveGuard(input, route, reasons);
  const port =
    guarded === "auto" && outcome !== null ? portForOutcome(input.contract, outcome) : null;
  // An auto route without a port to fire (e.g. an unbanded score measurement) cannot act.
  const finalRoute: JevRoute = guarded === "auto" && port === null ? "improve" : guarded;
  if (finalRoute !== guarded) {
    reasons.push("outcome_not_automatable");
    return {
      route: improveGuard(input, finalRoute, reasons),
      reasons,
      consequenceClass: cc,
      threshold,
      outcome,
      escape,
      port: null,
    };
  }
  return { route: finalRoute, reasons, consequenceClass: cc, threshold, outcome, escape, port };
}

/** The pure routing engine (§6.4). Deterministic: equal inputs give equal routes and reasons. */
export function route(input: RouteInput): RouteResult {
  const body = input.contract;
  const reasons: RouteReason[] = [];
  const signal = input.decision ? routingSignal(body, input.decision) : null;
  const baseClass = maxConsequence(body.routing.consequenceClass, input.consequenceOverride);
  const overBudget = input.overBudget === true;

  // 0. Over budget / no evaluation.
  if (overBudget && hasNarrowingImprove(body)) {
    reasons.push("packet_over_budget");
    const zones = thresholdsFor(body, baseClass === "irreversible" ? "high" : baseClass);
    return finish(
      input,
      "improve",
      reasons,
      baseClass,
      applied(baseClass, zones.zones, null, zones.illustrative, zones.source),
      null,
      null,
    );
  }
  if (input.decision === null || signal === null || overBudget) {
    reasons.push("fallback_outcome");
    if (overBudget) reasons.push("packet_over_budget");
    const outcome = body.fallbackOutcome;
    const escape = escapeOf(body, outcome);
    const threshold = applied(baseClass, null, null, false, `${labelOf(body)}#/fallbackOutcome`);
    if (outcome === null || escape === null)
      return finish(input, "human", reasons, baseClass, threshold, outcome, escape);
    const er = escapeRoute(body, escape);
    reasons.push(er.reason);
    return finish(input, er.route, reasons, baseClass, threshold, outcome, escape);
  }

  const outcome = input.outcome !== undefined ? input.outcome : signal.outcome;
  const escape =
    input.escape !== undefined ? input.escape : outcome === null ? null : escapeOf(body, outcome);
  const traits = outcomeTraits(body, outcome);
  const cc = maxConsequence(baseClass, traits.consequenceClass);

  // 1. Blind retry: no provider call was made; the earlier distribution is reused.
  if (input.blindRetry === true) {
    reasons.push("blind_retry_blocked");
    return finish(
      input,
      "human",
      reasons,
      cc,
      applied(cc, null, signal, false, "blind_retry_guard"),
      outcome,
      escape,
    );
  }

  // 2. Escape outcomes are declared safe routes.
  if (escape !== null) {
    const er = escapeRoute(body, escape);
    reasons.push(er.reason);
    return finish(
      input,
      er.route,
      reasons,
      cc,
      applied(cc, null, signal, false, `${labelOf(body)}#/routing/escapeRoutes/${escape}`),
      outcome,
      escape,
    );
  }

  // 3. Consequence precedes confidence.
  if (cc === "irreversible") {
    reasons.push("consequence_irreversible");
    return finish(
      input,
      "human",
      reasons,
      cc,
      applied(cc, null, signal, false, "irreversible:always_human"),
      outcome,
      escape,
    );
  }

  // 4. A fuzzy-mapped label is mass forced onto the least-wrong option: treat it as `other`.
  if (input.fuzzy === true) {
    reasons.push("provider_uncalibrated");
    const er = escapeRoute(body, "other");
    return finish(
      input,
      er.route,
      reasons,
      cc,
      applied(cc, null, signal, false, `${labelOf(body)}#/routing/escapeRoutes/other`),
      outcome,
      "other",
    );
  }

  // 5. Zone from the class's thresholds.
  const t = thresholdsFor(body, cc);
  if (t.illustrative) reasons.push("thresholds_illustrative");
  const c = signal.confidence;
  let zone: JevRoute;
  if (t.zones.autoAt !== null && c >= t.zones.autoAt) zone = "auto";
  else if (t.zones.improveAt !== null && c >= t.zones.improveAt) zone = "improve";
  else zone = "human";
  reasons.push(zone === "auto" ? "zone_auto" : zone === "improve" ? "zone_improve" : "zone_human");
  if (
    t.zones.minMargin !== undefined &&
    signal.margin !== null &&
    signal.margin < t.zones.minMargin &&
    zone !== "human"
  ) {
    zone = zone === "auto" ? "improve" : "human";
    reasons.push("margin_below_min");
  }
  let routed = zone;

  // 6. Outcome declared non-automatable.
  if (!traits.automatable) {
    routed = capAt(routed, "improve");
    reasons.push("outcome_not_automatable");
  }
  // 7. Staleness: the harness evaluated an invalid graph; it may at most rebuild.
  if (input.stale?.evidence === true) {
    routed = capAt(routed, "improve");
    reasons.push("stale_evidence");
  }
  if (input.stale?.optionSet === true) {
    routed = capAt(routed, "improve");
    reasons.push("stale_option");
  }
  if (input.stateRace === true) {
    routed = capAt(routed, "improve");
    reasons.push("state_race");
  }
  // 8. Calibration.
  if (!input.calibrated && body.routing.uncalibratedProviders !== "allow") {
    routed = capAt(routed, body.routing.uncalibratedProviders);
    reasons.push("provider_uncalibrated");
  }
  // 9. Model change.
  if (input.modelChanged === true && body.routing.onModelChange === "human") {
    routed = "human";
    reasons.push("model_version_changed");
  }
  return finish(
    input,
    routed,
    reasons,
    cc,
    applied(cc, t.zones, signal, t.illustrative, t.source),
    outcome,
    escape,
  );
}

/* ───────────────────────── action vocabulary ───────────────────────── */

/**
 * What the harness does next, in the handbook's words (Table V, §V.A–§V.B):
 * `act` — automate the declared branch; `verify` — improve the state (collect evidence, run a
 * check, narrow options, ask a precise question); `escalate` — a person must decide because of
 * consequence, a declared escalation or a policy/rollout boundary; `human` — review because the
 * judgment is uncertain (low confidence, thin margin, uncalibrated, blind retry, budget spent).
 */
export type DecisionAction = "act" | "verify" | "escalate" | "human";

/** Reasons that make a human route an escalation rather than an uncertainty review. */
const ESCALATION_REASONS: ReadonlySet<RouteReason> = new Set<RouteReason>([
  "consequence_irreversible",
  "model_version_changed",
  "policy_deny",
  "policy_review",
  "rollout_scope",
]);

/** The action of a route result, with the reasons that explain it. */
export interface RoutedAction {
  action: DecisionAction;
  /** Port fired for `act` (outcome/band/yes/no/selected/stop), `improve` for `verify`, `human` otherwise. */
  port: string;
  route: JevRoute;
  reasons: RouteReason[];
  consequenceClass: ConsequenceClass;
}

/** Maps a {@link RouteResult} to the handbook's act / verify / escalate / human vocabulary. */
export function routeAction(result: RouteResult): RoutedAction {
  const base = {
    route: result.route,
    reasons: [...result.reasons],
    consequenceClass: result.consequenceClass,
  };
  switch (result.route) {
    case "auto":
      return { ...base, action: "act", port: result.port ?? "done" };
    case "improve":
      return { ...base, action: "verify", port: "improve" };
    case "human": {
      const escalate =
        result.escape === "escalate" ||
        result.consequenceClass === "high" ||
        result.reasons.some((r) => ESCALATION_REASONS.has(r));
      return { ...base, action: escalate ? "escalate" : "human", port: "human" };
    }
  }
}
