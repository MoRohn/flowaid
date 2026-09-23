import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { DecisionResult, RunView } from "@/types";
import { makeBooleanDecision, makeChoiceDecision } from "@/lib/decisionBuilders";
import { RunsTable, lowestConfidence, runIsActive } from "./RunsTable";
import { makeSampleRuns } from "./sample";
import { formatWaiting, slaStatus } from "./ApprovalsTable";
import { sparklineGeometry } from "./RunsSparkline";

afterEach(cleanup);
beforeAll(() => installDomStubs());

const NOW = new Date("2026-09-22T12:00:00.000Z").getTime();

function run(partial: Partial<RunView> & { nodeRuns: RunView["nodeRuns"] }): RunView {
  return {
    id: "run_test",
    workflowId: "wf",
    workflowName: "Support triage",
    version: 12,
    status: "completed",
    origin: "api",
    createdAt: new Date(NOW).toISOString(),
    ...partial,
  };
}

const decision = (confidence: number, kind: "choice" | "boolean" = "choice"): DecisionResult =>
  kind === "boolean"
    ? makeBooleanDecision({ pYes: confidence, latencyMs: 400 })
    : makeChoiceDecision({
        probabilities: { billing: confidence, technical: 1 - confidence },
        value: "billing",
        latencyMs: 400,
      });

describe("lowestConfidence", () => {
  it("returns null without decisions", () => {
    expect(lowestConfidence({ nodeRuns: [] })).toBeNull();
    expect(
      lowestConfidence({
        nodeRuns: [
          {
            id: "a",
            nodeId: "lookup",
            nodeName: "Lookup",
            nodeType: "tool.http",
            category: "tool",
            status: "completed",
            attempt: 1,
          },
        ],
      }),
    ).toBeNull();
  });

  it("picks the minimum and counts decisions", () => {
    const r = run({
      nodeRuns: [
        {
          id: "a",
          nodeId: "intent",
          nodeName: "Intent",
          nodeType: "decision.choice",
          category: "decision",
          status: "completed",
          attempt: 1,
          decision: decision(0.91),
        },
        {
          id: "b",
          nodeId: "escalation",
          nodeName: "Escalation",
          nodeType: "decision.boolean",
          category: "decision",
          status: "completed",
          attempt: 1,
          decision: decision(0.62, "boolean"),
        },
        {
          id: "c",
          nodeId: "safety",
          nodeName: "Safety",
          nodeType: "safety.guard",
          category: "safety",
          status: "completed",
          attempt: 1,
          decision: decision(0.97, "boolean"),
        },
      ],
    });
    expect(lowestConfidence(r)).toEqual({
      confidence: 0.62,
      nodeId: "escalation",
      nodeName: "Escalation",
      kind: "boolean",
      decisions: 3,
    });
  });

  it("ignores non-finite confidences", () => {
    const r = run({
      nodeRuns: [
        {
          id: "a",
          nodeId: "x",
          nodeName: "X",
          nodeType: "decision.choice",
          category: "decision",
          status: "completed",
          attempt: 1,
          decision: { ...decision(0.5), confidence: Number.NaN },
        },
        {
          id: "b",
          nodeId: "y",
          nodeName: "Y",
          nodeType: "decision.choice",
          category: "decision",
          status: "completed",
          attempt: 1,
          decision: decision(0.8),
        },
      ],
    });
    expect(lowestConfidence(r)?.nodeId).toBe("y");
  });

  it("knows which runs are still active", () => {
    expect(runIsActive({ status: "running" })).toBe(true);
    expect(runIsActive({ status: "waiting_for_human" })).toBe(true);
    expect(runIsActive({ status: "completed" })).toBe(false);
    expect(runIsActive({ status: "cancelled" })).toBe(false);
  });
});

describe("RunsTable", () => {
  it("renders runs with the lowest confidence and the gate outcome", () => {
    const runs = makeSampleRuns(8, NOW);
    render(<RunsTable runs={runs} showColumnMenu={false} showDensityToggle={false} />);
    const grid = screen.getByRole("grid", { name: "Runs" });
    const rows = within(grid).getAllByRole("row");
    expect(rows).toHaveLength(9); // header + 8
    const first = runs.find((r) => lowestConfidence(r));
    if (!first) throw new Error("expected a run with decisions");
    const low = lowestConfidence(first);
    if (!low) throw new Error("expected a lowest confidence");
    expect(
      screen.getAllByLabelText(new RegExp(`Lowest confidence ${low.confidence.toFixed(2)}`)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("8 runs")).toBeInTheDocument();
  });

  it("opens the actions menu and disables cancel for finished runs", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onCancel = vi.fn();
    const runs = [
      run({ id: "run_done", status: "completed", nodeRuns: [] }),
      run({ id: "run_live", status: "running", nodeRuns: [] }),
    ];
    render(
      <RunsTable
        runs={runs}
        onOpen={onOpen}
        onCancel={onCancel}
        showColumnMenu={false}
        showDensityToggle={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for run_done" }));
    const cancel = await screen.findByRole("menuitem", { name: "Cancel run" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Open run" }));
    expect(onOpen).toHaveBeenCalledWith(runs[0]);
    await user.click(screen.getByRole("button", { name: "Actions for run_live" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cancel run" }));
    expect(onCancel).toHaveBeenCalledWith(runs[1]);
  });
});

describe("ApprovalsTable helpers", () => {
  const H = 3_600_000;
  it("formats waiting durations compactly", () => {
    expect(formatWaiting(42_000)).toBe("42 s");
    expect(formatWaiting(3 * 60_000 + 12_000)).toBe("3 m 12 s");
    expect(formatWaiting(3 * H + 2 * 60_000)).toBe("3 h 02 m");
    expect(formatWaiting(2 * 24 * H + 5 * H)).toBe("2 d 5 h");
    expect(formatWaiting(-5)).toBe("0 s");
  });

  it("derives the SLA tone from the remaining share of the window", () => {
    const requested = new Date(NOW - 2 * H).toISOString();
    const expires = new Date(NOW + 2 * H).toISOString(); // 4h window, half elapsed
    expect(slaStatus(requested, expires, NOW).tone).toBe("warn");
    expect(slaStatus(requested, new Date(NOW + 3 * H).toISOString(), NOW).tone).toBe("ok");
    expect(slaStatus(requested, new Date(NOW + 30 * 60_000).toISOString(), NOW).tone).toBe(
      "danger",
    );
    const overdue = slaStatus(requested, new Date(NOW - 10 * 60_000).toISOString(), NOW);
    expect(overdue.tone).toBe("danger");
    expect(overdue.label).toBe("Overdue 10 m 00 s");
    expect(overdue.fraction).toBe(1);
    expect(slaStatus(requested, undefined, NOW)).toEqual({
      tone: "none",
      remainingMs: null,
      fraction: null,
      label: "No SLA",
    });
  });
});

describe("sparklineGeometry", () => {
  it("scales values into the box and keeps the last point", () => {
    const g = sparklineGeometry([0, 5, 10], 20, 10, 0);
    expect(g.max).toBe(10);
    expect(g.line).toBe("M0 10 L10 5 L20 0");
    expect(g.last).toEqual({ x: 20, y: 0 });
    expect(g.area.endsWith("L20 10 L0 10 Z")).toBe(true);
  });

  it("draws a baseline for flat or empty series", () => {
    expect(sparklineGeometry([0, 0], 20, 10, 2).line).toBe("M0 8 L20 8");
    expect(sparklineGeometry([], 20, 10)).toEqual({ line: "", area: "", last: null, max: 0 });
  });
});
