import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { BarChart } from "./BarChart";
import { ChartFrame } from "./ChartFrame";
import { ConfidenceHistogram } from "./ConfidenceHistogram";
import { Heatmap } from "./Heatmap";
import { LatencyHistogram } from "./LatencyHistogram";
import { Legend } from "./Legend";
import { MetricTile } from "./MetricTile";
import { Sparkline } from "./Sparkline";
import { StackedAreaChart } from "./StackedAreaChart";
import { StackedBarChart } from "./StackedBarChart";
import { seriesColor } from "./chartMath";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { DashboardFilters } from "./DashboardFilters";
import { ProviderHealthCard } from "./ProviderHealthCard";

beforeAll(installDomStubs);
afterEach(cleanup);

const HOUR = 3_600_000;
const T0 = new Date(2026, 8, 14, 0, 0).getTime();
const timestamps = Array.from({ length: 24 }, (_, i) => T0 + i * HOUR);
const runs = timestamps.map((_, i) => 100 + i * 5);
const errors = timestamps.map((_, i) => i % 3);

describe("TimeSeriesChart", () => {
  it("renders one line per visible series and a text table twin", () => {
    const { container } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[
          { id: "runs", label: "Runs", values: runs },
          { id: "errors", label: "Errors", values: errors },
        ]}
        hiddenSeries={["errors"]}
        width={600}
        height={200}
      />,
    );
    const clipped = container.querySelector("g[clip-path]");
    expect(clipped?.querySelectorAll("path")).toHaveLength(1);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(24);
    expect(screen.getByRole("columnheader", { name: "Runs" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Errors" })).toBeNull();
  });

  it("walks timestamps with the keyboard and shows the tooltip", () => {
    const onActiveChange = vi.fn();
    const { container } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[
          { id: "runs", label: "Runs", values: runs },
          { id: "errors", label: "Errors", values: errors },
        ]}
        width={600}
        height={200}
        onActiveChange={onActiveChange}
      />,
    );
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no svg");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(onActiveChange).toHaveBeenLastCalledWith(22);
    expect(screen.getAllByText("210").length).toBeGreaterThan(1);
    fireEvent.keyDown(svg, { key: "Home" });
    expect(onActiveChange).toHaveBeenLastCalledWith(0);
    expect(screen.getAllByText("14 Sep 00:00").length).toBeGreaterThan(1);
    fireEvent.keyDown(svg, { key: "End" });
    expect(onActiveChange).toHaveBeenLastCalledWith(23);
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it("adds a total to the tooltip when stacked", () => {
    const { container } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[
          { id: "a", label: "A", values: timestamps.map(() => 1) },
          { id: "b", label: "B", values: timestamps.map(() => 2) },
        ]}
        stacked
        width={600}
        height={200}
      />,
    );
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no svg");
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByText("Total 3")).toBeInTheDocument();
  });
});

