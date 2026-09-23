import { forwardRef, useEffect, useState } from "react";
import { ArrowUpRight, Clock } from "lucide-react";
import { Avatar, Badge, Button } from "@/primitives";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { controlOutsFor, metaValue, metaWithout, stringField } from "./nodeUtils";

export interface HumanNodeCardProps extends NodeCardBaseProps {
  /** Reviewer; defaults to the "assignee" meta entry. */
  assignee?: string;
  /** Opens the review surface for this node's pending approval. */
  onOpenReview?: (nodeId: string) => void;
}

/** "12 s", "4 m 07 s", "1 h 03 m", "2 d 05 h" for waiting timers. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} m`;
  const d = Math.floor(h / 24);
  return `${d} d ${String(h % 24).padStart(2, "0")} h`;
}

/** Milliseconds since an ISO timestamp, re-rendering every `tickMs` while `active`. */
export function useElapsedSince(since: string | undefined, active: boolean, tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !since) return;
    // State only changes from timer callbacks; the zero-delay tick refreshes a stale clock.
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, tickMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [since, active, tickMs]);
  if (!since) return 0;
  const start = Date.parse(since);
  return Number.isFinite(start) ? Math.max(0, now - start) : 0;
}

function outcomeOf(
  run: HumanNodeCardProps["run"],
): { label: string; tone: "ok" | "danger" | "neutral" } | undefined {
  const raw =
    run?.routeTaken ?? stringField(run?.output, "kind") ?? stringField(run?.output, "outcome");
  if (!raw) return undefined;
  const k = raw.toLowerCase();
  if (k.startsWith("approv")) return { label: "Approved", tone: "ok" };
  if (k.startsWith("reject")) return { label: "Rejected", tone: "danger" };
  if (k.startsWith("escalat")) return { label: "Escalated", tone: "neutral" };
  return { label: raw, tone: "neutral" };
}

/**
 * Human-in-the-loop node. Names the assignee, counts how long the run has
 * been waiting (ticking every second) and offers "Open review" while the
 * approval is pending. Once answered it shows the outcome.
 */
export const HumanNodeCard = forwardRef<HTMLDivElement, HumanNodeCardProps>(function HumanNodeCard(
  { node, run, assignee, onOpenReview, ...state },
  ref,
) {
  const who = assignee ?? metaValue(node, "assignee");
  const waiting = run?.status === "waiting";
  const elapsed = useElapsedSince(run?.startedAt, waiting);
  const outcome = waiting ? undefined : outcomeOf(run);
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      meta={metaWithout(node, "assignee")}
      controls={controlOutsFor(node, "human")}
      footerRight={
        waiting ? (
          <span className="inline-flex items-center gap-1 text-cat-human" data-elapsed={elapsed}>
            <Clock className="size-3" strokeWidth={1.75} aria-hidden="true" />
            <span aria-label={`Waiting for ${formatElapsed(elapsed)}`}>
              {formatElapsed(elapsed)}
            </span>
          </span>
        ) : undefined
      }
      {...state}
    >
      {who || outcome ? (
        <div className="flex items-center gap-1.5">
          {who ? (
            <>
              <Avatar name={who} size="xs" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{who}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">Unassigned</span>
          )}
          {outcome ? (
            <Badge tone={outcome.tone} size="sm" data-outcome={outcome.label}>
              {outcome.label}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {waiting ? (
        <Button
          size="sm"
          variant="secondary"
          className="nodrag nopan mt-2 w-full"
          trailingIcon={<ArrowUpRight strokeWidth={1.75} aria-hidden="true" />}
          onClick={() => onOpenReview?.(node.id)}
        >
          Open review
        </Button>
      ) : null}
    </NodeCard>
  );
});
