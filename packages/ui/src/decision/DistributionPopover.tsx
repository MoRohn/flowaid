/**
 * The full distribution of a decision behind a trigger (UI.md §6): the question, every option
 * with its probability, the score scale, and how it was decided — the provider chain with each
 * failover hop, latency, cost and the provider's request id. DecisionBadge opens it; any
 * focusable element can (`asChild` trigger).
 */
import type { ReactNode } from "react";
import { formatCost, formatMs, formatProbability } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import type { DecisionResult } from "@/types";
import { DistributionList } from "./DistributionList";
import {
  noulProbability,
  normalizeDistribution,
  scoreLegend,
  type DistributionEntry,
} from "./distribution";

/** Rows shown in the popover: the full distribution for choice/score, yes/no for boolean. */
export function decisionTooltipRows(result: DecisionResult): DistributionEntry[] {
  if (result.kind === "boolean") {
    const pYes = noulProbability(result);
    return [
      { key: "yes", label: "yes", probability: pYes },
      { key: "no", label: "no", probability: 1 - pYes },
    ].sort((a, b) => b.probability - a.probability);
  }
  return normalizeDistribution(
    result.probabilities,
    result.kind === "score" ? { labels: scoreLegend(result.levels) } : {},
  );
}

/** The popover body. */
export function DistributionPanel({
  result,
  question,
}: {
  result: DecisionResult;
  question?: string;
}) {
  const rows = decisionTooltipRows(result);
  const levels = result.kind === "score" ? result.levels : [];
  const failed = result.attempts.filter((a) => a.outcome !== "ok");
  return (
    <div className="flex flex-col gap-2">
      {question ? <p className="m-0 text-xs leading-snug text-ink-2">{question}</p> : null}
      {rows.length ? (
        <DistributionList
          distribution={rows}
          chosen={result.kind === "choice" ? result.value : undefined}
          density="compact"
          aria-label="Distribution"
        />
      ) : null}
      {result.kind === "score" && levels.length ? (
        <p className="m-0 font-mono text-2xs text-ink-3 tabular">
          {levels.length} levels · conf {formatProbability(result.confidence)}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Failover">
          {failed.map((a, i) => (
            <li key={`${a.provider}-${i}`} className="font-mono text-2xs text-warn-text">
              ↷ {a.provider}:{a.model}{" "}
              {a.outcome === "skipped_unhealthy" ? "skipped (unhealthy)" : (a.errorCode ?? "error")}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="m-0 font-mono text-2xs text-ink-3 tabular">
        {result.provider}:{result.model} · {formatMs(result.latencyMs)} ·{" "}
        {formatCost(result.costUsd)}
        {result.requestId ? ` · ${result.requestId}` : ""}
      </p>
    </div>
  );
}

export interface DistributionPopoverProps {
  result: DecisionResult;
  question?: string;
  /** The trigger; must accept a ref and be focusable (a button). */
  children: ReactNode;
  /** Accessible name of the popover (default derived from the decision). */
  label?: string;
}

export function DistributionPopover({
  result,
  question,
  children,
  label,
}: DistributionPopoverProps) {
  const name =
    label ??
    `Decision distribution: ${result.kind === "boolean" ? (result.value ? "yes" : "no") : String(result.value)}`;
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent width="auto" className="min-w-56 max-w-72" aria-label={name}>
        <DistributionPanel result={result} question={question} />
      </PopoverContent>
    </Popover>
  );
}