describe("BarChart", () => {
  const data = [
    { id: "a", label: "Intent", value: 212 },
    { id: "b", label: "Reply", value: 2140 },
  ];

  it("renders one focusable bar per datum with an accessible name", () => {
    render(<BarChart data={data} width={400} height={160} unit="ms" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveAttribute("aria-label", "Reply: 2.14 s");
  });

  it("shows a tooltip on focus and fires onBarSelect from the keyboard", () => {
    const onBarSelect = vi.fn();
    render(<BarChart data={data} width={400} height={160} onBarSelect={onBarSelect} />);
    const bar = screen.getAllByRole("listitem")[0];
    if (!bar) throw new Error("no bar");
    fireEvent.focus(bar);
    expect(screen.getAllByText("212").length).toBeGreaterThan(0);
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(onBarSelect).toHaveBeenCalledWith(data[0]);
  });

  it("supports the horizontal orientation", () => {
    const { container } = render(
      <BarChart data={data} width={400} height={160} orientation="horizontal" />,
    );
    expect(container.querySelectorAll("path[d]").length).toBeGreaterThanOrEqual(2);
  });
});

describe("StackedBarChart", () => {
  it("stacks segments with a total per category and hides toggled series", () => {
    const series = [
      { id: "ok", label: "Completed", values: [10, 20], color: "var(--ok)" },
      { id: "failed", label: "Failed", values: [1, 2], color: "var(--danger)" },
    ];
    render(
      <StackedBarChart categories={["Mon", "Tue"]} series={series} width={400} height={160} />,
    );
    const columns = screen.getAllByRole("listitem");
    expect(columns[1]).toHaveAttribute("aria-label", "Tue: 22 total");
    fireEvent.focus(columns[1] as Element);
    expect(screen.getByText("Total 22")).toBeInTheDocument();

    cleanup();
    render(
      <StackedBarChart
        categories={["Mon", "Tue"]}
        series={series}
        hiddenSeries={["failed"]}
        width={400}
        height={160}
      />,
    );
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-label", "Tue: 20 total");
  });
});

describe("LatencyHistogram", () => {
  it("labels the percentile markers in mono", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
    const { container } = render(<LatencyHistogram values={values} width={500} height={200} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("P50 505 ms");
    expect(texts).toContain("P95 951 ms");
    expect(texts.some((t) => t?.startsWith("P99"))).toBe(true);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(24);
  });

  it("uses log ticks on a log axis", () => {
    const values = [10, 100, 1000, 5000];
    const { container } = render(
      <LatencyHistogram values={values} width={500} height={200} log bins={8} />,
    );
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("100ms");
    expect(texts).toContain("1s");
  });
});

describe("ConfidenceHistogram", () => {
  it("summarises gate outcomes and labels the thresholds", () => {
    const confidences = [0.2, 0.5, 0.72, 0.8, 0.91, 0.95, 0.99];
    const { container } = render(
      <ConfidenceHistogram
        confidences={confidences}
        thresholds={{ review: 0.7, auto: 0.9 }}
        width={500}
        height={180}
      />,
    );
    const summary = screen.getByRole("list", { name: "Gate outcomes" });
    expect(summary.textContent).toContain("Pass3");
    expect(summary.textContent).toContain("Review2");
    expect(summary.textContent).toContain("Fail2");
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("review ≥ 0.70");
    expect(texts).toContain("pass ≥ 0.90");
    const cells = Array.from(container.querySelectorAll("tbody td")).map((c) => c.textContent);
    expect(cells.filter((c) => c === "Fail")).toHaveLength(14);
    expect(cells.filter((c) => c === "Pass")).toHaveLength(2);
  });
});

describe("Heatmap", () => {
  const rows = ["Mon", "Tue"];
  const columns = ["00", "01", "02"];
  const values = [
    [0, 5, 10],
    [2, 0, 8],
  ];

  it("colours cells by the ramp and leaves zero cells empty", () => {
    const { container } = render(
      <Heatmap rows={rows} columns={columns} values={values} width={300} />,
    );
    const cells = Array.from(container.querySelectorAll("rect"));
    expect(cells).toHaveLength(6);
    expect(cells[0]).toHaveAttribute("fill", "var(--surface-3)");
    expect(cells[2]?.getAttribute("fill")).toBe("color-mix(in oklab, var(--ink) 88%, transparent)");
    expect(cells[1]?.getAttribute("fill")).toBe("color-mix(in oklab, var(--ink) 50%, transparent)");
  });

  it("moves the active cell with arrow keys", () => {
    const { container } = render(
      <Heatmap
        rows={rows}
        columns={columns}
        values={values}
        width={300}
        formatCell={(r, c) => `${r} ${c}:00`}
      />,
    );
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("no svg");
    fireEvent.focus(svg);
    expect(screen.getByText("Mon 00:00")).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(screen.getByText("Tue 01:00")).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByText("Tue 02:00")).toBeInTheDocument();
    expect(screen.getAllByText("8").length).toBeGreaterThan(1);
  });
});

