import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EvaluationCaseResultView, EvaluationMetricView, WorkflowVersionView } from "@/types";
import { EvaluationReport } from "./EvaluationReport";

afterEach(cleanup);

const V12: WorkflowVersionView = {
  id: "v12",
  version: 12,
  status: "production",
  createdAt: "2026-09-11T09:12:00Z",
  nodeCount: 11,
};
const V13: WorkflowVersionView = {
  id: "v13",
  version: 13,
  status: "draft",
  createdAt: "2026-09-21T16:40:00Z",
  nodeCount: 12,
};
const METRICS: EvaluationMetricView[] = [
  {
    key: "acc",
    label: "Decision accuracy",
    base: 0.917,
    candidate: 0.958,
    unit: "ratio",
    higherIsBetter: true,
  },
];
const CASES: EvaluationCaseResultView[] = [
  {
    id: "c1",
    name: "Refund request",
    passed: true,
    branch: { expected: "auto", actual: "auto" },
    durationMs: 1620,
  },
  {
    id: "c2",
    name: "Chargeback threat",
    passed: false,
    regression: true,
    expected: { escalate: true },
    actual: { escalate: false },
    branch: { expected: "escalate", actual: "auto" },
    durationMs: 1710,
    costUsd: 0.0087,
  },
  { id: "c3", name: "Empty body", passed: false, expected: "other", actual: "technical" },
];

function renderReport(
  gate: "pass" | "warn" | "fail",
  extra: Partial<React.ComponentProps<typeof EvaluationReport>> = {},
) {
  return render(
    <EvaluationReport
      datasetName="golden"
      base={V12}
      candidate={V13}
      metrics={METRICS}
      cases={CASES}
      gate={gate}
      {...extra}
    />,
  );
}

describe("EvaluationReport", () => {
  it("offers a plain Publish when the gate passes", () => {
    renderReport("pass");
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish anyway" })).not.toBeInTheDocument();
    expect(screen.getByText("Gate passed")).toBeInTheDocument();
  });

  it("offers Publish anyway and Block publish when the gate warns", async () => {
    const onPublish = vi.fn();
    const onBlock = vi.fn();
    renderReport("warn", { onPublish, onBlock });
    expect(screen.getByText("Gate passed with regressions")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish anyway" }));
    await userEvent.click(screen.getByRole("button", { name: "Block publish" }));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("makes Block publish the primary action when the gate fails", () => {
    const { container } = renderReport("fail");
    expect(screen.getByText("Gate failed")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-gate", "fail");
    expect(screen.getByRole("button", { name: "Block publish" }).className).toContain("bg-accent");
  });

  it("lists regressions with expected vs actual and the branch change", () => {
    renderReport("warn");
    expect(screen.getAllByText("regression")).toHaveLength(2);
    expect(screen.getByText('{"escalate":true}')).toBeInTheDocument();
    expect(screen.getByText('{"escalate":false}')).toBeInTheDocument();
    expect(screen.getByText("1/3 passed · 1 regression")).toBeInTheDocument();
  });

  it("renders the per-case table with pass/fail chips and focuses a case", async () => {
    const onFocusCase = vi.fn();
    renderReport("warn", { onFocusCase });
    expect(screen.getAllByText("pass")).toHaveLength(1);
    expect(screen.getAllByText("fail")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Empty body" }));
    expect(onFocusCase).toHaveBeenCalledWith("c3");
  });

  it("shows the calibration note and the version badges", () => {
    renderReport("pass", { calibrationNote: "ECE 0.031 (was 0.052)." });
    expect(screen.getByText("ECE 0.031 (was 0.052).")).toBeInTheDocument();
    // Rendered once in the toolbar (sm and up) and once in the narrow-width row.
    expect(screen.getAllByText("v12")).toHaveLength(2);
    expect(screen.getAllByText("v13")).toHaveLength(2);
  });
});
