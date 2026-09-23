import { forwardRef } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Badge } from "@/primitives";
import type { NodeRunView } from "@/types";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { isRecord, metaValue, metaWithout, stringField } from "./nodeUtils";

export type SafetyOutcome = "pass" | "block";

export interface SafetyNodeCardProps extends NodeCardBaseProps {
  /** Policy name; defaults to the "policy" meta entry. */
  policy?: string;
  /** Result of the check; defaults to the run's route or output. */
  outcome?: SafetyOutcome;
}

/** Reads pass/block from a run's route or `{ outcome | allowed | blocked }` output. */
export function safetyOutcomeOf(
  run: Pick<NodeRunView, "routeTaken" | "output"> | undefined,
): SafetyOutcome | undefined {
  if (!run) return undefined;
  const route = run.routeTaken?.toLowerCase();
  if (route === "pass" || route === "block") return route;
  const text = stringField(run.output, "outcome")?.toLowerCase();
  if (text === "pass" || text === "block") return text;
  if (isRecord(run.output)) {
    if (typeof run.output.allowed === "boolean") return run.output.allowed ? "pass" : "block";
    if (typeof run.output.blocked === "boolean") return run.output.blocked ? "block" : "pass";
  }
  return undefined;
}

/** Guard / policy node: the policy it applies and whether the payload passed. */
export const SafetyNodeCard = forwardRef<HTMLDivElement, SafetyNodeCardProps>(
  function SafetyNodeCard({ node, run, policy, outcome, ...state }, ref) {
    const name = policy ?? metaValue(node, "policy");
    const result = outcome ?? safetyOutcomeOf(run);
    const Icon = result === "block" ? ShieldX : ShieldCheck;
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="safety"
        meta={metaWithout(node, "policy")}
        {...state}
      >
        {name || result ? (
          <div className="flex items-center gap-1.5">
            <Icon
              className={
                result === "block"
                  ? "size-3.5 shrink-0 text-danger-text"
                  : "size-3.5 shrink-0 text-ink-3"
              }
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2">
              {name ?? "policy"}
            </span>
            {result ? (
              <Badge tone={result === "pass" ? "ok" : "danger"} size="sm" dot data-outcome={result}>
                {result}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </NodeCard>
    );
  },
);
