import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { installDomStubs } from "@/primitives/testStubs";
import { BranchNodeCard } from "./BranchNodeCard";
import { makeBooleanDecision } from "@/lib/decisionBuilders";
import {
  ConfidenceGateNodeCard,
  gateConfigFor,
  gateRoutes,
  gateThresholdsFor,
} from "./ConfidenceGateNodeCard";
import { RouterNodeCard } from "./RouterNodeCard";
import { mkRun, triage, triageRuns } from "./fixtures";

installDomStubs();
afterEach(cleanup);

function renderCard(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function routeRows() {
  return within(screen.getByRole("list", { name: "Routes" })).getAllByRole("listitem");
}

describe("BranchNodeCard", () => {
  it("highlights the taken route and mutes the other after a run", () => {
    renderCard(<BranchNodeCard node={triage.branch} run={triageRuns.branch} />);
    const rows = routeRows();
    expect(rows).toHaveLength(2);
    const taken = rows.find((r) => r.getAttribute("data-route") === "false");
    const other = rows.find((r) => r.getAttribute("data-route") === "true");
    expect(taken).toHaveAttribute("data-taken", "true");
    expect(other).toHaveAttribute("data-taken", "false");
    expect(other).toHaveAttribute("data-muted", "true");
    expect(taken).toBeDefined();
    if (taken) expect(within(taken).getByLabelText("Taken")).toBeInTheDocument();
    expect(screen.getByLabelText("false (control output)")).toHaveAttribute(
      "data-connected",
      "true",
    );
    expect(screen.getByLabelText("true (control output)")).toHaveAttribute(
      "data-connected",
      "false",
    );
  });

  it("marks nothing before a run and falls back to true/false routes", () => {
    renderCard(<BranchNodeCard node={{ ...triage.branch, routes: undefined }} />);
    const rows = routeRows();
    expect(rows.map((r) => r.getAttribute("data-route"))).toEqual(["true", "false"]);
    for (const r of rows) {
      expect(r).toHaveAttribute("data-taken", "false");
      expect(r).not.toHaveAttribute("data-muted");
    }
  });
});

describe("RouterNodeCard", () => {
  it("renders one handle per route with the taken route emphasised", () => {
    renderCard(<RouterNodeCard node={triage.router} run={triageRuns.router} />);
    const rows = routeRows();
    expect(rows).toHaveLength(4);
    expect(
      rows
        .filter((r) => r.getAttribute("data-taken") === "true")
        .map((r) => r.getAttribute("data-route")),
    ).toEqual(["billing"]);
    expect(rows.filter((r) => r.hasAttribute("data-muted"))).toHaveLength(3);
  });
});

describe("ConfidenceGateNodeCard", () => {
  it("reads thresholds from meta and computes the outcome from the incoming confidence", () => {
    expect(gateThresholdsFor(triage.gate)).toEqual({ review: 0.7, auto: 0.9 });
    expect(gateThresholdsFor({ meta: [] })).toEqual({ review: 0.7, auto: 0.9 });
    expect(gateThresholdsFor({ meta: [] }, { review: 0.5, auto: 0.8 })).toEqual({
      review: 0.5,
      auto: 0.8,
    });

    const { container, rerender } = renderCard(<ConfidenceGateNodeCard node={triage.gate} />);
    expect(container.querySelector('[role="meter"]')).toBeNull();
    const run = mkRun(triage.gate, { routeTaken: undefined, input: { confidence: 0.94 } });
    rerender(
      <ReactFlowProvider>
        <ConfidenceGateNodeCard node={triage.gate} run={run} />
      </ReactFlowProvider>,
    );
    const meter = screen.getByRole("meter", { name: "Confidence gate" });
    expect(meter).toHaveAttribute("data-outcome", "pass");
    expect(meter).toHaveAttribute("aria-valuenow", "0.94");
    expect(screen.getByText("0.94")).toBeInTheDocument();
    const rows = routeRows();
    expect(rows.map((r) => r.getAttribute("data-route"))).toEqual(["pass", "review", "fail"]);
    expect(rows[0]).toHaveAttribute("data-taken", "true");
    expect(rows[2]).toHaveAttribute("data-muted", "true");
  });

  it("reads the runtime config (threshold / reviewBand / requireValue) from meta, then the legacy pair", () => {
    expect(gateConfigFor(triage.gate)).toEqual({ threshold: 0.9, reviewBand: 0.2 });
    expect(
      gateConfigFor({
        meta: [
          { label: "threshold", value: "0.8" },
          { label: "requireValue", value: "true" },
        ],
      }),
    ).toEqual({ threshold: 0.8, requireValue: true });
    expect(
      gateConfigFor({
        meta: [
          { label: "review", value: "0.6" },
          { label: "auto", value: "0.85" },
        ],
      }),
    ).toEqual({
      threshold: 0.85,
      reviewBand: 0.25,
    });
    expect(gateConfigFor({ meta: [] }, { gate: { threshold: 0.5 } })).toEqual({ threshold: 0.5 });
  });

  it("drops the fail exit for a two-way gate and routes by the runtime rule", () => {
    expect(gateRoutes({ meta: [] }, { threshold: 0.8 }).map((r) => r.id)).toEqual([
      "pass",
      "review",
    ]);
    const run = mkRun(triage.gate, { routeTaken: undefined, input: { confidence: 0.1 } });
    renderCard(<ConfidenceGateNodeCard node={triage.gate} gate={{ threshold: 0.8 }} run={run} />);
    const rows = routeRows();
    expect(rows.map((r) => r.getAttribute("data-route"))).toEqual(["pass", "review"]);
    expect(rows[1]).toHaveAttribute("data-taken", "true");
  });

  it("applies requireValue to the run's decision: a confident 'no' fails a three-way gate", () => {
    const decision = makeBooleanDecision({ pYes: 0.03 });
    const run = mkRun(triage.gate, { routeTaken: undefined, decision });
    renderCard(
      <ConfidenceGateNodeCard
        node={triage.gate}
        gate={{ threshold: 0.9, reviewBand: 0.2, requireValue: true }}
        run={run}
      />,
    );
    const rows = routeRows();
    expect(rows.find((r) => r.getAttribute("data-route") === "fail")).toHaveAttribute(
      "data-taken",
      "true",
    );
  });
});
