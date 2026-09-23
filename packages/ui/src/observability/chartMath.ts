/**
 * Pure helpers shared by the observability charts: scales and ticks,
 * formatting per unit, binning, percentiles, stacking, the confidence-gate
 * zone counts and the heatmap ramp. Everything here is side-effect free so the
 * charts stay presentational and the math is unit-testable.
 */
import { scaleLinear, scaleLog, scaleTime } from "d3-scale";
import type { ConfidenceThresholds, GateOutcome } from "@/types";
import { gateOutcome } from "@/types";
import {
  formatCompactNumber,
  formatCost,
  formatMs,
  formatPercent,
  formatTokens,
} from "@/lib/format";

// ---------------------------------------------------------------------------
// Units and value formatting
// ---------------------------------------------------------------------------

/** How a numeric axis or value is rendered. */
export type ChartUnit = "count" | "ms" | "usd" | "percent" | "ratio" | "tokens";

/** Full-precision formatting for tooltips and tiles. */
export function formatUnitValue(value: number, unit: ChartUnit = "count"): string {
  if (!Number.isFinite(value)) return "—";
  switch (unit) {
    case "ms":
      return formatMs(value);
    case "usd":
      return formatCost(value);
    case "percent":
      return formatPercent(value, 1);
    case "ratio":
      return value.toFixed(2);
    case "tokens":
      return formatTokens(value);
    case "count":
      return new Intl.NumberFormat("en").format(Math.round(value));
  }
}

/** Compact formatting for axis ticks: short, no trailing noise. */
export function formatAxisTick(value: number, unit: ChartUnit = "count"): string {
  if (!Number.isFinite(value)) return "";
  switch (unit) {
    case "ms":
      if (value === 0) return "0";
      return value >= 1000 ? `${trimZeros((value / 1000).toFixed(1))}s` : `${Math.round(value)}ms`;
    case "usd":
      if (value === 0) return "$0";
      if (value < 1) return `$${trimZeros(value.toFixed(2))}`;
      return `$${formatCompactNumber(value)}`;
    case "percent":
      return `${trimZeros((value * 100).toFixed(value * 100 < 10 ? 1 : 0))}%`;
    case "ratio":
      return trimZeros(value.toFixed(2));
    case "tokens":
      return formatTokens(value);
    case "count":
      return formatCompactNumber(value);
  }
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

// ---------------------------------------------------------------------------
// Scales and ticks
// ---------------------------------------------------------------------------

export interface NumericScale {
  (value: number): number;
  invert: (px: number) => number;
  ticks: (count?: number) => number[];
  domain: () => number[];
}

/** Linear y scale with a nice domain. Ranges from bottom (`height`) to top (0). */
export function makeLinearScale(
  domain: [number, number],
  range: [number, number],
  nice = true,
): NumericScale {
  const [d0, d1] = domain;
  const safe: [number, number] = d0 === d1 ? [d0, d1 + 1] : [d0, d1];
  const s = scaleLinear().domain(safe).range(range);
  if (nice) s.nice();
  return s;
}

/** Log10 x scale for latency bins. Domain is clamped to positive values. */
export function makeLogScale(domain: [number, number], range: [number, number]): NumericScale {
  const lo = Math.max(domain[0], 1e-3);
  const hi = Math.max(domain[1], lo * 10);
  const s = scaleLog().domain([lo, hi]).range(range);
  return s;
}

/** Nice tick values for a numeric extent. Always includes the extent's nice ends. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const s = scaleLinear()
    .domain([min, max === min ? min + 1 : max])
    .nice(count);
  return s.ticks(count);
}

/** Nice domain for a numeric extent (used to align the y axis with its ticks). */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  const d = scaleLinear()
    .domain([min, max === min ? min + 1 : max])
    .nice(count)
    .domain();
  return [d[0] ?? min, d[1] ?? max];
}

export interface TimeTicks {
  ticks: number[];
  format: (t: number) => string;
  /** Human description of the resolution, e.g. "hour", "day". */
  step: "minute" | "hour" | "day" | "month";
}