describe("Legend and ChartFrame", () => {
  it("renders toggles that report the series id", () => {
    const onToggleItem = vi.fn();
    render(
      <Legend
        items={[
          { id: "a", label: "Runs", color: "var(--ink-2)" },
          { id: "b", label: "Errors", color: "var(--danger)" },
        ]}
        hiddenIds={["b"]}
        onToggleItem={onToggleItem}
      />,
    );
    const errors = screen.getByRole("button", { name: "Errors" });
    expect(errors).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(errors);
    expect(onToggleItem).toHaveBeenCalledWith("b");
  });

  it("shows a skeleton on first load and an empty state with an action", () => {
    const { container } = render(<ChartFrame title="Runs" loading empty height={120} />);
    expect(container.querySelector("section")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".fa-shimmer")).not.toBeNull();
    cleanup();
    render(
      <ChartFrame title="Runs" empty emptyAction={<button type="button">Widen range</button>} />,
    );
    expect(screen.getByText("No data for this range")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Widen range" })).toBeInTheDocument();
  });

  it("omits the legend for a single series", () => {
    render(
      <ChartFrame title="Runs" legend={[{ id: "a", label: "Runs", color: "var(--ink-2)" }]} />,
    );
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });
});

describe("DashboardFilters", () => {
  it("emits a whole filter object when a preset changes", () => {
    const onChange = vi.fn();
    render(
      <DashboardFilters
        value={{ range: "7d", workflowId: "wf_1" }}
        onChange={onChange}
        workflows={[{ id: "wf_1", name: "Support triage" }]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "30d" }));
    expect(onChange).toHaveBeenCalledWith({ range: "30d", workflowId: "wf_1" });
    expect(screen.getByRole("combobox", { name: "Workflow" })).toHaveTextContent("Support triage");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent(
      "All environments",
    );
  });
});

describe("ProviderHealthCard", () => {
  it("renders status, availability and one bar per day", () => {
    render(
      <ProviderHealthCard
        provider={{
          id: "openai",
          name: "OpenAI",
          modelCount: 4,
          status: "degraded",
          availability: 0.9921,
          days: Array.from({ length: 30 }, (_, i) => (i === 17 ? "danger" : "ok")),
          p50Ms: 1240,
          p95Ms: 4860,
          errorRate: 0.0184,
          rateLimitHits: 212,
          lastIncident: { at: "19 Sep 14:20", summary: "Elevated 429s" },
        }}
      />,
    );
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("99.2%")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Daily availability" }).children).toHaveLength(30);
    expect(screen.getByText("Elevated 429s")).toBeInTheDocument();
    expect(screen.getByText("4.86 s")).toBeInTheDocument();
  });
});

describe("StackedAreaChart", () => {
  it("is one labelled image with a <title>", () => {
    const { container } = render(
      <StackedAreaChart
        timestamps={timestamps}
        series={[
          { id: "openai", label: "OpenAI", values: runs },
          { id: "anthropic", label: "Anthropic", values: errors },
        ]}
        width={600}
        height={200}
      />,
    );
    const img = screen.getByRole("img", { name: "OpenAI, Anthropic stacked over time" });
    expect(img.tagName.toLowerCase()).toBe("svg");
    expect(container.querySelector("svg > title")?.textContent).toBe(
      "OpenAI, Anthropic stacked over time",
    );
  });

  it("uses the caller's label for both the name and the title", () => {
    const { container } = render(
      <StackedAreaChart
        timestamps={timestamps}
        series={[{ id: "a", label: "A", values: runs }]}
        label="Cost by provider"
        width={600}
        height={200}
      />,
    );
    expect(screen.getByRole("img", { name: "Cost by provider" })).toBeInTheDocument();
    expect(container.querySelector("svg > title")?.textContent).toBe("Cost by provider");
  });
});

/** Cobalt (the accent, `--cat-decision` and the `--p-*` probability ramp) as a colour value. */
const COBALT = /var\(--(?:accent|cat-decision|p-\d)\)/g;

