/**
 * Pure time-scaling math for the trace timeline: converting ISO timestamps to
 * offsets on the run's clock, laying out spans as percentages, and choosing
 * "nice" ruler ticks. Kept free of React so it can be unit-tested directly.
 */
import type { NodeRunView, RunView } from "@/types";

export interface TimeScale {
  /** Epoch ms of the run's t=0. */
  originMs: number;
  /** Length of the visible window in ms (never 0). */
  totalMs: number;
}

/** Parse an ISO timestamp to epoch ms; `undefined` for missing or invalid input. */
export function toMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve the effective start/end of a node run in epoch ms. A run that has
 * started but not ended is considered to extend to `nowMs` (live spans grow).
 */
export function nodeRunWindow(
  nodeRun: Pick<NodeRunView, "startedAt" | "endedAt" | "durationMs" | "status">,
  nowMs: number,
): { startMs: number; endMs: number } | undefined {
  const start = toMs(nodeRun.startedAt);
  if (start === undefined) return undefined;
  const ended = toMs(nodeRun.endedAt);
  if (ended !== undefined) return { startMs: start, endMs: Math.max(start, ended) };
  if (nodeRun.durationMs !== undefined)
    return { startMs: start, endMs: start + nodeRun.durationMs };
  const open =
    nodeRun.status === "running" ||
    nodeRun.status === "retry_wait" ||
    nodeRun.status === "waiting" ||
    nodeRun.status === "pending";
  return { startMs: start, endMs: open ? Math.max(start, nowMs) : start };
}

/**
 * Build the scale for a run: origin is the run's `startedAt` (or the earliest
 * node start), total is the run duration, or the distance to the latest node
 * end / `nowMs` while the run is still active. A minimum of 1 ms avoids
 * divide-by-zero on empty runs.
 */
export function runTimeScale(
  run: Pick<RunView, "startedAt" | "createdAt" | "endedAt" | "durationMs" | "status" | "nodeRuns">,
  nowMs: number,
): TimeScale {
  const nodeStarts = run.nodeRuns
    .map((n) => toMs(n.startedAt))
    .filter((t): t is number => t !== undefined);
  const originMs =
    toMs(run.startedAt) ??
    (nodeStarts.length ? Math.min(...nodeStarts) : (toMs(run.createdAt) ?? nowMs));
  const advancing =
    run.status === "starting" || run.status === "running" || run.status === "retrying";
  let endMs = toMs(run.endedAt);
  if (endMs === undefined && run.durationMs !== undefined) endMs = originMs + run.durationMs;
  if (endMs === undefined) {
    // Open human waits are excluded from the window so a 4-minute review does not
    // flatten the 4 seconds of automation; the waiting span is drawn to the edge.
    const nodeEnds = run.nodeRuns
      .filter((n) => !(n.status === "waiting" && n.endedAt === undefined))
      .map((n) => nodeRunWindow(n, nowMs)?.endMs)
      .filter((t): t is number => t !== undefined);
    endMs = nodeEnds.length ? Math.max(...nodeEnds) : originMs;
    const anyRunning = run.nodeRuns.some(
      (n) => n.status === "running" || n.status === "retry_wait",
    );
    if (advancing || anyRunning) endMs = Math.max(endMs, nowMs);
  }
  return { originMs, totalMs: Math.max(1, endMs - originMs) };
}

export interface SpanGeometry {
  /** Left offset as a percentage of the track width, 0–100. */
  left: number;
  /** Width as a percentage of the track width, 0–100. */
  width: number;
}

/**
 * Position a span on the track. Values are clamped into the window and the
 * width never goes negative, so a span that starts after the window ends
 * collapses to a zero-width marker at the right edge.
 */
export function spanGeometry(startMs: number, endMs: number, scale: TimeScale): SpanGeometry {
  const left = clamp(((startMs - scale.originMs) / scale.totalMs) * 100, 0, 100);
  const right = clamp(((endMs - scale.originMs) / scale.totalMs) * 100, 0, 100);
  return { left, width: Math.max(0, right - left) };
}

const NICE_STEPS_MS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000,
  120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
];

/** Pick the smallest nice step that yields at most `maxTicks` ticks across `totalMs`. */
export function niceTickStep(totalMs: number, maxTicks = 6): number {
  const safeMax = Math.max(1, maxTicks);
  for (const step of NICE_STEPS_MS) {
    if (totalMs / step <= safeMax) return step;
  }
  const last = NICE_STEPS_MS[NICE_STEPS_MS.length - 1] ?? 1;
  return Math.ceil(totalMs / safeMax / last) * last;
}

/** Tick positions in ms from origin, starting at 0 and never exceeding `totalMs`. */
export function tickPositions(totalMs: number, maxTicks = 6): number[] {
  const step = niceTickStep(totalMs, maxTicks);
  const out: number[] = [];
  for (let t = 0; t <= totalMs + 1e-9; t += step) out.push(t);
  return out;
}

/** Short ruler label: "0", "250 ms", "1.5 s", "2 m 30 s". */
export function formatTick(ms: number): string {
  if (ms === 0) return "0";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s === 0 ? `${m} m` : `${m} m ${s.toString().padStart(2, "0")} s`;
}

/** Offset of a timestamp from the scale origin in ms, or undefined. */
export function offsetMs(iso: string | undefined, scale: TimeScale): number | undefined {
  const t = toMs(iso);
  return t === undefined ? undefined : t - scale.originMs;
}

/** "+1.2 s" style label for an offset on the run clock. */
export function formatOffset(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0).padStart(2, "0");
  return `${m} m ${s} s`;
}
