import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProbabilityRuler } from "./ProbabilityRuler";

afterEach(cleanup);

function segments(container: HTMLElement) {
  return Array.from(container.querySelectorAll("i[data-key]")).map((el) => ({
    key: el.getAttribute("data-key"),
    p: Number(el.getAttribute("data-p")),
    color: (el as HTMLElement).style.backgroundColor,
  }));
}

describe("ProbabilityRuler", () => {
  it("normalises distributions that do not sum to 1", () => {
    const { container } = render(<ProbabilityRuler distribution={{ a: 3, b: 1 }} />);
    const segs = segments(container);
    expect(segs.map((s) => s.p)).toEqual([0.75, 0.25]);
    expect(segs.reduce((s, x) => s + x.p, 0)).toBeCloseTo(1);
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Probability ruler: a 0.75, b 0.25",
    );
  });

  it("handles inputs that sum above 1 and zero-only inputs", () => {
    const { container: over } = render(<ProbabilityRuler distribution={{ a: 0.9, b: 0.9 }} />);
    expect(segments(over).map((s) => s.p)).toEqual([0.5, 0.5]);
    cleanup();
    const { container: zero } = render(<ProbabilityRuler distribution={{ a: 0, b: 0, c: 0 }} />);
    expect(segments(zero).map((s) => s.p.toFixed(3))).toEqual(["0.333", "0.333", "0.333"]);
  });

  it("sorts segments and colours the chosen one with --p-1, the rest down the ramp", () => {
    const { container } = render(
      <ProbabilityRuler
        distribution={{ sales: 0.03, security: 0.81, billing: 0.04, technical: 0.12, other: 0 }}
      />,
    );
    const segs = segments(container);
    expect(segs.map((s) => s.key)).toEqual(["security", "technical", "billing", "sales", "other"]);
    expect(segs.map((s) => s.color)).toEqual([
      "var(--p-1)",
      "var(--p-2)",
      "var(--p-3)",
      "var(--p-4)",
      "var(--p-4)",
    ]);
    expect(screen.getByRole("img")).toHaveAttribute("data-chosen", "security");
  });

  it("respects an explicit chosen key that is not the argmax", () => {
    const { container } = render(<ProbabilityRuler distribution={{ a: 0.7, b: 0.3 }} chosen="b" />);
    const segs = segments(container);
    expect(segs.map((s) => s.color)).toEqual(["var(--p-2)", "var(--p-1)"]);
  });

  it("labels only segments at or above the threshold", () => {
    render(
      <ProbabilityRuler
        distribution={{ security: 0.81, technical: 0.12, billing: 0.04, sales: 0.03 }}
        showLabels
      />,
    );
    expect(screen.getByText("security 0.81")).toBeInTheDocument();
    expect(screen.getByText("technical 0.12")).toBeInTheDocument();
    expect(screen.queryByText("billing 0.04")).toBeNull();
  });

  it("keeps input order for ordinal scales when sort is off", () => {
    const { container } = render(
      <ProbabilityRuler
        distribution={{ "0": 0.1, "1": 0.6, "2": 0.3 }}
        labels={{ "0": "Low", "1": "Mid", "2": "High" }}
        sort={false}
        showLabels
      />,
    );
    expect(segments(container).map((s) => s.key)).toEqual(["0", "1", "2"]);
    expect(screen.getByText("Mid 0.60")).toBeInTheDocument();
  });
});