const pad2 = (n: number) => n.toString().padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Time-of-day in 24h local time, "09:00". */
export function formatHourMinute(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Mon 14" style day label. */
export function formatDay(t: number): string {
  const d = new Date(t);
  return `${WEEKDAYS[d.getDay()] ?? ""} ${d.getDate()}`;
}

/** "14 Sep" style label. */
export function formatDayMonth(t: number): string {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ""}`;
}

/** "Sep 2026". */
export function formatMonthYear(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

/**
 * Ticks for a time axis. The density adapts to the pixel width (about one
 * tick per 80px) and the label format adapts to the span: minutes for an hour,
 * hours for a day, weekday+date for a couple of weeks, month for longer.
 */
export function timeTicks(domain: [number, number], width: number): TimeTicks {
  const [t0, t1] = domain;
  const span = Math.max(1, t1 - t0);
  const count = Math.max(2, Math.floor(width / 80));
  const scale = scaleTime()
    .domain([new Date(t0), new Date(t1)])
    .range([0, Math.max(width, 1)]);
  const ticks = scale.ticks(count).map((d) => d.getTime());
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  if (span <= 3 * HOUR) return { ticks, format: formatHourMinute, step: "minute" };
  if (span <= 2 * DAY) {
    return {
      ticks,
      format: (t) => {
        const d = new Date(t);
        return d.getHours() === 0 && d.getMinutes() === 0 ? formatDay(t) : formatHourMinute(t);
      },
      step: "hour",
    };
  }
  if (span <= 21 * DAY) return { ticks, format: formatDay, step: "day" };
  if (span <= 400 * DAY) return { ticks, format: formatDayMonth, step: "day" };
  return { ticks, format: formatMonthYear, step: "month" };
}

/** Index of the value in a sorted array nearest to `x`. */
export function nearestIndex(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid] ?? 0;
    if (v < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const a = sorted[lo - 1] ?? 0;
    const b = sorted[lo] ?? 0;
    if (Math.abs(a - x) <= Math.abs(b - x)) return lo - 1;
  }
  return lo;
}

/** [min, max] of a list, ignoring non-finite values. Empty → [0, 0]. */
export function extent(values: readonly number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? [0, 0] : [min, max];
}

// ---------------------------------------------------------------------------
// Series colours (fixed slots, never cycled)
// ---------------------------------------------------------------------------

/**
 * Categorical series slots in fixed order. Slot 0 is graphite (`--ink-2`): the
 * first series is usually the primary count (runs, latency, cost), which is not a
 * decision, and cobalt means decision (IDENTITY.md "Cobalt means decision ...
 * Nothing else is blue"). The remaining slots are the category hues, validated
 * with the dataviz palette checker in both themes (adjacent CVD ΔE ≥ 23 and
 * normal-vision ΔE ≥ 29 for the first four). `--cat-decision` is never a
 * positional slot: a series that plots decision data asks for it explicitly with
 * `seriesColor("decision")`. Past eight series, fold the tail into "Other".
 */
export const SERIES_COLORS: readonly string[] = [
  "var(--ink-2)",
  "var(--cat-generation)",
  "var(--cat-agent)",
  "var(--cat-retrieval)",
  "var(--cat-state)",
  "var(--cat-data)",
  "var(--cat-safety)",
  "var(--cat-human)",
];

/** The explicit decision slot: the only series colour that is cobalt. */
export const DECISION_SERIES_COLOR = "var(--cat-decision)";

/** Default stroke/fill of single-series charts (`Sparkline`, `BarChart`, `TimeSeriesChart`, `LatencyHistogram`). */
export const DEFAULT_SERIES_COLOR = "var(--ink-2)";

/**
 * Colour for the n-th series, or for the explicit `"decision"` slot. The last
 * positional slot repeats rather than generating new hues.
 */
export function seriesColor(slot: number | "decision"): string {
  if (slot === "decision") return DECISION_SERIES_COLOR;
  const last = SERIES_COLORS[SERIES_COLORS.length - 1] ?? DEFAULT_SERIES_COLOR;
  return SERIES_COLORS[Math.max(0, slot)] ?? last;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Linear-interpolated percentile (`p` in 0..100) of an unsorted sample.
 * Matches numpy's default "linear" method. Empty → NaN.
 */
export function percentile(values: readonly number[], p: number): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0] ?? Number.NaN;
  const q = Math.min(100, Math.max(0, p)) / 100;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export interface HistogramBin {
  /** Inclusive lower edge. */
  x0: number;
  /** Exclusive upper edge (inclusive for the last bin). */
  x1: number;
  count: number;
}

export interface BinOptions {
  bins?: number;
  /** Fixed domain; defaults to the data extent. */
  domain?: [number, number];
  /** Bin edges evenly spaced in log10 space (latency). Values ≤ 0 are dropped. */
  log?: boolean;
}

/** Equal-width (or equal-ratio when `log`) bins over the domain. */
export function binValues(values: readonly number[], options: BinOptions = {}): HistogramBin[] {
  const { bins = 20, log = false } = options;
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  const count = Math.max(1, Math.floor(bins));
  if (usable.length === 0 && !options.domain) return [];
  const [dmin, dmax] = options.domain ?? extent(usable);
  const lo = log ? Math.log10(Math.max(dmin, 1e-9)) : dmin;
  const hiRaw = log ? Math.log10(Math.max(dmax, 1e-9)) : dmax;
  const hi = hiRaw <= lo ? lo + 1 : hiRaw;
  const width = (hi - lo) / count;
  const result: HistogramBin[] = Array.from({ length: count }, (_, i) => {
    const e0 = lo + i * width;
    const e1 = i === count - 1 ? hi : lo + (i + 1) * width;
    return { x0: log ? 10 ** e0 : e0, x1: log ? 10 ** e1 : e1, count: 0 };
  });
  for (const v of usable) {
    const t = log ? Math.log10(v) : v;
    if (t < lo || t > hi) continue;
    let i = Math.floor((t - lo) / width);
    if (i >= count) i = count - 1;
    if (i < 0) i = 0;
    const bin = result[i];
    if (bin) bin.count += 1;
  }
  return result;
}

export interface ZoneCounts {
  pass: number;
  review: number;
  fail: number;
  total: number;
}

/** How many decisions the confidence gate would send to each outcome. */
export function confidenceZoneCounts(
  confidences: readonly number[],
  thresholds: ConfidenceThresholds,
): ZoneCounts {
  const out: ZoneCounts = { pass: 0, review: 0, fail: 0, total: 0 };
  for (const c of confidences) {
    if (!Number.isFinite(c)) continue;
    const zone: GateOutcome = gateOutcome(c, thresholds);
    out[zone] += 1;
    out.total += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export type DeltaDirection = "up" | "down" | "flat";
export type DeltaTone = "ok" | "danger" | "neutral";

export interface DeltaInfo {
  direction: DeltaDirection;
  tone: DeltaTone;
  /** Fractional change vs previous, e.g. 0.12 for +12%. NaN when previous is 0. */
  change: number;
  /** Absolute difference current − previous. */
  diff: number;
}

/**
 * Direction and tone of a period-over-period change. `lowerIsBetter` flips the
 * tone (latency, cost, error rate). Changes within `flatThreshold` (fraction)
 * read as flat/neutral so noise never lights up green or red.
 */
export function deltaInfo(
  current: number,
  previous: number,
  { lowerIsBetter = false, flatThreshold = 0.002 } = {},
): DeltaInfo {
  const diff = current - previous;
  const change = previous === 0 ? (diff === 0 ? 0 : Number.NaN) : diff / Math.abs(previous);
  const magnitude = Number.isNaN(change) ? Math.abs(diff) : Math.abs(change);
  if (diff === 0 || magnitude < flatThreshold) {
    return { direction: "flat", tone: "neutral", change: Number.isNaN(change) ? 0 : change, diff };
  }
  const direction: DeltaDirection = diff > 0 ? "up" : "down";
  const good = lowerIsBetter ? direction === "down" : direction === "up";
  return { direction, tone: good ? "ok" : "danger", change, diff };
}

// ---------------------------------------------------------------------------
// Stacking
// ---------------------------------------------------------------------------

export interface StackedPoint {
  y0: number;
  y1: number;
}

/**
 * Stack series bottom-up in the given order. Returns `[series][index]` with
 * the running lower/upper bounds; negative and non-finite values count as 0.
 */
export function stackSeries(series: ReadonlyArray<readonly number[]>): StackedPoint[][] {
  const length = series.reduce((m, s) => Math.max(m, s.length), 0);
  const running = new Array<number>(length).fill(0);
  return series.map((s) =>
    Array.from({ length }, (_, i) => {
      const raw = s[i] ?? 0;
      const v = Number.isFinite(raw) && raw > 0 ? raw : 0;
      const y0 = running[i] ?? 0;
      const y1 = y0 + v;
      running[i] = y1;
      return { y0, y1 };
    }),
  );
}

// ---------------------------------------------------------------------------
// Heatmap ramp
// ---------------------------------------------------------------------------

export interface RampStop {
  /** 0..1 position on the ramp; NaN for the "no data" cell. */
  t: number;
  /** CSS colour: ink at an alpha proportional to the step. */
  color: string;
}

/** Ink alpha (percent) at the bottom and the top of the heat ramp. */
const HEAT_ALPHA_MIN = 12;
const HEAT_ALPHA_MAX = 88;

/**
 * Sequential ramp for magnitude: graphite ink at rising alpha, from a light
 * wash at the first step to near-solid ink at the maximum, so the ramp works on
 * any surface and in both themes without spending the decision accent. Zero
 * values sit on `surface-3` so an empty cell reads as empty, not as "low".
 */
export function heatRamp(value: number, max: number, steps = 6): RampStop {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) {
    return { t: 0, color: "var(--surface-3)" };
  }
  const raw = Math.min(1, Math.max(0, value / max));
  // Quantise so neighbouring cells share a step and the legend can list them.
  const t = Math.max(1, Math.ceil(raw * steps)) / steps;
  return { t, color: heatRampColor(t) };
}

/** Colour at a ramp position 0..1: `--ink` mixed with transparent. */
export function heatRampColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const pct = Math.round(HEAT_ALPHA_MIN + clamped * (HEAT_ALPHA_MAX - HEAT_ALPHA_MIN));
  return `color-mix(in oklab, var(--ink) ${pct}%, transparent)`;
}

// ---------------------------------------------------------------------------
// Deterministic sample data
// ---------------------------------------------------------------------------

/** Mulberry32: tiny seeded PRNG so gallery data and screenshots are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sum of a list, ignoring non-finite values. */
export function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) if (Number.isFinite(v)) s += v;
  return s;
}
