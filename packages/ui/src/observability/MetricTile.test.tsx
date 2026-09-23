import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { MetricTile } from "./MetricTile";
import { MetricsGrid } from "./MetricsGrid";
import { Sparkline } from "./Sparkline";

beforeAll(installDomStubs);
afterEach(cleanup);

describe("MetricTile", () => {
  it("formats the value per unit and shows the period label", () => {
    render(
      <MetricTile
        label="Runs"
        value={16432}
        delta={{ previous: 15000, periodLabel: "vs previous 7d" }}
      />,
    );
    expect(screen.getByText("16,432")).toBeInTheDocument();
    expect(screen.getByText("vs previous 7d")).toBeInTheDocument();
  });

  it("colours an increase green by default", () => {
    const { container } = render(<MetricTile label="Runs" value={120} delta={{ previous: 100 }} />);
    const chip = container.querySelector("[data-tone]");
    expect(chip).toHaveAttribute("data-tone", "ok");
    expect(chip?.textContent).toContain("+20.0%");
    expect(chip?.textContent).toContain("up");
  });

  it("colours an increase red when lower is better", () => {
    const { container } = render(
      <MetricTile
        label="P95 latency"
        unit="ms"
        value={1480}
        lowerIsBetter
        delta={{ previous: 1310 }}
      />,
    );
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("1.48 s")).toBeInTheDocument();
  });

  it("colours a decrease green when lower is better", () => {
    const { container } = render(
      <MetricTile
        label="AI cost"
        unit="usd"
        value={173.9}
        lowerIsBetter
        delta={{ previous: 184.21 }}
      />,
    );
    expect(container.querySelector("[data-tone]")).toHaveAttribute("data-tone", "ok");
    expect(container.querySelector("[data-tone]")?.textContent).toContain("-5.6%");
  });

  it("shows percentage-point deltas for rates and neutral for flat values", () => {
    const { container } = render(
      <MetricTile label="Success rate" unit="percent" value={0.972} delta={{ previous: 0.981 }} />,
    );
    const chip = container.querySelector("[data-tone]");
    expect(chip).toHaveAttribute("data-tone", "danger");
    expect(chip?.textContent).toContain("-0.9 pt");

    const { container: flat } = render(
      <MetricTile label="Retry rate" unit="percent" value={0.031} delta={{ previous: 0.031 }} />,
    );
    expect(flat.querySelector("[data-tone]")).toHaveAttribute("data-tone", "neutral");
  });

  it("renders a string value verbatim, a hint, and no delta chip without a delta", () => {
    const { container } = render(<MetricTile label="Queued" value="—" hint="no data in range" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("no data in range")).toBeInTheDocument();
    expect(container.querySelector("[data-tone]")).toBeNull();
  });

  it("hides the value and delta while loading", () => {
    const { container } = render(
      <MetricTile label="Runs" value={120} loading delta={{ previous: 100 }} trend={[1, 2, 3]} />,
    );
    expect(screen.queryByText("120")).toBeNull();
    expect(container.querySelector("[data-tone]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a sparkline for a trend and none for a single point", () => {
    const { container } = render(<MetricTile label="Runs" value={120} trend={[1, 2, 3, 4]} />);
    expect(container.querySelector("svg path")).not.toBeNull();
    const { container: single } = render(<MetricTile label="Runs" value={120} trend={[4]} />);
    expect(single.querySelector("svg")).toBeNull();
  });

  it("is a keyboard-activatable button when onClick is given", () => {
    const onClick = vi.fn();
    render(<MetricTile label="Runs" value={1} onClick={onClick} />);
    const tile = screen.getByRole("button");
    tile.focus();
    fireEvent.keyDown(tile, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tile, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe("Sparkline", () => {
  it("draws a line, an end dot and a baseline", () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} baseline={2} label="trend" />);
    expect(container.querySelector("svg")).toHaveAttribute("role", "img");
    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("line")).not.toBeNull();
  });

  it("adds an area fill when requested and skips the line for a single point", () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} area />);
    expect(container.querySelectorAll("path")).toHaveLength(2);
    const { container: single } = render(<Sparkline data={[3]} />);
    expect(single.querySelectorAll("path")).toHaveLength(0);
    expect(single.querySelector("circle")).not.toBeNull();
  });
});

describe("MetricsGrid", () => {
  it("builds an auto-fill template from the minimum width", () => {
    const { container } = render(
      <MetricsGrid minWidth={220}>
        <div />
      </MetricsGrid>,
    );
    const el = container.firstElementChild;
    expect(el).toHaveStyle({
      gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))",
    });
  });

  it("caps the column count", () => {
    const { container } = render(
      <MetricsGrid minWidth={160} maxColumns={4} gap={4}>
        <div />
      </MetricsGrid>,
    );
    const style = container.firstElementChild?.getAttribute("style") ?? "";
    expect(style).toContain("/ 4");
    expect(style).toContain("48px");
  });
});
