import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Dashboard } from "./Dashboard";
import { carryForward, confidenceSamples, percent, rangeFor, type DashboardMetrics } from "./logic";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = Date.parse("2026-09-27T12:00:30Z");

const METRICS: DashboardMetrics = {
  from: "2026-09-26T12:01:00.000Z",
  to: "2026-09-27T12:01:00.000Z",
  runs: { total: 42, byStatus: { completed: 40, failed: 2 } },
  successRate: 40 / 42,
  errorRate: 2 / 42,
  latencyMs: { p50: 210, p95: 880, p99: 1200 },
  aiCostUsd: 0.4211,
  tokens: { input: 1000, output: 200 },
  toolLatencyMs: { p50: 80, p95: 140 },
  decisionConfidence: {
    histogram: Array.from({ length: 10 }, (_, i) => ({
      lo: i / 10,
      hi: (i + 1) / 10,
      count: i === 9 ? 30 : 0,
    })),
    mean: 0.95,
  },
  humanReviewRate: 0.1,
  retryRate: 0.05,
  providerFailures: [{ provider: "openai", code: "RATE_LIMIT_ERROR", count: 3 }],
};

function mount(responses: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => Promise.resolve(responses(url))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Dashboard
        ws="default"
        environments={[{ id: "e1", name: "dev", protected: false }]}
        now={() => NOW}
      />
    </QueryClientProvider>,
  );
}

const EMPTY_SERIES = {
  bucket: "1h",
  timestamps: [],
  series: { runs: [], failed: [], costUsd: [], p95LatencyMs: [], humanReviews: [] },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("dashboard helpers", () => {
  it("picks windows and buckets per preset, stable within a minute", () => {
    expect(rangeFor("1h", NOW)).toEqual({
      from: "2026-09-27T11:01:00.000Z",
      to: "2026-09-27T12:01:00.000Z",
      bucket: "1m",
    });
    expect(rangeFor("7d", NOW).bucket).toBe("1h");
    expect(rangeFor("30d", NOW).bucket).toBe("1d");
    expect(rangeFor("24h", NOW + 10_000)).toEqual(rangeFor("24h", NOW));
  });
  it("turns histogram bins into bounded samples", () => {
    const bins = [
      { lo: 0.4, hi: 0.5, count: 3 },
      { lo: 0.9, hi: 1, count: 1 },
    ];
    expect(confidenceSamples(bins)).toEqual([0.45, 0.45, 0.45, 0.95]);
    expect(confidenceSamples([{ lo: 0, hi: 0.1, count: 10_000 }], 100)).toHaveLength(100);
    expect(confidenceSamples([])).toEqual([]);
  });
  it("carries values over gaps and formats rates", () => {
    expect(carryForward([null, 3, null, 5])).toEqual([0, 3, 3, 5]);
    expect(percent(null)).toBe("—");
    expect(percent(0.5)).toBe("50.0%");
  });
});

describe("Dashboard", () => {
  it("shows the tiles and provider failures from the API", async () => {
    mount((url) =>
      url.includes("/v1/metrics/overview")
        ? json(METRICS)
        : url.includes("/v1/metrics/timeseries")
          ? json({
              bucket: "1h",
              timestamps: ["2026-09-27T11:00:00.000Z"],
              series: {
                runs: [42],
                failed: [2],
                costUsd: [0.42],
                p95LatencyMs: [880],
                humanReviews: [4],
              },
            })
          : json({
              items: [{ id: "w1", name: "Refund triage" }],
              next_cursor: null,
              ...EMPTY_SERIES,
            }),
    );
    expect(await screen.findByText("95.2%")).toBeTruthy();
    expect(screen.getByText("2 failed")).toBeTruthy();
    expect(screen.getByText("RATE_LIMIT_ERROR")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Dashboard filters" })).toBeTruthy();
  });

  it("explains an empty range", async () => {
    mount((url) =>
      url.includes("/v1/metrics/overview")
        ? json({ ...METRICS, runs: { total: 0, byStatus: {} }, successRate: null })
        : json({ items: [], next_cursor: null, ...EMPTY_SERIES }),
    );
    expect(await screen.findByText("No runs in this range")).toBeTruthy();
  });

  it("offers a retry when the API fails", async () => {
    mount((url) =>
      url.includes("/v1/metrics/overview")
        ? json({ error: { code: "INTERNAL", message: "database unavailable" } }, 500)
        : json({ items: [], next_cursor: null, ...EMPTY_SERIES }),
    );
    await waitFor(() => expect(screen.getByText("database unavailable")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
