"use client";
/**
 * The builder's answer to "did it work?": the draft run's status in words, which step failed and
 * why, how many steps finished, time and cost, and where to go next (the full run page for retry
 * and replay, Human tasks while it waits for a person). Only what the run's own record and events
 * say is shown; there is no progress estimate because the server reports none.
 */
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { RunStatus } from "@flowaid/workflow-core";
import type { RunView } from "@flowaid/ui";
import { formatCost, formatMs } from "@flowaid/ui/lib";
import { Button, StatusChip } from "@flowaid/ui/primitives";

export interface RunSummary {
  /** One sentence for the status line. */
  headline: string;
  /** What the person can do now. */
  next?: string;
  tone: "ok" | "danger" | "warn" | "neutral";
  finished: number;
  failedNodeId?: string;
  terminal: boolean;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled", "timed_out"]);

export function summarizeRun(run: RunView): RunSummary {
  const finished = run.nodeRuns.filter(
    (r) => r.status === "completed" || r.status === "reused",
  ).length;
  const steps = `${finished} step${finished === 1 ? "" : "s"}`;
  const terminal = TERMINAL.has(run.status);
  switch (run.status) {
    case "queued":
    case "starting":
      return {
        headline: "Queued: waiting for a worker to pick up the run.",
        next: "If it stays queued, check that the worker is running.",
        tone: "neutral",
        finished,
        terminal,
      };
    case "running":
    case "retrying":
      return {
        headline: `Running: ${steps} finished so far.`,
        tone: "neutral",
        finished,
        terminal,
      };
    case "waiting_for_human":
      return {
        headline: `Waiting for a person: ${steps} finished, then the run paused for a human task.`,
        next: "Answer the task under Human tasks and the run continues from here.",
        tone: "warn",
        finished,
        terminal,
      };
    case "waiting":
      return {
        headline: `Waiting for an event or a timer: ${steps} finished so far.`,
        tone: "warn",
        finished,
        terminal,
      };
    case "completed":
      return {
        headline: `Completed: ${steps} ran without errors.`,
        tone: "ok",
        finished,
        terminal,
      };
    case "failed": {
      const nodeId =
        run.error?.nodeId ?? [...run.nodeRuns].reverse().find((r) => r.status === "failed")?.nodeId;
      const at = nodeId
        ? (run.nodeRuns.find((r) => r.nodeId === nodeId)?.nodeName ?? nodeId)
        : undefined;
      return {
        headline: at
          ? `Failed at “${at}” after ${steps} finished.`
          : `Failed after ${steps} finished.`,
        next: run.error?.retryable
          ? "The error may be temporary. Fix what it names, or retry that step from the full run page."
          : "Fix what the error names and run the draft again; the full run page can also retry a step.",
        tone: "danger",
        finished,
        ...(nodeId ? { failedNodeId: nodeId } : {}),
        terminal,
      };
    }
    case "cancelled":
      return {
        headline: `Cancelled after ${steps} finished.`,
        tone: "neutral",
        finished,
        terminal,
      };
    case "timed_out":
      return {
        headline: `Timed out after ${steps} finished.`,
        next: "Raise the workflow's time limit in Settings, or make the slow step faster.",
        tone: "danger",
        finished,
        terminal,
      };
  }
}

const TONE: Record<RunSummary["tone"], string> = {
  ok: "border-ok",
  danger: "border-danger",
  warn: "border-warn",
  neutral: "border-border",
};

export function RunResult({
  run,
  ws,
  stale,
  onShowNode,
  story = [],
}: {
  run: RunView;
  /** What happened, in plain sentences (`explainRun`); shown under the status. */
  story?: string[];
  ws: string;
  /** The draft changed after this run started. */
  stale: boolean;
  onShowNode: (nodeId: string) => void;
}) {
  const summary = summarizeRun(run);
  const duration =
    run.startedAt && run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : undefined;
  return (
    <section
      aria-label="Run result"
      className={`flex flex-col gap-1.5 rounded-sm border-l-2 bg-surface-2 p-2.5 ${TONE[summary.tone]}`}
    >
      <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
        <StatusChip status={run.status} />
        <span className="text-xs text-ink">{summary.headline}</span>
      </div>
      {run.error ? (
        <p className="text-xs text-ink-2">
          <span className="break-words">{run.error.message}</span>{" "}
          <span className="font-mono text-2xs text-ink-3">{run.error.code}</span>
        </p>
      ) : null}
      {story.length ? (
        <div className="flex flex-col gap-1 rounded-sm bg-surface px-2.5 py-2">
          <p className="text-2xs font-medium uppercase tracking-wide text-ink-3">In plain words</p>
          <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-4 text-xs text-ink">
            {story.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {summary.next ? <p className="text-xs text-ink-2">{summary.next}</p> : null}
      {stale ? (
        <p className="text-xs text-ink-3">
          You changed the draft after this run started; run it again to see the effect.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-ink-3 tabular">
        {duration !== undefined && Number.isFinite(duration) ? (
          <span>{formatMs(duration)}</span>
        ) : null}
        {run.costUsd !== undefined ? <span>{formatCost(run.costUsd)}</span> : null}
        <span>run {run.id.slice(0, 8)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {summary.failedNodeId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onShowNode(summary.failedNodeId as string)}
          >
            Show the failed step
          </Button>
        ) : null}
        {run.status === "waiting_for_human" ? (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/${ws}/human-tasks`}>Open Human tasks</Link>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          asChild
          trailingIcon={<ExternalLink strokeWidth={1.75} aria-hidden="true" />}
        >
          <Link href={`/${ws}/runs/${run.id}`}>Open the full run</Link>
        </Button>
      </div>
    </section>
  );
}