describe("chart colours: cobalt means decision", () => {
  it("draws single-series charts in graphite by default", () => {
    const { container: spark } = render(<Sparkline data={[1, 3, 2, 5]} label="Trend" />);
    expect(spark.querySelector("path[stroke]")).toHaveAttribute("stroke", "var(--ink-2)");
    expect(spark.querySelector("circle")).toHaveAttribute("fill", "var(--ink-2)");
    cleanup();

    const { container: bars } = render(
      <BarChart
        data={[
          { id: "a", label: "Intent", value: 212 },
          { id: "b", label: "Reply", value: 2140 },
        ]}
        width={400}
        height={160}
      />,
    );
    const fills = Array.from(bars.querySelectorAll("path[fill]")).map((p) =>
      p.getAttribute("fill"),
    );
    expect(fills.filter((f) => f === "var(--ink-2)")).toHaveLength(2);
    cleanup();

    const { container: line } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[{ id: "runs", label: "Runs", values: runs }]}
        width={600}
        height={200}
      />,
    );
    expect(line.querySelector("g[clip-path] path[stroke]")).toHaveAttribute(
      "stroke",
      "var(--ink-2)",
    );
    cleanup();

    const values = Array.from({ length: 50 }, (_, i) => (i + 1) * 10);
    const { container: hist } = render(
      <LatencyHistogram values={values} width={500} height={200} />,
    );
    const histFills = new Set(
      Array.from(hist.querySelectorAll("path[fill]")).map((p) => p.getAttribute("fill")),
    );
    expect(histFills.has("var(--ink-2)")).toBe(true);
    cleanup();

    const { container: tile } = render(
      <MetricTile label="Runs" value={1200} trend={[1, 2, 3, 2, 4]} />,
    );
    expect(tile.querySelector("svg path[stroke]")).toHaveAttribute("stroke", "var(--ink-2)");
  });

  it("gives series slot 0 graphite and the next slots category hues", () => {
    const { container } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[
          { id: "runs", label: "Runs", values: runs },
          { id: "errors", label: "Errors", values: errors },
        ]}
        width={600}
        height={200}
      />,
    );
    const strokes = Array.from(container.querySelectorAll("g[clip-path] path[stroke]")).map((p) =>
      p.getAttribute("stroke"),
    );
    expect(strokes).toEqual(["var(--ink-2)", "var(--cat-generation)"]);
  });

  it("uses --cat-decision only on the explicit decision slot", () => {
    const { container } = render(
      <TimeSeriesChart
        timestamps={timestamps}
        series={[
          { id: "runs", label: "Runs", values: runs },
          {
            id: "confidence",
            label: "Mean confidence",
            values: errors,
            color: seriesColor("decision"),
          },
        ]}
        width={600}
        height={200}
      />,
    );
    const strokes = Array.from(container.querySelectorAll("g[clip-path] path[stroke]")).map((p) =>
      p.getAttribute("stroke"),
    );
    expect(strokes).toEqual(["var(--ink-2)", "var(--cat-decision)"]);
  });

  it("keeps cobalt tokens out of every chart but the decision charts", () => {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error("vitest did not report the test path");
    const dir = dirname(testPath);
    /** Decision charts: the only observability sources allowed to paint in cobalt. */
    const decisionCharts = new Set(["ConfidenceHistogram.tsx", "CalibrationMini.tsx"]);
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(file) || file.includes(".test.") || decisionCharts.has(file))
        continue;
      const source = readFileSync(join(dir, file), "utf8");
      const hits = source.match(COBALT) ?? [];
      // chartMath.ts defines the explicit decision slot, and nothing else.
      const allowed = file === "chartMath.ts" ? ["var(--cat-decision)"] : [];
      if (hits.join() !== allowed.join()) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
    const decisionDir = join(dir, "../decision");
    const calibration = readFileSync(join(decisionDir, "CalibrationChart.tsx"), "utf8");
    expect(calibration.match(COBALT)?.length ?? 0).toBeGreaterThan(0);
  });
});
