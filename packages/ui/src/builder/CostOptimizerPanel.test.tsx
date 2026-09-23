import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import {
  CostOptimizerPanel,
  totalSavingsPer1k,
  type CostOptimizationView,
} from "./CostOptimizerPanel";

installDomStubs();
afterEach(cleanup);

const ITEMS: CostOptimizationView[] = [
  {
    id: "o1",
    title: "Replace LLM classification with a TypeSafe choice",
    kind: "model",
    nodeId: "intent",
    nodeName: "Intent",
    nodeCategory: "decision",
    beforeCostPer1k: 2.9,
    afterCostPer1k: 0.62,
    latencyDeltaMs: -840,
    confidenceImpact: "Calibrated.",
  },
  {
    id: "o2",
    title: "Route empty-body tickets with a rule",
    kind: "rule",
    nodeId: "router",
    nodeName: "Router",
    nodeCategory: "flow",
    beforeCostPer1k: 0.71,
    afterCostPer1k: 0.68,
    latencyDeltaMs: -60,
    confidenceImpact: "None.",
  },
];

describe("totalSavingsPer1k", () => {
  it("sums the savings of the selected ids only", () => {
    expect(totalSavingsPer1k(ITEMS, ["o1", "o2"])).toBeCloseTo(2.31);
    expect(totalSavingsPer1k(ITEMS, ["o2"])).toBeCloseTo(0.03);
    expect(totalSavingsPer1k(ITEMS, [])).toBe(0);
  });
});

describe("CostOptimizerPanel", () => {
  it("selects everything by default and applies the selection", async () => {
    const onApply = vi.fn();
    render(<CostOptimizerPanel items={ITEMS} onApply={onApply} />);
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    expect(screen.getByText("−$2.31")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    expect(onApply).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("recomputes the total when a row is unchecked and disables apply when empty", async () => {
    const onSelectionChange = vi.fn();
    const { container } = render(
      <CostOptimizerPanel items={ITEMS} onSelectionChange={onSelectionChange} />,
    );
    const footer = container.querySelector("footer");
    if (!footer) throw new Error("footer missing");
    await userEvent.click(screen.getByRole("checkbox", { name: /Include Replace LLM/ }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["o2"]);
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    expect(within(footer).getByText("−$0.0300")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(screen.getByText("0 of 2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply selected" })).toBeDisabled();
  });

  it("adds a monthly estimate when the run volume is known", () => {
    render(<CostOptimizerPanel items={ITEMS} runsPerMonth={100_000} />);
    expect(screen.getByText("≈ −$231.00/mo")).toBeInTheDocument();
  });
});
