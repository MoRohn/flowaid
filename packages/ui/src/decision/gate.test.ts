import { describe, expect, it } from "vitest";
import { makeBooleanDecision } from "@/lib/decisionBuilders";
import {
  gateFromThresholds,
  gateOutcome,
  gateOutcomeForDecision,
  thresholdsFromGate,
  type GateConfig,
  type GateOutcome,
} from "@/types";
import { gateModel, gateShares } from "./gate";

/** A choice decision at a given confidence (the gate reads only kind, value and confidence). */
function choice(confidence: number) {
  return { kind: "choice" as const, value: "a", confidence };
}

const TWO_WAY: GateConfig = { threshold: 0.9 };
const THREE_WAY: GateConfig = { threshold: 0.9, reviewBand: 0.2 };

describe("gate mapping (ARCHITECTURE.md §6.3)", () => {
  it("maps auto := threshold and review := threshold − (reviewBand ?? threshold)", () => {
    expect(thresholdsFromGate(TWO_WAY)).toEqual({ review: 0, auto: 0.9 });
    expect(thresholdsFromGate(THREE_WAY)).toEqual({ review: 0.7, auto: 0.9 });
    // A band wider than the threshold leaves nothing below it: the floor clamps to 0.
    expect(thresholdsFromGate({ threshold: 0.5, reviewBand: 0.8 })).toEqual({
      review: 0,
      auto: 0.5,
    });
  });

  it("maps back to the runtime config, dropping reviewBand for the two-way floor of 0", () => {
    expect(gateFromThresholds({ review: 0, auto: 0.9 })).toEqual({ threshold: 0.9 });
    expect(gateFromThresholds({ review: 0.7, auto: 0.9 })).toEqual({
      threshold: 0.9,
      reviewBand: 0.2,
    });
    expect(gateFromThresholds({ review: 0.7, auto: 0.9 }, true)).toEqual({
      threshold: 0.9,
      reviewBand: 0.2,
      requireValue: true,
    });
    for (const config of [TWO_WAY, THREE_WAY, { threshold: 0.75, reviewBand: 0.05 }]) {
      expect(gateFromThresholds(thresholdsFromGate(config))).toEqual(config);
    }
  });

  it("names the model", () => {
    expect(gateModel(thresholdsFromGate(TWO_WAY))).toBe("two-way");
    expect(gateModel(thresholdsFromGate(THREE_WAY))).toBe("three-way");
  });
});

describe("two-way gate (no reviewBand)", () => {
  const t = thresholdsFromGate(TWO_WAY);
  it.each<[number, GateOutcome]>([
    [1, "pass"],
    [0.9, "pass"],
    [0.8999, "review"],
    [0.3, "review"],
    [0, "review"],
  ])("confidence %s → %s", (confidence, outcome) => {
    expect(gateOutcome(confidence, t)).toBe(outcome);
    expect(gateOutcomeForDecision(choice(confidence), TWO_WAY)).toBe(outcome);
  });

  it("never fails, so no share lands in fail", () => {
    expect(gateShares([0, 0.2, 0.95], t)).toEqual({ pass: 1 / 3, review: 2 / 3, fail: 0 });
  });

  it("routes a requireValue miss to review", () => {
    const no = makeBooleanDecision({ pYes: 0.02 });
    expect(no.confidence).toBeGreaterThanOrEqual(0.9);
    expect(gateOutcomeForDecision(no, { ...TWO_WAY, requireValue: true })).toBe("review");
    expect(gateOutcomeForDecision(no, TWO_WAY)).toBe("pass");
  });
});

describe("three-way gate (reviewBand set)", () => {
  const t = thresholdsFromGate(THREE_WAY);
  it.each<[number, GateOutcome]>([
    [0.95, "pass"],
    [0.9, "pass"],
    [0.85, "review"],
    [0.7, "review"],
    [0.69, "fail"],
    [0, "fail"],
  ])("confidence %s → %s", (confidence, outcome) => {
    expect(gateOutcome(confidence, t)).toBe(outcome);
  });

  it("follows the runtime arithmetic for decisions away from the float-noisy boundary", () => {
    const at = (confidence: number) => gateOutcomeForDecision(choice(confidence), THREE_WAY);
    expect(at(0.95)).toBe("pass");
    expect(at(0.8)).toBe("review");
    expect(at(0.71)).toBe("review");
    expect(at(0.5)).toBe("fail");
  });

  it("routes a requireValue miss to fail", () => {
    const no = makeBooleanDecision({ pYes: 0.02 });
    const yes = makeBooleanDecision({ pYes: 0.98 });
    expect(gateOutcomeForDecision(no, { ...THREE_WAY, requireValue: true })).toBe("fail");
    expect(gateOutcomeForDecision(yes, { ...THREE_WAY, requireValue: true })).toBe("pass");
    expect(gateOutcomeForDecision(choice(0.99), { ...THREE_WAY, requireValue: true })).toBe("fail");
  });
});
