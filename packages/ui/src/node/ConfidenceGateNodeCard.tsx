import { forwardRef } from "react";
import { formatProbability } from "@/lib/format";
import {
  gateFromThresholds,
  gateOutcome,
  gateOutcomeForDecision,
  thresholdsFromGate,
  type ConfidenceThresholds,
  type GateConfig,
  type GateOutcome,
  type WorkflowNodeView,
} from "@/types";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { ConfidenceMeter } from "@/decision";
import { NodeRouteList, type NodeRouteItem } from "./NodeRouteList";
import { metaValue, metaWithout, numberField } from "./nodeUtils";
import { Hint } from "@/primitives";

export interface ConfidenceGateNodeCardProps extends NodeCardBaseProps {
  /** The gate's runtime config (`threshold`, `reviewBand?`, `requireValue?`, ARCHITECTURE.md §6.3). Wins over `thresholds` and the node's meta. */
  gate?: GateConfig;
  /** The UI's two-threshold model (`auto` = pass threshold, `review` = review floor); used when no `gate` is given. */
  thresholds?: ConfidenceThresholds;
  /** Confidence that arrived at the gate; defaults to the run's decision or input. */
  confidence?: number;
}

/** Default gate: pass at 0.90 with a 0.20 review band (review 0.70–0.90, fail below). */
export const DEFAULT_GATE_CONFIG: GateConfig = { threshold: 0.9, reviewBand: 0.2 };
export const DEFAULT_GATE_THRESHOLDS: ConfidenceThresholds =
  thresholdsFromGate(DEFAULT_GATE_CONFIG);

const META_KEYS = ["threshold", "reviewBand", "requireValue", "review", "auto"] as const;

function metaNumber(node: Pick<WorkflowNodeView, "meta">, label: string): number | undefined {
  const raw = metaValue(node, label);
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The gate's runtime config from explicit props, the node's meta entries
 * (`threshold` / `reviewBand` / `requireValue`, the manifest's config field
 * names; the legacy `review` / `auto` pair is still read), or the defaults.
 */
export function gateConfigFor(
  node: Pick<WorkflowNodeView, "meta">,
  override?: { gate?: GateConfig; thresholds?: ConfidenceThresholds },
): GateConfig {
  if (override?.gate) return override.gate;
  if (override?.thresholds) return gateFromThresholds(override.thresholds);
  const threshold = metaNumber(node, "threshold");
  if (threshold !== undefined) {
    const config: GateConfig = { threshold };
    const band = metaNumber(node, "reviewBand");
    if (band !== undefined) config.reviewBand = band;
    const requireValue = metaValue(node, "requireValue");
    if (requireValue !== undefined)
      config.requireValue = requireValue.trim().toLowerCase() === "true";
    return config;
  }
  const review = metaNumber(node, "review");
  const auto = metaNumber(node, "auto");
  if (review !== undefined || auto !== undefined) {
    return gateFromThresholds({
      review: review ?? DEFAULT_GATE_THRESHOLDS.review,
      auto: auto ?? DEFAULT_GATE_THRESHOLDS.auto,
    });
  }
  return DEFAULT_GATE_CONFIG;
}

/** Thresholds (the UI model) for a gate node: `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`. */
export function gateThresholdsFor(
  node: Pick<WorkflowNodeView, "meta">,
  override?: ConfidenceThresholds,
): ConfidenceThresholds {
  return thresholdsFromGate(gateConfigFor(node, override ? { thresholds: override } : undefined));
}

/**
 * The gate's control-outs with their conditions: `pass` and `review` always,
 * `fail` only in the three-way model (a `reviewBand` is set). A node's own
 * `routes` win.
 */
export function gateRoutes(
  node: Pick<WorkflowNodeView, "meta" | "routes">,
  config: GateConfig = gateConfigFor(node),
): NodeRouteItem[] {
  if (node.routes?.length) return node.routes;
  const t = thresholdsFromGate(config);
  const threeWay = config.reviewBand !== undefined;
  const routes: Array<NodeRouteItem & { id: GateOutcome }> = [
    { id: "pass", label: "pass", condition: `≥ ${formatProbability(t.auto)}` },
    {
      id: "review",
      label: "review",
      condition: threeWay
        ? `${formatProbability(t.review)}–${formatProbability(t.auto)}`
        : `< ${formatProbability(t.auto)}`,
    },
  ];
  if (threeWay)
    routes.push({ id: "fail", label: "fail", condition: `< ${formatProbability(t.review)}` });
  return routes;
}

/**
 * Confidence gate. Once a confidence has arrived it draws the decision
 * group's ConfidenceMeter (small, zones and ticks) with the value marked, and
 * exposes the control-outs (pass / review / fail, ARCHITECTURE.md §6.3) as
 * route rows with their own handles whose conditions spell out the
 * thresholds. Without a `reviewBand` the gate is two-way and `fail` is omitted.
 */
export const ConfidenceGateNodeCard = forwardRef<HTMLDivElement, ConfidenceGateNodeCardProps>(
  function ConfidenceGateNodeCard(
    { node, run, gate, thresholds, confidence, compatibleHandles, handleReasons, ...state },
    ref,
  ) {
    const config = gateConfigFor(node, { gate, thresholds });
    const t = thresholdsFromGate(config);
    const c = confidence ?? run?.decision?.confidence ?? numberField(run?.input, "confidence");
    const settled = run !== undefined && run.status !== "pending" && run.status !== "running";
    const computed: GateOutcome | undefined = !settled
      ? undefined
      : run.decision && confidence === undefined
        ? gateOutcomeForDecision(run.decision, config)
        : c !== undefined
          ? gateOutcome(c, t)
          : undefined;
    const taken = run?.routeTaken ?? computed;
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="gate"
        handles="inputs"
        compatibleHandles={compatibleHandles}
        handleReasons={handleReasons}
        description={node.description ?? "Route by decision confidence"}
        meta={metaWithout(node, ...META_KEYS)}
        bodyClassName="pl-0 pr-0"
        footerRight={
          c !== undefined ? (
            <Hint hint="Incoming confidence" className="text-accent-text">
              {formatProbability(c)}
            </Hint>
          ) : undefined
        }
        {...state}
      >
        {c !== undefined ? (
          <div className="pl-[26px] pr-2.5 pb-1">
            <ConfidenceMeter
              size="sm"
              confidence={c}
              thresholds={t}
              showValue={false}
              showOutcome={false}
              showTicks
              aria-label="Confidence gate"
            />
          </div>
        ) : null}
        <NodeRouteList
          routes={gateRoutes(node, config)}
          taken={taken}
          resolved={settled}
          category={node.category}
          compatibleHandles={compatibleHandles}
          handleReasons={handleReasons}
          outputs={node.outputs}
        />
      </NodeCard>
    );
  },
);
