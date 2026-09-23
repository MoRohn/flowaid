import { forwardRef, type ReactNode } from "react";
import { formatMs } from "@/lib/format";
import { ProgressBar } from "@/primitives";
import type { DecisionKind, NodeRunView, ScoreDecision, WorkflowNodeView } from "@/types";
import { DistributionList, NoulGauge, ScoreScale, noulProbability, scoreLevels } from "@/decision";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { nodeTypeLabel, runIsActive } from "./nodeUtils";

export interface DecisionNodeCardProps extends NodeCardBaseProps {
  /** Rows of the inline distribution for choice decisions. */
  maxRows?: number;
}

const DECISION_KINDS: ReadonlySet<string> = new Set<DecisionKind>(["boolean", "choice", "score"]);

/** Level labels for a score scale: the result's ordered `levels[]`, else "level n" per probability key. */
export function scoreLevelsFor(
  decision: Partial<Pick<ScoreDecision, "levels" | "probabilities">>,
): string[] {
  const fromLevels = scoreLevels(decision.levels);
  if (fromLevels.length) return fromLevels;
  return Object.keys(decision.probabilities ?? {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((i) => `level ${i}`);
}

/** Decision kind from the run result when present, else from the node type suffix ("flowaid.decision.score"). */
export function decisionKindFor(
  node: Pick<WorkflowNodeView, "kind" | "nodeType">,
  run?: Pick<NodeRunView, "decision">,
): DecisionKind {
  if (run?.decision) return run.decision.kind;
  const suffix = nodeTypeLabel(node);
  return DECISION_KINDS.has(suffix) ? (suffix as DecisionKind) : "choice";
}

/**
 * TypeSafe decision node. Shows the question as its purpose and, once a
 * result exists, the probabilities inline with the decision group's visuals:
 * a compact DistributionList for choice, the NoulGauge for boolean and a
 * small ScoreScale for score.
 */
export const DecisionNodeCard = forwardRef<HTMLDivElement, DecisionNodeCardProps>(
  function DecisionNodeCard({ node, run, maxRows = 3, ...state }, ref) {
    const kind = decisionKindFor(node, run);
    const decision = run?.decision;
    const active = runIsActive(run);
    const provider = node.provider ?? decision?.model ?? "jev-latest";
    const latency = decision?.latencyMs ?? run?.durationMs;

    let body: ReactNode = null;
    if (active) {
      body = (
        <div className="flex items-center gap-2" data-decision-kind={kind} data-evaluating="true">
          <ProgressBar label="Evaluating" className="flex-1" />
          <span className="shrink-0 font-mono text-2xs text-ink-3">evaluating</span>
        </div>
      );
    } else if (decision) {
      if (decision.kind === "choice") {
        body = (
          <DistributionList
            data-decision-kind="choice"
            className="nodrag"
            density="compact"
            distribution={decision.probabilities}
            chosen={decision.value}
            maxRows={maxRows}
          />
        );
      } else if (decision.kind === "boolean") {
        body = <NoulGauge data-decision-kind="boolean" probability={noulProbability(decision)} />;
      } else {
        body = (
          <ScoreScale
            data-decision-kind="score"
            size="sm"
            barHeight={14}
            levels={scoreLevelsFor(decision)}
            score={decision.value}
            probabilities={decision.probabilities}
            confidence={decision.confidence}
          />
        );
      }
    }

    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel={kind}
        description={run?.decisionQuestion ?? node.description}
        provider={provider}
        footerRight={latency !== undefined ? formatMs(latency) : undefined}
        {...state}
      >
        {body}
      </NodeCard>
    );
  },
);
