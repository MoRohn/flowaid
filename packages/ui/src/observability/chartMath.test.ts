import { describe, expect, it } from "vitest";
import {
  binValues,
  confidenceZoneCounts,
  deltaInfo,
  extent,
  formatAxisTick,
  formatUnitValue,
  heatRamp,
  heatRampColor,
  mulberry32,
  nearestIndex,
  niceDomain,
  niceTicks,
  percentile,
  seriesColor,
  DECISION_SERIES_COLOR,
  DEFAULT_SERIES_COLOR,
  SERIES_COLORS,
  stackSeries,
  timeTicks,
} from "./chartMath";
import { placeTooltip } from "./ChartTooltip";
import { logTicks, packLabels } from "./LatencyHistogram";
import { measureGutter, roundedBarPath } from "./axes";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("ticks and scales", () => {
  it("produces nice ticks that cover the extent", () => {
    const ticks = niceTicks(0, 287, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(287);
    expect(ticks).toEqual([0, 50, 100, 150, 200, 250, 300]);
  });

  it("widens a degenerate domain instead of collapsing it", () => {
    expect(niceDomain(5, 5)).toEqual([5, 6]);
    expect(niceTicks(3, 3).length).toBeGreaterThan(1);
  });

  it("adapts the time tick format to the span", () => {
    const t0 = new Date(2026, 8, 14, 0, 0).getTime();
    expect(timeTicks([t0, t0 + 2 * HOUR], 600).step).toBe("minute");
    expect(timeTicks([t0, t0 + 2 * HOUR], 600).format(t0 + 30 * 60_000)).toBe("00:30");
    const hourly = timeTicks([t0, t0 + DAY], 600);
    expect(hourly.step).toBe("hour");
    expect(hourly.format(t0)).toBe("Mon 14");
    expect(hourly.format(t0 + 6 * HOUR)).toBe("06:00");
    const weekly = timeTicks([t0, t0 + 7 * DAY], 600);
    expect(weekly.step).toBe("day");
    expect(weekly.format(t0 + DAY)).toBe("Tue 15");
    expect(timeTicks([t0, t0 + 90 * DAY], 600).format(t0)).toBe("14 Sep");
    expect(timeTicks([t0, t0 + 800 * DAY], 600).step).toBe("month");
  });

  it("scales the number of time ticks with the width", () => {
    const t0 = new Date(2026, 8, 14).getTime();
    const narrow = timeTicks([t0, t0 + 7 * DAY], 240).ticks.length;
    const wide = timeTicks([t0, t0 + 7 * DAY], 960).ticks.length;
    expect(wide).toBeGreaterThan(narrow);
  });

  it("finds the nearest index in a sorted array", () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 25)).toBe(2);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });

  it("computes an extent that ignores non-finite values", () => {
    expect(extent([3, Number.NaN, -1, 8])).toEqual([-1, 8]);
    expect(extent([])).toEqual([0, 0]);
  });

  it("builds 1-2-5 log ticks", () => {
    expect(logTicks([100, 3000])).toEqual([100, 200, 500, 1000, 2000]);
  });

  it("sizes the axis gutter from the widest label", () => {
    expect(measureGutter(["0", "100", "200"])).toBe(Math.ceil(3 * 6.6) + 8);
    expect(measureGutter(["$1.25"], 40)).toBe(Math.ceil(5 * 6.6) + 8);
    expect(measureGutter([], 40)).toBe(40);
  });
});

describe("formatting", () => {
  it("formats axis ticks per unit", () => {
    expect(formatAxisTick(1500, "ms")).toBe("1.5s");
    expect(formatAxisTick(250, "ms")).toBe("250ms");
    expect(formatAxisTick(0, "usd")).toBe("$0");
    expect(formatAxisTick(0.5, "usd")).toBe("$0.5");
    expect(formatAxisTick(1200, "usd")).toBe("$1.2K");
    expect(formatAxisTick(0.075, "percent")).toBe("7.5%");
    expect(formatAxisTick(0.5, "percent")).toBe("50%");
    expect(formatAxisTick(12000, "count")).toBe("12K");
    expect(formatAxisTick(2500, "tokens")).toBe("2.5k");
  });

  it("formats full values per unit", () => {
    expect(formatUnitValue(16432, "count")).toBe("16,432");
    expect(formatUnitValue(0.9723, "percent")).toBe("97.2%");
    expect(formatUnitValue(1310, "ms")).toBe("1.31 s");
    expect(formatUnitValue(Number.NaN, "usd")).toBe("—");
  });
});

