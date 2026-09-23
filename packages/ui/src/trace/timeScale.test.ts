import { describe, expect, it } from "vitest";
import {
  formatOffset,
  formatTick,
  niceTickStep,
  nodeRunWindow,
  runTimeScale,
  spanGeometry,
  tickPositions,
  toMs,
} from "./timeScale";
import { buildTraceRows } from "./traceRows";
import { SAMPLE_LOOP_TOTALS, SAMPLE_T0, buildSampleRun } from "./sampleRun";

const iso = (ms: number) => new Date(SAMPLE_T0 + ms).toISOString();

describe("toMs", () => {
  it("parses ISO timestamps and rejects garbage", () => {
    expect(toMs(iso(0))).toBe(SAMPLE_T0);
    expect(toMs(undefined)).toBeUndefined();
    expect(toMs("not a date")).toBeUndefined();
  });
});

describe("spanGeometry", () => {
  const scale = { originMs: 1000, totalMs: 4000 };
  it("maps start/end into percentages of the window", () => {
    expect(spanGeometry(1000, 3000, scale)).toEqual({ left: 0, width: 50 });
    expect(spanGeometry(2000, 5000, scale)).toEqual({ left: 25, width: 75 });
  });
  it("clamps spans that leave the window and never yields a negative width", () => {
    expect(spanGeometry(500, 2000, scale)).toEqual({ left: 0, width: 25 });
    expect(spanGeometry(4000, 9000, scale)).toEqual({ left: 75, width: 25 });
    expect(spanGeometry(9000, 9500, scale)).toEqual({ left: 100, width: 0 });
    expect(spanGeometry(3000, 2000, scale).width).toBe(0);
  });
});

describe("ticks", () => {
  it("chooses nice steps that keep the tick count at or below the maximum", () => {
    expect(niceTickStep(4470, 6)).toBe(1000);
    expect(niceTickStep(257_000, 6)).toBe(60_000);
    expect(niceTickStep(90, 6)).toBe(20);
    expect(tickPositions(4470, 6)).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(tickPositions(4470, 6).length).toBeLessThanOrEqual(6);
  });
  it("formats tick labels compactly", () => {
    expect(formatTick(0)).toBe("0");
    expect(formatTick(250)).toBe("250 ms");
    expect(formatTick(1500)).toBe("1.5 s");
    expect(formatTick(2000)).toBe("2 s");
    expect(formatTick(60_000)).toBe("1 m");
    expect(formatTick(150_000)).toBe("2 m 30 s");
  });
  it("formats row offsets", () => {
    expect(formatOffset(31)).toBe("31 ms");
    expect(formatOffset(1560)).toBe("1.56 s");
    expect(formatOffset(12_400)).toBe("12.4 s");
    expect(formatOffset(4 * 60_000 + 12_000)).toBe("4 m 12 s");
  });
});

describe("nodeRunWindow", () => {
  it("prefers endedAt, then durationMs, then grows open spans to now", () => {
    const now = SAMPLE_T0 + 5000;
    expect(
      nodeRunWindow({ startedAt: iso(0), endedAt: iso(100), status: "completed" }, now),
    ).toEqual({ startMs: SAMPLE_T0, endMs: SAMPLE_T0 + 100 });
    expect(nodeRunWindow({ startedAt: iso(0), durationMs: 40, status: "completed" }, now)).toEqual({
      startMs: SAMPLE_T0,
      endMs: SAMPLE_T0 + 40,
    });
    expect(nodeRunWindow({ startedAt: iso(0), status: "running" }, now)).toEqual({
      startMs: SAMPLE_T0,
      endMs: now,
    });
    expect(nodeRunWindow({ startedAt: iso(0), status: "skipped" }, now)).toEqual({
      startMs: SAMPLE_T0,
      endMs: SAMPLE_T0,
    });
    expect(nodeRunWindow({ status: "pending" }, now)).toBeUndefined();
  });
});

describe("runTimeScale", () => {
  it("uses the run duration when the run has ended", () => {
    const run = buildSampleRun("completed");
    const scale = runTimeScale(run, SAMPLE_T0 + 10 * 60_000);
    expect(scale.originMs).toBe(SAMPLE_T0);
    expect(scale.totalMs).toBe(run.durationMs);
  });
  it("excludes an open human wait so automation stays legible", () => {
    const run = buildSampleRun("waiting_for_human");
    const scale = runTimeScale(run, SAMPLE_T0 + 6 * 60_000);
    expect(scale.totalMs).toBe(4462);
  });
  it("extends to now while a node is running", () => {
    const run = buildSampleRun("running");
    const now = SAMPLE_T0 + 3600;
    expect(runTimeScale(run, now).totalMs).toBe(3600);
  });
  it("never returns a zero-length window", () => {
    const run = buildSampleRun("queued");
    expect(runTimeScale(run, SAMPLE_T0).totalMs).toBeGreaterThanOrEqual(1);
  });
});

describe("buildTraceRows", () => {
  const run = buildSampleRun("waiting_for_human");
  it("merges retry attempts into one row and keeps the latest attempt on top", () => {
    const rows = buildTraceRows(run.nodeRuns, { loopTotals: SAMPLE_LOOP_TOTALS });
    const lookup = rows.filter((r) => r.kind === "node" && r.nodeRun.nodeId === "lookup_account");
    expect(lookup).toHaveLength(1);
    const row = lookup[0];
    if (!row || row.kind !== "node") throw new Error("expected node row");
    expect(row.nodeRun.attempt).toBe(2);
    expect(row.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(row.attempts[0]?.status).toBe("failed");
  });
  it("groups loop children under iteration headers with the loop total", () => {
    const rows = buildTraceRows(run.nodeRuns, { loopTotals: SAMPLE_LOOP_TOTALS });
    const groups = rows.filter((r) => r.kind === "group");
    expect(groups.map((g) => g.kind === "group" && g.label)).toEqual([
      "Iteration 1 of 3",
      "Iteration 2 of 3",
      "Iteration 3 of 3",
    ]);
    const loopIdx = rows.findIndex((r) => r.kind === "node" && r.nodeRun.id === "nr_09");
    const first = rows[loopIdx + 1];
    const child = rows[loopIdx + 2];
    expect(first?.kind).toBe("group");
    expect(child?.kind).toBe("node");
    expect(child?.depth).toBe(2);
    expect(first?.depth).toBe(1);
  });
  it("hides children of collapsed groups", () => {
    const open = buildTraceRows(run.nodeRuns, { loopTotals: SAMPLE_LOOP_TOTALS });
    const collapsed = buildTraceRows(run.nodeRuns, {
      loopTotals: SAMPLE_LOOP_TOTALS,
      collapsed: new Set(["nr_09#2"]),
    });
    expect(collapsed.length).toBe(open.length - 2);
    const g = collapsed.find((r) => r.kind === "group" && r.id === "nr_09#2");
    expect(g?.kind === "group" && g.collapsed).toBe(true);
  });
  it("orders rows by start time", () => {
    const rows = buildTraceRows(run.nodeRuns);
    const starts = rows
      .map((r) => (r.kind === "node" ? r.nodeRun.startedAt : r.startedAt))
      .map((s) => toMs(s) ?? 0);
    for (let i = 1; i < starts.length; i += 1)
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] ?? 0);
  });
});
