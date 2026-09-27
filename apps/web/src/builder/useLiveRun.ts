"use client";
/**
 * A run followed live from the builder: its durable events are fetched incrementally (`after=seq`)
 * and folded into node runs with `foldRunEvents`, until the run reaches a terminal status.
 */
import { useEffect, useEffectEvent, useState } from "react";
import { TERMINAL_RUN_STATUSES, foldRunEvents, type FoldedRun } from "@flowaid/ui/lib";
import type { NodeCategory, RunStatus } from "@flowaid/workflow-core";
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
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
        const run = await get<Run>(`/v1/runs/${runId}`);
        if (cancelled) return;
        const folded = fold(events);
        setLive({ runId, status: run.status, folded, run });
        const terminal = TERMINAL_RUN_STATUSES.has(run.status);
        const idle = run.status === "waiting_for_human" || run.status === "waiting";
        if (!terminal) timer = setTimeout(() => void tick(), idle ? IDLE_POLL_MS : POLL_MS);
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
