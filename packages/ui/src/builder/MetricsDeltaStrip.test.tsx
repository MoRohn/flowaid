import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MetricsDeltaStrip, computeMetricDelta } from "./MetricsDeltaStrip";

afterEach(cleanup);

describe("computeMetricDelta", () => {
  it("formats a ratio improvement in percentage points and colours it ok", () => {
    const d = computeMetricDelta({
      key: "acc",
      label: "Decision accuracy",
      base: 0.917,
      candidate: 0.958,
      unit: "ratio",
      higherIsBetter: true,
    });
    expect(d.deltaText).toBe("+4.1%");
    expect(d.tone).toBe("ok");
    expect(d.direction).toBe("up");
    expect(d.baseText).toBe("91.7%");
    expect(d.candidateText).toBe("95.8%");
  });

  it("treats a latency drop as ok because lower is better", () => {
    const d = computeMetricDelta({
      key: "lat",
      label: "Median latency",
      base: 2140,
      candidate: 1755,
      unit: "ms",
      higherIsBetter: false,
    });
    expect(d.deltaText).toBe("-18%");
    expect(d.tone).toBe("ok");
    expect(d.direction).toBe("down");
  });

  it("treats a cost rise as danger", () => {
    const d = computeMetricDelta({
      key: "cost",
      label: "Cost",
      base: 0.01,
      candidate: 0.0127,
      unit: "usd",
      higherIsBetter: false,
    });
    expect(d.deltaText).toBe("+27%");
    expect(d.tone).toBe("danger");
  });

  it("treats an accuracy drop as danger", () => {
    const d = computeMetricDelta({
      key: "acc",
      label: "Accuracy",
      base: 0.95,
      candidate: 0.9,
      unit: "ratio",
      higherIsBetter: true,
    });
    expect(d.deltaText).toBe("-5.0%");
    expect(d.tone).toBe("danger");
  });

  it("shows counts as absolute differences", () => {
    const d = computeMetricDelta({
      key: "reg",
      label: "Regressions",
      base: 0,
      candidate: 2,
      unit: "count",
      higherIsBetter: false,
    });
    expect(d.deltaText).toBe("+2");
    expect(d.tone).toBe("danger");
  });

  it("is neutral and flat when nothing changed", () => {
    const d = computeMetricDelta({
      key: "x",
      label: "X",
      base: 5,
      candidate: 5,
      unit: "count",
      higherIsBetter: true,
    });
    expect(d.deltaText).toBe("0");
    expect(d.tone).toBe("neutral");
    expect(d.direction).toBe("flat");
  });

  it("is neutral without a baseline and shows only the candidate", () => {
    const d = computeMetricDelta({
      key: "routing",
      label: "Changed routing",
      candidate: 3,
      unit: "count",
      higherIsBetter: false,
    });
    expect(d.deltaText).toBeUndefined();
    expect(d.baseText).toBeUndefined();
    expect(d.candidateText).toBe("3");
    expect(d.tone).toBe("neutral");
  });

  it("handles a zero baseline for relative units without dividing by zero", () => {
    const d = computeMetricDelta({
      key: "c",
      label: "Cost",
      base: 0,
      candidate: 0.5,
      unit: "usd",
      higherIsBetter: false,
    });
    expect(d.deltaText).toBe("+100%");
  });
});

describe("MetricsDeltaStrip", () => {
  it("renders a tile per metric with its tone", () => {
    render(
      <MetricsDeltaStrip
        metrics={[
          {
            key: "acc",
            label: "Decision accuracy",
            base: 0.917,
            candidate: 0.958,
            unit: "ratio",
            higherIsBetter: true,
          },
          {
            key: "lat",
            label: "Median latency",
            base: 2140,
            candidate: 1755,
            unit: "ms",
            higherIsBetter: false,
          },
          {
            key: "reg",
            label: "Regressions",
            base: 0,
            candidate: 2,
            unit: "count",
            higherIsBetter: false,
          },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute("data-tone", "ok");
    expect(items[1]).toHaveAttribute("data-tone", "ok");
    expect(items[2]).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("+4.1%")).toBeInTheDocument();
    expect(screen.getByText("-18%")).toBeInTheDocument();
  });
});