describe("statistics", () => {
  it("interpolates percentiles linearly", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5.5);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile(xs, 90)).toBeCloseTo(9.1, 6);
    expect(percentile([7], 95)).toBe(7);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it("bins values into equal-width buckets", () => {
    const bins = binValues([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { bins: 5, domain: [0, 10] });
    expect(bins).toHaveLength(5);
    expect(bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 3]);
    expect(bins[0]).toMatchObject({ x0: 0, x1: 2 });
    expect(bins[4]).toMatchObject({ x0: 8, x1: 10 });
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(11);
  });

  it("bins values in log space", () => {
    const bins = binValues([10, 20, 50, 100, 200, 500, 1000], { bins: 2, domain: [10, 1000] });
    expect(bins.map((b) => b.count)).toEqual([6, 1]);
    const logBins = binValues([10, 20, 50, 100, 200, 500, 1000], {
      bins: 2,
      domain: [10, 1000],
      log: true,
    });
    expect(logBins[0]?.x1).toBeCloseTo(100, 6);
    expect(logBins.map((b) => b.count)).toEqual([3, 4]);
    expect(binValues([-1, 0, 5], { bins: 1, log: true }).reduce((a, b) => a + b.count, 0)).toBe(1);
  });

  it("returns no bins for an empty sample without a domain", () => {
    expect(binValues([])).toEqual([]);
  });

  it("counts confidence-gate zones", () => {
    const counts = confidenceZoneCounts([0.2, 0.69, 0.7, 0.85, 0.9, 0.95, Number.NaN], {
      review: 0.7,
      auto: 0.9,
    });
    expect(counts).toEqual({ fail: 2, review: 2, pass: 2, total: 6 });
  });

  it("stacks series bottom-up and treats negatives as zero", () => {
    const stacked = stackSeries([
      [1, 2],
      [3, -4],
      [5, 6],
    ]);
    expect(stacked[0]).toEqual([
      { y0: 0, y1: 1 },
      { y0: 0, y1: 2 },
    ]);
    expect(stacked[1]).toEqual([
      { y0: 1, y1: 4 },
      { y0: 2, y1: 2 },
    ]);
    expect(stacked[2]).toEqual([
      { y0: 4, y1: 9 },
      { y0: 2, y1: 8 },
    ]);
  });
});

describe("deltas", () => {
  it("colours a rise green by default and red when lower is better", () => {
    expect(deltaInfo(120, 100)).toMatchObject({ direction: "up", tone: "ok" });
    expect(deltaInfo(120, 100, { lowerIsBetter: true })).toMatchObject({
      direction: "up",
      tone: "danger",
    });
    expect(deltaInfo(80, 100)).toMatchObject({ direction: "down", tone: "danger" });
    expect(deltaInfo(80, 100, { lowerIsBetter: true })).toMatchObject({
      direction: "down",
      tone: "ok",
    });
    expect(deltaInfo(120, 100).change).toBeCloseTo(0.2, 6);
  });

  it("treats tiny changes and equal values as flat", () => {
    expect(deltaInfo(100, 100)).toMatchObject({ direction: "flat", tone: "neutral", change: 0 });
    expect(deltaInfo(100.1, 100)).toMatchObject({ direction: "flat", tone: "neutral" });
  });

  it("handles a zero previous value", () => {
    const d = deltaInfo(5, 0);
    expect(d.direction).toBe("up");
    expect(Number.isNaN(d.change)).toBe(true);
    expect(d.diff).toBe(5);
    expect(deltaInfo(0, 0).direction).toBe("flat");
  });
});

