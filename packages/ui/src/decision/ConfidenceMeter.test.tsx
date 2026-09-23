import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { gateOutcome } from "@/types";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { ConfidenceSparkbar } from "./ConfidenceSparkbar";
import { gateDescription, gateShares } from "./gate";

afterEach(cleanup);

const GATE = { review: 0.6, auto: 0.9 };

describe("ConfidenceMeter", () => {
  it.each([
    [0.42, "fail", "Fail"],
    [0.599, "fail", "Fail"],
    [0.6, "review", "Review"],
    [0.78, "review", "Review"],
    [0.899, "review", "Review"],
    [0.9, "pass", "Pass"],
    [1, "pass", "Pass"],
    [0, "fail", "Fail"],
  ] as const)("labels %s as %s", (confidence, outcome, label) => {
    render(<ConfidenceMeter confidence={confidence} thresholds={GATE} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("data-outcome", outcome);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(gateOutcome(confidence, GATE)).toBe(outcome);
  });

  it("clamps out-of-range and non-finite confidences", () => {
    render(<ConfidenceMeter confidence={1.4} thresholds={GATE} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1");
    cleanup();
    render(<ConfidenceMeter confidence={Number.NaN} thresholds={GATE} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("meter")).toHaveAttribute("data-outcome", "fail");
  });

  it("draws three zones and hides them on request", () => {
    const { container, rerender } = render(<ConfidenceMeter confidence={0.5} thresholds={GATE} />);
    expect(container.querySelectorAll("[data-zone]")).toHaveLength(3);
    rerender(<ConfidenceMeter confidence={0.5} thresholds={GATE} showZones={false} />);
    expect(container.querySelectorAll("[data-zone]")).toHaveLength(0);
  });

  it("describes the gate in the value text", () => {
    render(<ConfidenceMeter confidence={0.83} thresholds={GATE} />);
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      "0.83 → review (0.60–0.90)",
    );
    expect(gateDescription(0.95, GATE)).toBe("0.95 → pass (≥ 0.90)");
    expect(gateDescription(0.1, GATE)).toBe("0.10 → fail (< 0.60)");
  });

  it("omits the outcome badge and value when asked", () => {
    render(
      <ConfidenceMeter confidence={0.94} thresholds={GATE} showOutcome={false} showValue={false} />,
    );
    expect(screen.queryByText("Pass")).toBeNull();
    expect(screen.queryByText("0.94")).toBeNull();
  });
});

describe("ConfidenceSparkbar", () => {
  it("tints by outcome and reads the gate", () => {
    const { container } = render(<ConfidenceSparkbar value={0.72} thresholds={GATE} />);
    const el = container.firstElementChild;
    expect(el).toHaveAttribute("data-outcome", "review");
    expect(el).toHaveAttribute("aria-label", "0.72 → review (0.60–0.90)");
    expect(screen.getByText("0.72")).toBeInTheDocument();
  });
});

describe("gateShares", () => {
  it("splits confidences across outcomes and ignores NaN", () => {
    const shares = gateShares([0.1, 0.5, 0.6, 0.7, 0.9, 0.95, Number.NaN], GATE);
    expect(shares.fail).toBeCloseTo(2 / 6);
    expect(shares.review).toBeCloseTo(2 / 6);
    expect(shares.pass).toBeCloseTo(2 / 6);
    expect(gateShares([], GATE)).toEqual({ pass: 0, review: 0, fail: 0 });
  });
});
