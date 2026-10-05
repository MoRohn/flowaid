"use client";
/**
 * `useRunStream(runId, { status, afterSeq, onEvents })`: live events of one run (UI.md §1, §4.3;
 * API.md §5.1). Generic on purpose: the trace viewer merges events into its list. Events are
 * delivered in batches per animation frame so a burst of generation deltas renders once.
 *
 * The stream is held only while it carries something ({@link followMode}): it asks the API to end
 * when the run starts waiting (`until=suspend`), closes while the tab is hidden, and a waiting
 * run, or a stream that fails or never connects, is followed by polling for the events after the
 * last one instead. When polled events show the run moving again, the stream reopens.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { get, qs, requestHeaders } from "~/api/client";
import {
  FOLLOW_CONNECT_TIMEOUT_MS,
  FOLLOW_POLL_MS,
  followMode,
  openRunStream,
  type FollowMode,
  type RunStreamState,
} from "./stream";
import type { EventPage } from "./types";

export interface UseRunStreamOptions {
  /** The run's current status; nothing is followed until it is known. */
  status: string | undefined;
  /** The last durable `seq` already loaded; streams and polls resume after it. */
  afterSeq?: number;
  /** Off while the initial load is pending. */
  enabled?: boolean;
  /** Streams to include besides durable events (`deltas` by default; `logs` for LOG lines). */
  include?: readonly ("deltas" | "logs")[];
  /** Receives the events of one frame (or one poll), in arrival order. */
  onEvents: (events: unknown[]) => void;
  /** The stream ended or a poll found new events: time to reload the stored run. */
  onSettled?: () => void;
  pollMs?: number;
  connectTimeoutMs?: number;
}

export interface RunFollowState extends RunStreamState {
  mode: FollowMode;
  /** The stream failed or never connected: the page polls instead until `reconnect()`. */
  fallback: boolean;
  /** The last poll failed (FlowAId unreachable); the next one is still scheduled. */
  pollError?: string;
  reconnect: () => void;
}

const IDLE: RunStreamState = { status: "connecting", attempt: 0, resumed: false };

/** Whether the document is visible; true where there is no document (tests, server). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

const seqOf = (e: unknown): number | undefined => {
  const x = e as { seq?: unknown; ephemeral?: unknown };
  return x && x.ephemeral !== true && typeof x.seq === "number" ? x.seq : undefined;
};

export function useRunStream(
  runId: string | null | undefined,
  o: UseRunStreamOptions,
): RunFollowState {
  const visible = useDocumentVisible();
  const [state, setState] = useState<RunStreamState>(IDLE);
  // why the stream is down: "failed" (the page falls back to polling), "ended" (`until=suspend`
  // closed it, or the API ended it while the run still runs)
  const [down, setDown] = useState<"failed" | "ended" | null>(null);
  const [pollError, setPollError] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const onEvents = useRef(o.onEvents);
  const onSettled = useRef(o.onSettled);
  useEffect(() => {
    onEvents.current = o.onEvents;
    onSettled.current = o.onSettled;
  });
  const include = (o.include ?? ["deltas"]).join(",");
  const pollMs = o.pollMs ?? FOLLOW_POLL_MS;
  const connectTimeoutMs = o.connectTimeoutMs ?? FOLLOW_CONNECT_TIMEOUT_MS;
  // `afterSeq` only matters when (re)opening or polling: later changes must not restart anything.
  const seq = useRef(o.afterSeq ?? 0);
  useEffect(() => {
    seq.current = Math.max(seq.current, o.afterSeq ?? 0);
  });
  // when events last arrived (or the page loaded them): the next poll is one interval after
  const lastSeen = useRef(0);
  useEffect(() => {
    lastSeen.current = Date.now();
  }, []);

  const enabled = (o.enabled ?? true) && Boolean(runId) && o.status !== undefined;
  const mode: FollowMode = enabled
    ? followMode({ status: o.status as string, visible, streamDown: down !== null })
    : "idle";

  // A tab shown again gets a fresh stream (and polls at once if it still polls); a stream that
  // ended is history once the run's status moves on (waiting, reopened, ended).
  const [seen, setSeen] = useState({ visible, status: o.status });
  if (seen.visible !== visible || seen.status !== o.status) {
    setSeen({ visible, status: o.status });
    if (
      (visible && !seen.visible && down === "failed") ||
      (seen.status !== o.status && down === "ended")
    )
      setDown(null);
  }

  const streaming = mode === "stream";
  useEffect(() => {
    if (!streaming || !runId) return;
    let pending: unknown[] = [];
    let frame: number | null = null;
    const flush = () => {
      frame = null;
      const batch = pending;
      pending = [];
      if (batch.length) onEvents.current(batch);
    };
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    const waitForOpen = () => {
      connectTimer ??= setTimeout(() => {
        s.close();
        setState((st) => ({ ...st, status: "failed", error: "could not connect" }));
        setDown("failed");
      }, connectTimeoutMs);
    };
    const s = openRunStream({
      url: `/v1/runs/${runId}/stream${qs({ include, until: "suspend" })}`,
      headers: () => requestHeaders(),
      afterSeq: seq.current,
      onEvent: (e) => {
        const n = seqOf(e);
        if (n !== undefined) seq.current = Math.max(seq.current, n);
        lastSeen.current = Date.now();
        pending.push(e);
        frame ??= requestAnimationFrame(flush);
      },
      onState: (st) => {
        setState(st);
        if (st.status === "connecting" || st.status === "reconnecting") waitForOpen();
        else if (connectTimer !== null) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (st.status === "open") setPollError(undefined);
        if (st.status === "failed") setDown("failed");
        if (st.status === "ended") {
          lastSeen.current = Date.now();
          setDown("ended");
          onSettled.current?.();
        }
      },
    });
    return () => {
      if (connectTimer !== null) clearTimeout(connectTimer);
      s.close();
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
    };
  }, [streaming, runId, include, generation, connectTimeoutMs]);

  const polling = mode === "poll";
  useEffect(() => {
    if (!polling || !runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const fresh: unknown[] = [];
        for (let page = 0; page < 20; page++) {
          const res = await get<EventPage>(
            `/v1/runs/${runId}/events${qs({ after: seq.current, limit: 1000 })}`,
            { signal: controller.signal },
          );
          for (const e of res.items) {
            const n = seqOf(e);
            if (n !== undefined) seq.current = Math.max(seq.current, n);
          }
          fresh.push(...res.items);
          if (!res.next_cursor) break;
        }
        lastSeen.current = Date.now();
        setPollError(undefined);
        if (fresh.length) {
          onEvents.current(fresh);
          onSettled.current?.();
          // the run moved: if it runs again, the stream takes over
          setDown((d) => (d === "ended" ? null : d));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPollError(error instanceof Error ? error.message : String(error));
      }
    };
    const loop = () => {
      void tick().finally(() => {
        if (!controller.signal.aborted) timer = setTimeout(loop, pollMs);
      });
    };
    // catch up at once after a hidden spell or a failed stream; otherwise one interval from now
    timer = setTimeout(loop, Math.max(0, lastSeen.current + pollMs - Date.now()));
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [polling, runId, pollMs]);

  const reconnect = useCallback(() => {
    setDown(null);
    setPollError(undefined);
    setGeneration((g) => g + 1);
  }, []);

  return {
    ...(streaming || down !== null ? state : { ...IDLE, status: "ended" }),
    mode,
    fallback: down === "failed",
    ...(pollError ? { pollError } : {}),
    reconnect,
  };
}
