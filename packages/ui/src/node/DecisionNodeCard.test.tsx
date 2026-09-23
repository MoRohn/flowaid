import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import { DecisionNodeCard, decisionKindFor, scoreLevelsFor } from "./DecisionNodeCard";
import { mkRun, triage, triageRuns } from "./fixtures";

installDomStubs();
afterEach(cleanup);

function renderCard(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("DecisionNodeCard", () => {
  it("renders a compact distribution for choice decisions with the chosen option first and the rest folded", () => {
    const { container } = renderCard(
      <DecisionNodeCard node={triage.intent} run={triageRuns.intent} />,
    );
    const list = container.querySelector('[data-decision-kind="choice"]');
    expect(list).not.toBeNull();
    const rows = Array.from(container.querySelectorAll("li[data-key]"));
    expect(rows.map((r) => r.getAttribute("data-key"))).toEqual([
      "billing",
      "technical",
      "account",
    ]);
    expect(rows[0]).toHaveAttribute("data-winner");
    expect(rows[0]).toHaveTextContent("0.81");
    expect(screen.getByRole("button", { name: /\+1 more/ })).toBeInTheDocument();
    expect(screen.getByText("Which team should handle this?")).toBeInTheDocument();
    expect(screen.getByText("412 ms")).toBeInTheDocument();
  });

  it("renders the noul gauge for boolean decisions", () => {
    const { container } = renderCard(
      <DecisionNodeCard node={triage.escalation} run={triageRuns.escalation} />,
    );
    const gauge = container.querySelector('[data-decision-kind="boolean"]');
    expect(gauge).toHaveAttribute("role", "img");
    expect(gauge).toHaveAttribute("data-answer", "no");
    expect(gauge).toHaveAttribute("aria-label", "P(yes) 0.13: 0.87 no");
  });

  it("renders the score scale for score decisions", () => {
    const { container } = renderCard(
      <DecisionNodeCard node={triage.urgency} run={triageRuns.urgency} />,
    );
    const scale = container.querySelector('[data-decision-kind="score"]');
    expect(scale).toHaveAttribute("data-level", "2");
    expect(scale).toHaveAttribute(
      "aria-label",
      "Score 2.00 (High) on a 4-level scale, confidence 0.58",
    );
  });

  it("shows an evaluating bar while running and nothing when idle", () => {
    const running = mkRun(triage.intent, { status: "running", durationMs: undefined });
    const { rerender, container } = renderCard(
      <DecisionNodeCard node={triage.intent} run={running} />,
    );
    expect(screen.getByRole("progressbar", { name: "Evaluating" })).toBeInTheDocument();
    rerender(
      <ReactFlowProvider>
        <DecisionNodeCard node={triage.intent} />
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(container.querySelector("[data-decision-kind]")).toBeNull();
    expect(screen.getByText("jev-latest")).toBeInTheDocument();
  });

  it("derives the kind from the node type when there is no result", () => {
    expect(decisionKindFor({ kind: "task", nodeType: "flowaid.decision.score" })).toBe("score");
    expect(decisionKindFor({ kind: "task", nodeType: "flowaid.decision.boolean" })).toBe("boolean");
    expect(decisionKindFor({ kind: "task", nodeType: "@acme/decision.custom" })).toBe("choice");
    expect(
      decisionKindFor({ kind: "task", nodeType: "flowaid.decision.score" }, triageRuns.escalation),
    ).toBe("boolean");
  });

  it("builds score levels from the result levels or the probability keys", () => {
    expect(scoreLevelsFor({ levels: ["Low", "Mid"] })).toEqual(["Low", "Mid"]);
    expect(scoreLevelsFor({ probabilities: { "2": 0.5, "0": 0.5 } })).toEqual([
      "level 0",
      "level 2",
    ]);
    expect(scoreLevelsFor({})).toEqual([]);
  });
});
