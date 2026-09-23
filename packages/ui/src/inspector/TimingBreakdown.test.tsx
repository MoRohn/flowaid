import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { TimingBreakdown, timingSegments } from "./TimingBreakdown";
import { KeyValueList } from "./KeyValueList";
import { makeChoiceDecision } from "@/lib/decisionBuilders";
import { NodeSummaryStrip } from "./NodeSummaryStrip";

installDomStubs();
afterEach(cleanup);

describe("timingSegments", () => {
  it("keeps phase order and drops undefined phases", () => {
    expect(timingSegments({ executionMs: 400, queueMs: 40 }).map((s) => s.key)).toEqual([
      "queue",
      "execution",
    ]);
    expect(
      timingSegments({ queueMs: 1, executionMs: 2, retryMs: 3, humanMs: 4 }).map((s) => s.ms),
    ).toEqual([1, 2, 3, 4]);
    expect(timingSegments({ executionMs: -5 })[0]?.ms).toBe(0);
  });
});

describe("TimingBreakdown", () => {
  it("scales segments to the total and lists shares", () => {
    const { container } = render(<TimingBreakdown timing={{ queueMs: 250, executionMs: 750 }} />);
    const bars = container.querySelectorAll<HTMLElement>('[role="img"] > span');
    expect(bars).toHaveLength(2);
    expect(bars[0]?.style.flexBasis).toBe("25%");
    expect(bars[1]?.style.flexBasis).toBe("75%");
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("1.00 s")).toBeInTheDocument();
  });

  it("uses an explicit total as the denominator and hides zero segments from the bar", () => {
    const { container } = render(
      <TimingBreakdown timing={{ executionMs: 500, retryMs: 0 }} totalMs={2000} />,
    );
    const bars = container.querySelectorAll<HTMLElement>('[role="img"] > span');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.style.flexBasis).toBe("25%");
    expect(screen.getByText("Retries")).toBeInTheDocument();
    expect(screen.getByText("2.00 s")).toBeInTheDocument();
  });

  it("omits the legend in compact mode", () => {
    render(<TimingBreakdown timing={{ executionMs: 5 }} compact />);
    expect(screen.queryByText("Execution")).toBeNull();
  });
});

describe("KeyValueList", () => {
  it("renders rows, mono values and copy buttons only for copyable rows", () => {
    render(
      <KeyValueList
        mono
        items={[
          { label: "Run id", value: "run_1" },
          { label: "Reason", value: <em>nested</em> },
        ]}
      />,
    );
    expect(screen.getByText("run_1").closest("dd")?.className).toContain("font-mono");
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);
  });
});

describe("NodeSummaryStrip", () => {
  it("shows status, duration, cost, tokens and provider", () => {
    render(
      <NodeSummaryStrip
        nodeRun={{
          id: "nr",
          nodeId: "n",
          nodeName: "Classify intent",
          nodeType: "decision.choice",
          category: "decision",
          status: "completed",
          attempt: 2,
          durationMs: 412,
          usage: { inputTokens: 638, outputTokens: 12 },
          costUsd: 0.00041,
          decision: makeChoiceDecision({
            probabilities: { billing: 0.8, technical: 0.2 },
            provider: "jev",
            model: "jev-latest",
            latencyMs: 1,
          }),
        }}
      />,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("412 ms")).toBeInTheDocument();
    expect(screen.getByText("$0.00041")).toBeInTheDocument();
    expect(screen.getByText("638→12")).toBeInTheDocument();
    expect(screen.getByText("jev")).toBeInTheDocument();
  });

  it("shows dashes for missing numbers", () => {
    render(
      <NodeSummaryStrip
        nodeRun={{
          id: "nr",
          nodeId: "n",
          nodeName: "Draft",
          nodeType: "generation.text",
          category: "generation",
          status: "pending",
          attempt: 1,
        }}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
