"use client";
/**
 * A run followed live from the builder: its durable events are fetched incrementally (`after=seq`)
 * and folded into node runs with `foldRunEvents`, until the run reaches a terminal status and its
 * end is folded. The run record is read before the events, so the events always reach at least as
 * far as the status shown; a run that ended is settled against its record (`settleLiveRun`), so no
 * step keeps showing Running after the run failed.
 */
import { useEffect, useEffectEvent, useState } from "react";
import { TERMINAL_RUN_STATUSES, foldRunEvents, type FoldedRun } from "@flowaid/ui/lib";
import {
  ErrorInfoSchema,
  type ErrorInfo,
  type NodeCategory,
  type RunStatus,
} from "@flowaid/workflow-core";
import { get } from "~/api/client";
import type { Page, Run } from "~/api/types";

export interface LiveRun {
  runId: string;
  status: RunStatus;
  folded: FoldedRun;
  run: Run | null;
}

const POLL_MS = 400;
/** A run waiting for a person or an event changes rarely; poll it gently. */
const IDLE_POLL_MS = 3000;
/** Reads after the run ended, waiting for its last events to be folded, before giving up. */
const SETTLE_READS = 10;

const UNFINISHED = new Set(["pending", "running", "waiting", "retry_wait"]);

/** The run record's error as an `ErrorInfo` (the record omits `retryable` when false). */
function errorOf(run: Run | null): ErrorInfo | undefined {
  if (!run?.error) return undefined;
  const parsed = ErrorInfoSchema.safeParse({ retryable: false, ...run.error });
  return parsed.success ? parsed.data : undefined;
}

/**
 * A folded run as its record says it ended: the record's error when no event carried one, the
 * step the error names failed, and any other step still in progress stopped with the run. Runs
 * that have not ended are left as their events say.
 */
export function settleLiveRun(folded: FoldedRun, run: Run | null): FoldedRun {
  if (!run || !TERMINAL_RUN_STATUSES.has(run.status)) return folded;
  const error = folded.error ?? errorOf(run);
  return {
    ...folded,
    status: run.status,
    ...(error ? { error } : {}),
    nodeRuns: folded.nodeRuns.map((nr) => {
      if (!UNFINISHED.has(nr.status)) return nr;
      if (error?.nodeId === nr.nodeId) return { ...nr, status: "failed", error };
      return { ...nr, status: "cancelled" };
    }),
  };
}

export function useLiveRun(
  runId: string | null,
  lookup: {
    categoryFor(nodeId: string): NodeCategory | undefined;
    nameFor(nodeId: string): string | undefined;
  },
): LiveRun | null {
  const [live, setLive] = useState<LiveRun | null>(null);
  const fold = useEffectEvent((events: unknown[]) =>
    foldRunEvents(events, {
      categoryFor: (id) => lookup.categoryFor(id),
      nodeNameFor: (id) => lookup.nameFor(id),
    }),
  );

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const events: unknown[] = [];
    let after = 0;
    let settleReads = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        // the record first: events are written before it changes, so they reach at least as far
        const run = await get<Run>(`/v1/runs/${runId}`);
        let more = true;
        while (more && !cancelled) {
          const page = await get<Page<{ seq: number }>>(
            `/v1/runs/${runId}/events?after=${after}&limit=500`,
          );
          for (const e of page.items) {
            events.push(e);
            after = Math.max(after, e.seq);
          }
          more = page.next_cursor !== null;
        }
        if (cancelled) return;
        const folded = fold(events);
        setLive({ runId, status: run.status, folded: settleLiveRun(folded, run), run });
        const terminal = TERMINAL_RUN_STATUSES.has(run.status);
        // a run that ended keeps being read until its own end event is folded
        const ended =
          terminal &&
          ((folded.status !== undefined && TERMINAL_RUN_STATUSES.has(folded.status)) ||
            ++settleReads >= SETTLE_READS);
        const idle = run.status === "waiting_for_human" || run.status === "waiting";
        if (!ended) timer = setTimeout(() => void tick(), idle ? IDLE_POLL_MS : POLL_MS);
      } catch {
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS * 5);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  // a previous run's state never shows for the next one
  return runId && live?.runId === runId ? live : null;
}
