import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScoreScale, scoreLevelIndex, scorePointerFraction } from "./ScoreScale";
import { scoreLevels, scoreReadout } from "./distribution";

afterEach(cleanup);

const LEVELS = ["Minimal", "Low", "Moderate", "High", "Critical"];

describe("scorePointerFraction", () => {
  it("centres integer scores on their level cell", () => {
    expect(scorePointerFraction(0, 5)).toBeCloseTo(0.1);
    expect(scorePointerFraction(2, 5)).toBeCloseTo(0.5);
    expect(scorePointerFraction(4, 5)).toBeCloseTo(0.9);
  });

  it("places fractional scores between cells", () => {
    expect(scorePointerFraction(3.72, 5)).toBeCloseTo(0.844);
    expect(scorePointerFraction(1.2, 4)).toBeCloseTo(0.425);
  });

  it("clamps outside the scale and tolerates bad input", () => {
    expect(scorePointerFraction(-3, 5)).toBe(0);
    expect(scorePointerFraction(9, 5)).toBe(1);
    expect(scorePointerFraction(Number.NaN, 5)).toBe(0);
    expect(scorePointerFraction(2, 0)).toBe(0);
  });
});

describe("scoreLevelIndex", () => {
  it("rounds to the nearest level and rejects out-of-range scores", () => {
    expect(scoreLevelIndex(3.72, 5)).toBe(4);
    expect(scoreLevelIndex(3.4, 5)).toBe(3);
    expect(scoreLevelIndex(4.6, 5)).toBeUndefined();
    expect(scoreLevelIndex(-0.6, 5)).toBeUndefined();
  });
});

describe("ScoreScale", () => {
  it("positions the pointer and highlights the rounded level", () => {
    const { container } = render(
      <ScoreScale
        levels={LEVELS}
        score={3.72}
        probabilities={{ "3": 0.42, "4": 0.46, "2": 0.12 }}
        confidence={0.77}
      />,
    );
    const root = screen.getByRole("img");
    expect(root).toHaveAttribute("data-level", "4");
    expect(root).toHaveAttribute(
      "aria-label",
      "Score 3.72 (Critical) on a 5-level scale, confidence 0.77",
    );
    expect(screen.getByText("conf 0.77")).toBeInTheDocument();
    const pointer = container.querySelector<HTMLElement>(".absolute.-top-1");
    expect(pointer?.style.left).toBe("84.400%");
  });

  it("normalises level probabilities and shows them under the labels", () => {
    render(<ScoreScale levels={["A", "B"]} score={1} probabilities={[1, 3]} />);
    expect(screen.getByText("0.25")).toBeInTheDocument();
    expect(screen.getByText("0.75")).toBeInTheDocument();
  });

  it("renders without probabilities or readout", () => {
    const { container } = render(<ScoreScale levels={LEVELS} score={0.4} hideReadout />);
    expect(screen.queryByText("0.40")).toBeNull();
    expect(container.querySelectorAll(".rounded-t-\\[2px\\]")).toHaveLength(0);
  });
});

describe("score helpers", () => {
  it("orders legend levels numerically", () => {
    expect(scoreLevels({ "10": "Ten", "2": "Two", "1": "One" })).toEqual(["One", "Two", "Ten"]);
    expect(scoreLevels(undefined)).toEqual([]);
  });

  it("reads the level a score rounds to", () => {
    const r = scoreReadout({
      value: 3.72,
      levels: ["Minimal", "Low", "Moderate", "High", "Critical"],
    });
    expect(r).toMatchObject({ score: 3.72, level: "Critical" });
  });
});
