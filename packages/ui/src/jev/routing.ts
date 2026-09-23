/**
 * Confidence × consequence routing as the policy editor draws it
 * (JEV_ENGINEERING.md §6.3–§6.4). Consequence is checked before confidence:
 * an irreversible class, or a class with no zones, is human at every
 * confidence; otherwise confidence maps to auto / improve / human.
 */
import type {
  ConsequenceClass,
  EscapeKind,
  JevRoute,
  JevRoutingPolicy,
  JevZoneThresholds,
  RouteReason,
} from "./types";
import { CONSEQUENCE_ORDER, ILLUSTRATIVE_THRESHOLDS } from "./vocabulary";

/**
 * What a matrix cell does. `act` = auto (fire the declared branch), `verify` =
 * improve (collect evidence or run a check), `escalate` = human because
 * confidence is too low, `human` = human because of the consequence class.
 */
export type RoutingCell = "act" | "verify" | "escalate" | "human";

export const ROUTING_CELL_LABEL: Record<RoutingCell, string> = {
  act: "Act",
  verify: "Verify",
  escalate: "Escalate",
  human: "Human",
};

export const ROUTING_CELL_DESCRIPTION: Record<RoutingCell, string> = {
  act: "Auto: the declared branch fires (after deterministic policy).",
  verify: "Improve: collect evidence, run a check or narrow the menu, then ask again.",
  escalate: "Human: confidence is below the improve floor.",
  human: "Human at every confidence: the consequence class does not automate.",
};

export const ROUTING_CELL_ROUTE: Record<RoutingCell, JevRoute> = {
  act: "auto",
  verify: "improve",
  escalate: "human",
  human: "human",
};

export interface EffectiveZones {
  /** null ⇒ irreversible (never configurable, always human). */
  zones: JevZoneThresholds | null;
  /** The contract omitted this class and Table V's illustrative defaults apply. */
  illustrative: boolean;
}

export function effectiveZones(policy: JevRoutingPolicy, cc: ConsequenceClass): EffectiveZones {
  if (cc === "irreversible") return { zones: null, illustrative: false };
  const own = policy.thresholds[cc];
  return own
    ? { zones: own, illustrative: false }
    : { zones: ILLUSTRATIVE_THRESHOLDS[cc], illustrative: true };
}

/** Cell for one confidence in one class. `improveWired` false turns the improve zone into escalation (§6.4 step 10). */
export function routingCell(
  confidence: number,
  zones: JevZoneThresholds | null,
  improveWired: boolean,
): RoutingCell {
  if (!zones || (zones.autoAt === null && zones.improveAt === null)) return "human";
  if (zones.autoAt !== null && confidence >= zones.autoAt) return "act";
  if (zones.improveAt !== null && confidence >= zones.improveAt)
    return improveWired ? "verify" : "escalate";
  return "escalate";
}

export interface RoutingSegment {
  from: number;
  to: number;
  cell: RoutingCell;
}

export interface RoutingMatrixRow {
  consequenceClass: ConsequenceClass;
  zones: JevZoneThresholds | null;
  illustrative: boolean;
  /** Contiguous confidence ranges over [0, 1], merged when adjacent cells agree. */
  segments: RoutingSegment[];
}

/** Breakpoints of a class: 0, its thresholds and 1, sorted and de-duplicated. */
function breakpoints(zones: JevZoneThresholds | null): number[] {
  const points = new Set<number>([0, 1]);
  if (zones?.autoAt !== null && zones?.autoAt !== undefined) points.add(zones.autoAt);
  if (zones?.improveAt !== null && zones?.improveAt !== undefined) points.add(zones.improveAt);
  return [...points].filter((p) => p >= 0 && p <= 1).sort((a, b) => a - b);
}

/** The matrix, one row per consequence class (low → irreversible). */
export function routingMatrix(policy: JevRoutingPolicy): RoutingMatrixRow[] {
  const improveWired = Boolean(policy.improve && policy.improve.actions.length > 0);
  return CONSEQUENCE_ORDER.map((cc) => {
    const { zones, illustrative } = effectiveZones(policy, cc);
    const points = breakpoints(zones);
    const segments: RoutingSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i] ?? 0;
      const to = points[i + 1] ?? 1;
      if (to <= from) continue;
      const cell = routingCell(from, zones, improveWired);
      const last = segments[segments.length - 1];
      if (last && last.cell === cell) last.to = to;
      else segments.push({ from, to, cell });
    }
    return { consequenceClass: cc, zones, illustrative, segments };
  });
}

/** Share of [0, 1] each cell covers in a row (for the legend and tests). */
export function cellCoverage(row: RoutingMatrixRow): Record<RoutingCell, number> {
  const out: Record<RoutingCell, number> = { act: 0, verify: 0, escalate: 0, human: 0 };
  for (const s of row.segments) out[s.cell] += s.to - s.from;
  return out;
}

export interface RoutePreviewInput {
  confidence: number;
  /** top1 − top2 (choice and banded score); omit for boolean. */
  margin?: number;
  consequenceClass: ConsequenceClass;
  escape?: EscapeKind | null;
  automatable?: boolean;
}

export interface RoutePreview {
  route: JevRoute;
  reasons: RouteReason[];
}

const DEMOTE: Record<JevRoute, JevRoute> = { auto: "improve", improve: "human", human: "human" };

/**
 * The deterministic part of `route()` (§6.4 steps 2, 3, 5, 6 and 10) for one
 * hypothetical answer: escapes, consequence before confidence, zones, margin
 * demotion, non-automatable outcomes and an unwired improve zone.
 */
export function previewRoute(policy: JevRoutingPolicy, input: RoutePreviewInput): RoutePreview {
  const reasons: RouteReason[] = [];
  const improveWired = Boolean(policy.improve && policy.improve.actions.length > 0);
  const finish = (route: JevRoute): RoutePreview => {
    if (route === "improve" && !improveWired)
      return { route: "human", reasons: [...reasons, "improve_budget_exhausted"] };
    return { route, reasons };
  };
  if (input.escape) {
    if (input.escape === "stop") {
      reasons.push("stop_outcome");
      return finish(policy.escapeRoutes.stop);
    }
    reasons.push("escape_outcome");
    if (input.escape === "review" || input.escape === "escalate")
      return { route: "human", reasons };
    return finish(policy.escapeRoutes[input.escape]);
  }
  if (input.consequenceClass === "irreversible")
    return { route: "human", reasons: ["consequence_irreversible"] };
  const { zones, illustrative } = effectiveZones(policy, input.consequenceClass);
  if (illustrative) reasons.push("thresholds_illustrative");
  let route: JevRoute = "human";
  if (zones && zones.autoAt !== null && input.confidence >= zones.autoAt) {
    route = "auto";
    reasons.push("zone_auto");
  } else if (zones && zones.improveAt !== null && input.confidence >= zones.improveAt) {
    route = "improve";
    reasons.push("zone_improve");
  } else reasons.push("zone_human");
  if (
    zones?.minMargin !== undefined &&
    input.margin !== undefined &&
    input.margin < zones.minMargin &&
    route !== "human"
  ) {
    route = DEMOTE[route];
    reasons.push("margin_below_min");
  }
  if (input.automatable === false && route === "auto") {
    route = "improve";
    reasons.push("outcome_not_automatable");
  }
  return finish(route);
}
