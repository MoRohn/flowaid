/**
 * Deterministic sample data for the observability gallery: a week of a
 * support-triage workflow (Intent choice → Urgency score → Escalation →
 * Router → HTTP tools → reply generation → safety → confidence gate →
 * approval). Seeded so screenshots are stable.
 */
import { mulberry32, percentile } from "./chartMath";
import type { CalibrationPoint } from "./CalibrationMini";
import type { ProviderHealthView } from "./ProviderHealthCard";
import type { TimeSeriesData } from "./TimeSeriesChart";
import type { StackedBarSeries } from "./StackedBarChart";

export interface OverviewSample {
  /** Hourly timestamps for the last 7 days, ascending. */
  hourly: number[];
  runs: number[];
  errors: number[];
  /** Cost per hour by provider, in USD. */
  costByProvider: TimeSeriesData[];
  /** Runs by status per day. */
  days: string[];
  runsByStatus: StackedBarSeries[];
  latencies: number[];
  confidences: number[];
  calibration: CalibrationPoint[];
  heatRows: string[];
  heatColumns: string[];
  heatValues: number[][];
  providers: ProviderHealthView[];
  dayLabels30: string[];
  tiles: {
    runs: { value: number; previous: number; trend: number[] };
    successRate: { value: number; previous: number; trend: number[] };
    p95: { value: number; previous: number; trend: number[] };
    cost: { value: number; previous: number; trend: number[] };
    reviewRate: { value: number; previous: number; trend: number[] };
    retryRate: { value: number; previous: number; trend: number[] };
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Fixed "now": Mon 21 Sep 2026 09:00 local. */
const NOW = new Date(2026, 8, 21, 9, 0, 0, 0).getTime();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Diurnal + weekday load shape in [0.15, 1]. */
function loadShape(t: number): number {
  const d = new Date(t);
  const hour = d.getHours() + d.getMinutes() / 60;
  const weekday = d.getDay();
  const daytime = 0.2 + 0.8 * Math.max(0, Math.sin(((hour - 6) / 16) * Math.PI));
  const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
  return Math.max(0.15, daytime * weekend);
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function buildOverviewSample(seed = 20260921): OverviewSample {
  const rand = mulberry32(seed);

  // ---- hourly runs and errors for 7 days -------------------------------
  const hourly: number[] = [];
  const runs: number[] = [];
  const errors: number[] = [];
  for (let i = 7 * 24 - 1; i >= 0; i--) {
    const t = NOW - i * HOUR;
    const base = 210 * loadShape(t);
    const spike = i === 52 ? 1.6 : 1; // a Friday-afternoon burst
    const r = Math.round(base * spike * (1 + 0.18 * gaussian(rand)));
    const errRate = 0.012 + (i === 52 ? 0.05 : 0) + (i >= 100 && i <= 104 ? 0.03 : 0);
    hourly.push(t);
    runs.push(Math.max(0, r));
    errors.push(Math.max(0, Math.round(r * errRate * (1 + 0.4 * gaussian(rand)))));
  }

  // ---- cost by provider per hour ---------------------------------------
  const providerMix: Array<{ id: string; label: string; perRun: number; jitter: number }> = [
    { id: "typesafe", label: "TypeSafe", perRun: 0.0011, jitter: 0.08 },
    { id: "openai", label: "OpenAI", perRun: 0.0042, jitter: 0.2 },
    { id: "anthropic", label: "Anthropic", perRun: 0.0035, jitter: 0.2 },
    { id: "ollama", label: "Ollama", perRun: 0.0002, jitter: 0.05 },
  ];
  const costByProvider: TimeSeriesData[] = providerMix.map((p) => ({
    id: p.id,
    label: p.label,
    values: runs.map((r, i) => {
      // Anthropic takes over generation from OpenAI on day 4 (a provider switch).
      const share =
        p.id === "openai"
          ? i < 4 * 24
            ? 1
            : 0.35
          : p.id === "anthropic"
            ? i < 4 * 24
              ? 0.4
              : 1
            : 1;
      return +(r * p.perRun * share * (1 + p.jitter * gaussian(rand))).toFixed(4);
    }),
  }));

  // ---- runs by status per day ------------------------------------------
  const days: string[] = [];
  const perDay: Array<{ completed: number; failed: number; waiting: number; cancelled: number }> =
    [];
  for (let d = 6; d >= 0; d--) {
    const t = NOW - d * DAY;
    days.push(WEEKDAYS[(new Date(t).getDay() + 6) % 7] ?? "");
    const dayRuns = runs.slice((6 - d) * 24, (7 - d) * 24).reduce((a, b) => a + b, 0);
    const failed = Math.round(dayRuns * (0.015 + (d === 4 ? 0.02 : 0)));
    const waiting = Math.round(dayRuns * (0.08 + 0.02 * rand()));
    const cancelled = Math.round(dayRuns * 0.006);
    perDay.push({ completed: dayRuns - failed - waiting - cancelled, failed, waiting, cancelled });
  }
  const runsByStatus: StackedBarSeries[] = [
    {
      id: "completed",
      label: "Completed",
      color: "var(--ok)",
      values: perDay.map((d) => d.completed),
    },
    {
      id: "waiting",
      label: "Waiting for approval",
      color: "var(--warn)",
      values: perDay.map((d) => d.waiting),
    },
    { id: "failed", label: "Failed", color: "var(--danger)", values: perDay.map((d) => d.failed) },
    {
      id: "cancelled",
      label: "Cancelled",
      color: "var(--ink-3)",
      values: perDay.map((d) => d.cancelled),
    },
  ];

  // ---- latency samples (log-normal, long tail) --------------------------
  const latencies: number[] = [];
  for (let i = 0; i < 2400; i++) {
    const tail = rand() < 0.04 ? 2.2 : 1;
    latencies.push(Math.round(Math.exp(6.35 + 0.42 * gaussian(rand)) * tail));
  }

  // ---- decision confidences (bimodal: confident majority, uncertain tail) -
  const confidences: number[] = [];
  for (let i = 0; i < 1800; i++) {
    const u = rand();
    const c =
      u < 0.68
        ? 0.93 + 0.055 * gaussian(rand)
        : u < 0.9
          ? 0.8 + 0.06 * gaussian(rand)
          : 0.55 + 0.12 * gaussian(rand);
    confidences.push(Math.min(0.999, Math.max(0.05, c)));
  }

  // ---- calibration buckets -----------------------------------------------
  const calibration: CalibrationPoint[] = [
    { predicted: 0.32, observed: 0.36, count: 41 },
    { predicted: 0.45, observed: 0.47, count: 68 },
    { predicted: 0.55, observed: 0.53, count: 112 },
    { predicted: 0.65, observed: 0.6, count: 148 },
    { predicted: 0.75, observed: 0.71, count: 206 },
    { predicted: 0.85, observed: 0.83, count: 390 },
    { predicted: 0.93, observed: 0.92, count: 612 },
    { predicted: 0.98, observed: 0.975, count: 223 },
  ];

  // ---- heatmap: runs by hour × weekday ------------------------------------
  const heatRows = WEEKDAYS;
  const heatColumns = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, "0")}`);
  const heatValues = heatRows.map((_, wi) =>
    heatColumns.map((_, h) => {
      const t = new Date(2026, 8, 14 + wi, h).getTime();
      return Math.round(205 * loadShape(t) * (1 + 0.15 * gaussian(rand)));
    }),
  );

  // ---- providers -----------------------------------------------------------
  const dayLabels30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(NOW - (29 - i) * DAY);
    return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] ?? ""}`;
  });
  const strip = (bad: Array<[number, "warn" | "danger"]>): ProviderHealthView["days"] =>
    Array.from({ length: 30 }, (_, i) => bad.find(([idx]) => idx === i)?.[1] ?? "ok");
  const providers: ProviderHealthView[] = [
    {
      id: "typesafe",
      name: "TypeSafe",
      modelCount: 3,
      status: "healthy",
      availability: 0.9998,
      days: strip([]),
      p50Ms: 142,
      p95Ms: 388,
      errorRate: 0.0012,
      rateLimitHits: 0,
    },
    {
      id: "openai",
      name: "OpenAI",
      modelCount: 4,
      status: "degraded",
      availability: 0.9921,
      days: strip([
        [11, "warn"],
        [17, "danger"],
        [28, "warn"],
      ]),
      p50Ms: 1240,
      p95Ms: 4860,
      errorRate: 0.0184,
      rateLimitHits: 212,
      lastIncident: {
        at: "19 Sep 14:20",
        summary: "Elevated 429s on gpt-5-mini, failover to Anthropic",
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      modelCount: 3,
      status: "healthy",
      availability: 0.9987,
      days: strip([[4, "warn"]]),
      p50Ms: 980,
      p95Ms: 3120,
      errorRate: 0.0041,
      rateLimitHits: 18,
      lastIncident: { at: "26 Aug 09:05", summary: "Latency above SLO for 40 min" },
    },
    {
      id: "ollama",
      name: "Ollama",
      modelCount: 2,
      status: "healthy",
      availability: 1,
      days: strip([]),
      p50Ms: 610,
      p95Ms: 2380,
      errorRate: 0,
      rateLimitHits: 0,
      local: true,
    },
  ];

  // ---- tiles ------------------------------------------------------------
  const totalRuns = runs.reduce((a, b) => a + b, 0);
  const totalErrors = errors.reduce((a, b) => a + b, 0);
  const dailyRuns = perDay.map((d) => d.completed + d.failed + d.waiting + d.cancelled);
  const dailySuccess = perDay.map(
    (d) => 1 - d.failed / Math.max(1, d.completed + d.failed + d.waiting + d.cancelled),
  );
  const dailyCost = Array.from({ length: 7 }, (_, d) =>
    costByProvider.reduce(
      (acc, s) => acc + s.values.slice(d * 24, (d + 1) * 24).reduce((a, b) => a + b, 0),
      0,
    ),
  );
  const weekCost = dailyCost.reduce((a, b) => a + b, 0);
  const p95 = percentile(latencies, 95);
  const reviewRate = perDay.map(
    (d) => d.waiting / Math.max(1, d.completed + d.failed + d.waiting + d.cancelled),
  );
  const retryTrend = [0.041, 0.038, 0.044, 0.052, 0.036, 0.033, 0.031];

  const tiles: OverviewSample["tiles"] = {
    runs: { value: totalRuns, previous: Math.round(totalRuns * 0.91), trend: dailyRuns },
    successRate: {
      value: 1 - totalErrors / Math.max(1, totalRuns),
      previous: 0.976,
      trend: dailySuccess,
    },
    p95: {
      value: Math.round(p95),
      previous: Math.round(p95 * 1.12),
      trend: [1480, 1420, 1510, 1690, 1390, 1310, Math.round(p95)],
    },
    cost: { value: weekCost, previous: weekCost * 1.06, trend: dailyCost },
    reviewRate: {
      value: reviewRate.reduce((a, b) => a + b, 0) / reviewRate.length,
      previous: 0.104,
      trend: reviewRate,
    },
    retryRate: { value: 0.031, previous: 0.041, trend: retryTrend },
  };

  return {
    hourly,
    runs,
    errors,
    costByProvider,
    days,
    runsByStatus,
    latencies,
    confidences,
    calibration,
    heatRows,
    heatColumns,
    heatValues,
    providers,
    dayLabels30,
    tiles,
  };
}
