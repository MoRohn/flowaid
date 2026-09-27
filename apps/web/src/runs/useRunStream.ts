"use client";
/**
 * `useRunStream(runId, { afterSeq, onEvent })`: live events of one run over SSE (UI.md §1, §4.3;
 * API.md §5.1). Generic on purpose: the trace viewer merges events into its list, the builder
 * folds them into its live overlay. Events are delivered in batches per animation frame so a
 * burst of generation deltas renders once.
 */
import { useEffect, useRef, useState } from "react";
import { requestHeaders } from "~/api/client";
import { openRunStream, type RunStreamState } from "./stream";

export interface UseRunStreamOptions {
  /** Resume after this durable `seq` (the last event already loaded). */
  afterSeq?: number;
  /** Off while the initial load is pending or the run is terminal. */
  enabled?: boolean;
  /** Streams to include besides durable events (`deltas` by default; `logs` for LOG lines). */
  include?: readonly ("deltas" | "logs")[];
  /** Receives the events of one frame, in arrival order. */
  onEvents: (events: unknown[]) => void;
}

const IDLE: RunStreamState = { status: "connecting", attempt: 0, resumed: false };

export function useRunStream(
  runId: string | null | undefined,
  o: UseRunStreamOptions,
): RunStreamState {
  const [state, setState] = useState<RunStreamState>(IDLE);
  const onEvents = useRef(o.onEvents);
  useEffect(() => {
    onEvents.current = o.onEvents;
  });
  const enabled = o.enabled ?? true;
  const include = (o.include ?? ["deltas"]).join(",");
  // `afterSeq` only matters when (re)opening: later changes must not restart the stream.
  const afterSeq = useRef(o.afterSeq ?? 0);
  useEffect(() => {
    afterSeq.current = o.afterSeq ?? 0;
  });

  useEffect(() => {
    if (!runId || !enabled) return;
    let pending: unknown[] = [];
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      const batch = pending;
      pending = [];
      if (batch.length) onEvents.current(batch);
    };
    const s = openRunStream({
      url: `/v1/runs/${runId}/stream?include=${encodeURIComponent(include)}`,
      headers: () => requestHeaders(),
      afterSeq: afterSeq.current,
      onEvent: (e) => {
        pending.push(e);
        frame ??= requestAnimationFrame(flush);
      },
      onState: setState,
    });
    return () => {
      s.close();
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
    };
  }, [runId, enabled, include]);

  return enabled ? state : { ...IDLE, status: "ended" };
}
