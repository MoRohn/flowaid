import { forwardRef } from "react";
import { Clock } from "lucide-react";
import { formatMs } from "@/lib/format";
import type { ControlPortView, WorkflowNode, WorkflowNodeView } from "@/types";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { formatElapsed, useElapsedSince } from "./HumanNodeCard";
import { metaValue, metaWithout } from "./nodeUtils";

/** What a wait node waits for (`WaitNodeSchema.until`). */
export type WaitUntil = Extract<WorkflowNode, { kind: "wait" }>["until"];

/** A display summary of `until`, without the bindings (a timestamp shows its source). */
export type WaitUntilSummary =
  | { type: "delay"; ms: number }
  | { type: "timestamp"; at: string }
  | { type: "event"; eventName: string; timeoutMs?: number };

export interface WaitNodeCardProps extends NodeCardBaseProps {
  /** What the node waits for; defaults to the "delay", "until" or "event" (+ "timeout") meta entries. */
  until?: WaitUntil | WaitUntilSummary;
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/;

function durationMs(value: string | undefined): number | undefined {
  const m = value ? DURATION.exec(value.trim()) : null;
  if (!m?.[1]) return undefined;
  const unit = m[2] ?? "ms";
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1;
  return Number(m[1]) * factor;
}

/** Reads `until` from the node's meta: "delay" (a duration), "until" (a timestamp source) or "event" (+ "timeout"). */
export function waitUntilFor(node: Pick<WorkflowNodeView, "meta">): WaitUntilSummary | undefined {
  const event = metaValue(node, "event");
  if (event) {
    const timeoutMs = durationMs(metaValue(node, "timeout"));
    return timeoutMs !== undefined
      ? { type: "event", eventName: event, timeoutMs }
      : { type: "event", eventName: event };
  }
  const delay = durationMs(metaValue(node, "delay"));
  if (delay !== undefined) return { type: "delay", ms: delay };
  const at = metaValue(node, "until");
  return at ? { type: "timestamp", at } : undefined;
}

function summarize(until: WaitUntil | WaitUntilSummary): WaitUntilSummary {
  switch (until.type) {
    case "delay":
      return { type: "delay", ms: until.ms };
    case "timestamp":
      return { type: "timestamp", at: typeof until.at === "string" ? until.at : "binding" };
    case "event":
      return until.timeoutMs !== undefined
        ? { type: "event", eventName: until.eventName, timeoutMs: until.timeoutMs }
        : { type: "event", eventName: until.eventName };
  }
}

function untilText(until: WaitUntilSummary): string {
  switch (until.type) {
    case "delay":
      return `for ${formatMs(until.ms)}`;
    case "timestamp":
      return `until ${until.at}`;
    case "event":
      return `for ${until.eventName}`;
  }
}

/** Control-outs of a wait: `node.routes`, else `done` plus `timeout` when it waits for an event. */
export function waitControlOuts(
  node: Pick<WorkflowNodeView, "routes" | "meta">,
  until: WaitUntilSummary | undefined = waitUntilFor(node),
): ControlPortView[] {
  if (node.routes?.length) return node.routes;
  return [
    { id: "done", label: "done" },
    ...(until?.type === "event" ? [{ id: "timeout", label: "timeout" }] : []),
  ];
}

/**
 * Durable wait (`kind: "wait"`): a delay, a timestamp or a named event. The
 * card says what it waits for, counts the time waited while the run is
 * suspended here and exposes `done` (plus `timeout` for events) as
 * control-outs.
 */
export const WaitNodeCard = forwardRef<HTMLDivElement, WaitNodeCardProps>(function WaitNodeCard(
  { node, run, until: untilProp, ...state },
  ref,
) {
  const until = untilProp ? summarize(untilProp) : waitUntilFor(node);
  const waiting = run?.status === "waiting";
  const elapsed = useElapsedSince(run?.startedAt, waiting);
  const controls = waitControlOuts(node, until);
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      kindLabel="wait"
      controls={controls}
      meta={[
        ...metaWithout(node, "delay", "until", "event", "timeout"),
        ...(until?.type === "event" && until.timeoutMs !== undefined
          ? [{ label: "timeout", value: formatMs(until.timeoutMs) }]
          : []),
      ]}
      footerRight={
        waiting ? (
          <span className="inline-flex items-center gap-1 text-warn-text" data-elapsed={elapsed}>
            <Clock className="size-3" strokeWidth={1.75} aria-hidden="true" />
            <span aria-label={`Waiting for ${formatElapsed(elapsed)}`}>
              {formatElapsed(elapsed)}
            </span>
          </span>
        ) : undefined
      }
      {...state}
    >
      {until ? (
        <div className="flex min-w-0 items-center gap-1.5" data-wait={until.type}>
          <Clock className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2">
            {untilText(until)}
          </span>
        </div>
      ) : null}
    </NodeCard>
  );
});