describe("heatmap ramp", () => {
  it("maps zero and non-finite values to the empty cell colour", () => {
    expect(heatRamp(0, 10)).toEqual({ t: 0, color: "var(--surface-3)" });
    expect(heatRamp(Number.NaN, 10).color).toBe("var(--surface-3)");
    expect(heatRamp(5, 0).color).toBe("var(--surface-3)");
  });

  it("quantises into steps and saturates at the maximum", () => {
    expect(heatRamp(10, 10, 5).t).toBe(1);
    expect(heatRamp(1, 10, 5).t).toBeCloseTo(0.2, 6);
    expect(heatRamp(3, 10, 5).t).toBeCloseTo(0.4, 6);
    expect(heatRamp(50, 10, 5).t).toBe(1);
    expect(heatRamp(10, 10).color).toBe(heatRampColor(1));
    expect(heatRampColor(1)).toBe("color-mix(in oklab, var(--ink) 88%, transparent)");
    expect(heatRampColor(0.5)).toBe("color-mix(in oklab, var(--ink) 50%, transparent)");
    expect(heatRampColor(0)).toBe("color-mix(in oklab, var(--ink) 12%, transparent)");
  });

  it("is an ink-alpha ramp that never spends the decision accent", () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const c = heatRampColor(t);
      expect(c).toMatch(/^color-mix\(in oklab, var\(--ink\) \d+%, transparent\)$/);
      expect(c).not.toMatch(/accent|cat-decision|--p-\d/);
    }
  });

  it("is monotone in value", () => {
    const ts = [1, 2, 4, 6, 8, 10].map((v) => heatRamp(v, 10, 6).t);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThanOrEqual(ts[i - 1] ?? 0);
  });
});

describe("series colours", () => {
  it("assigns fixed slots and never generates new hues", () => {
    expect(seriesColor(0)).toBe("var(--ink-2)");
    expect(seriesColor(1)).toBe("var(--cat-generation)");
    expect(seriesColor(99)).toBe(SERIES_COLORS[SERIES_COLORS.length - 1]);
    expect(SERIES_COLORS[0]).toBe(DEFAULT_SERIES_COLOR);
    for (const c of SERIES_COLORS.slice(1)) expect(c).toMatch(/^var\(--cat-/);
  });

  it("keeps cobalt out of the positional slots; decision is an explicit slot", () => {
    expect(SERIES_COLORS).not.toContain("var(--cat-decision)");
    expect(SERIES_COLORS.some((c) => /accent|--p-\d/.test(c))).toBe(false);
    expect(seriesColor("decision")).toBe("var(--cat-decision)");
    expect(DECISION_SERIES_COLOR).toBe("var(--cat-decision)");
  });
});

describe("layout helpers", () => {
  it("places a tooltip inside its bounds and flips when needed", () => {
    const size = { width: 100, height: 40 };
    const bounds = { width: 300, height: 200 };
    expect(placeTooltip({ x: 50, y: 100, bounds, size, offset: 10, side: "right" })).toEqual({
      left: 60,
      top: 80,
    });
    expect(placeTooltip({ x: 250, y: 100, bounds, size, offset: 10, side: "right" })).toEqual({
      left: 140,
      top: 80,
    });
    expect(placeTooltip({ x: 150, y: 10, bounds, size, offset: 10, side: "top" })).toEqual({
      left: 100,
      top: 20,
    });
    const clamped = placeTooltip({ x: 5, y: 195, bounds, size, offset: 10, side: "top" });
    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(145);
  });

  it("packs marker labels without overlap and inside the plot", () => {
    const packed = packLabels(
      [
        { key: 50, x: 100, text: "P50 598 ms" },
        { key: 95, x: 110, text: "P95 1.24 s" },
        { key: 99, x: 120, text: "P99 2.6 s" },
      ],
      0,
      400,
    );
    for (let i = 1; i < packed.length; i++) {
      const prev = packed[i - 1];
      const cur = packed[i];
      if (!prev || !cur) throw new Error("missing label");
      expect(cur.labelX).toBeGreaterThanOrEqual(prev.labelX + prev.text.length * 6.6 + 8);
    }
    const tight = packLabels(
      [
        { key: 95, x: 380, text: "P95 1.24 s" },
        { key: 99, x: 395, text: "P99 2.6 s" },
      ],
      0,
      400,
    );
    const last = tight[tight.length - 1];
    if (!last) throw new Error("missing label");
    expect(last.labelX + last.text.length * 6.6).toBeLessThanOrEqual(400);
    expect(tight[0]?.labelX).toBeGreaterThanOrEqual(0);
  });

  it("draws bars with a rounded data end and a square base", () => {
    const vertical = roundedBarPath(10, 20, 20, 50, "vertical");
    expect(vertical.startsWith("M10,70")).toBe(true);
    expect(vertical).toContain("Q10,20 14,20");
    expect(roundedBarPath(0, 0, 0, 10)).toBe("");
    const horizontal = roundedBarPath(0, 10, 50, 20, "horizontal");
    expect(horizontal).toContain("Q50,10 50,14");
  });
});

describe("mulberry32", () => {
  it("is deterministic for a seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
