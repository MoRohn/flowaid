import { describe, expect, it } from "vitest";
import {
  aceOf,
  calibrationMetrics,
  eceOf,
  mceOf,
  psi,
  rankedProbabilityScore,
  reliabilityBins,
  wilsonLower,
  type CalibrationObservation,
} from "./metrics.js";
import {
  adjudicate,
  interRaterDisagreement,
  matchStrata,
  sampleDraw,
  sampleForLabel,
} from "./sampling.js";
import { driftAlarms } from "./drift.js";
import { recommendThresholds } from "./recommend.js";
import { CalibrationMetricsSchema, DecisionLabelSchema, type DecisionLabel } from "./schemas.js";

function choice(
  confidence: number,
  outcome: string,
  label: string | null,
  extra: Partial<CalibrationObservation> = {},
): CalibrationObservation {
  const other = outcome === "a" ? "b" : "a";
  return {
    kind: "choice",
    confidence,
    outcome,
    distribution: { [outcome]: confidence, [other]: 1 - confidence },
    route: confidence >= 0.9 ? "auto" : "human",
    label,
    ...extra,
  };
}

/** A perfectly calibrated segment: in each confidence bucket the share correct equals the confidence. */
function calibrated(n: number): CalibrationObservation[] {
  const out: CalibrationObservation[] = [];
  for (const c of [0.55, 0.65, 0.75, 0.85, 0.95]) {
    for (let i = 0; i < n; i += 1) out.push(choice(c, "a", i < Math.round(c * n) ? "a" : "b"));
  }
  return out;
}

describe("reliability bins and calibration errors", () => {
  it("puts confidences into 10 equal-width bins, with 1.0 in the last bin", () => {
    const bins = reliabilityBins([
      { c: 0, y: 1, w: 1 },
      { c: 0.55, y: 0, w: 1 },
      { c: 1, y: 1, w: 2 },
    ]);
    expect(bins).toHaveLength(10);
    expect(bins[0]?.labeled).toBe(1);
    expect(bins[5]?.accuracy).toBe(0);
    expect(bins[9]?.weight).toBe(2);
    expect(bins[3]?.meanConfidence).toBeNull();
  });

  it("gives ECE 0 for a perfectly calibrated segment and the gap for an overconfident one", () => {
    expect(calibrationMetrics(calibrated(100)).ece).toBeCloseTo(0, 10);
    const over = Array.from({ length: 100 }, (_, i) => choice(0.95, "a", i < 70 ? "a" : "b"));
    expect(calibrationMetrics(over).ece).toBeCloseTo(0.25, 10);
  });

  it("returns null metrics without labels", () => {
    const m = calibrationMetrics([choice(0.9, "a", null)]);
    expect(m.labeled).toBe(0);
    expect(m.ece).toBeNull();
    expect(m.accuracy).toBeNull();
    expect(eceOf(reliabilityBins([]))).toBeNull();
    expect(aceOf([])).toBeNull();
  });

  it("ignores bins with fewer than 10 labels for MCE", () => {
    const bins = reliabilityBins(Array.from({ length: 9 }, () => ({ c: 0.95, y: 0, w: 1 })));
    expect(mceOf(bins)).toBeNull();
    const enough = reliabilityBins(Array.from({ length: 10 }, () => ({ c: 0.95, y: 0, w: 1 })));
    expect(mceOf(enough)).toBeCloseTo(0.95, 10);
  });

  it("weights labeled receipts by 1/π (Horvitz-Thompson)", () => {
    // One correct receipt sampled with π = 0.1 counts ten times against one wrong one with π = 1.
    const m = calibrationMetrics([
      choice(0.8, "a", "a", { inclusionProbability: 0.1 }),
      choice(0.8, "a", "b", { inclusionProbability: 1 }),
    ]);
    expect(m.accuracy).toBeCloseTo(10 / 11, 10);
    expect(() => calibrationMetrics([choice(0.8, "a", "a", { inclusionProbability: 0 })])).toThrow(
      RangeError,
    );
  });

  it("measures Noul on raw pYes against label = true, with Brier", () => {
    const obs: CalibrationObservation[] = [
      {
        kind: "boolean",
        confidence: 0.8,
        outcome: "true",
        distribution: { true: 0.8, false: 0.2 },
        route: "human",
        label: "true",
      },
      {
        kind: "boolean",
        confidence: 0.8,
        outcome: "false",
        distribution: { true: 0.2, false: 0.8 },
        route: "human",
        label: "true",
      },
    ];
    const m = calibrationMetrics(obs);
    expect(m.brier).toBeCloseTo((0.2 ** 2 + 0.8 ** 2) / 2, 10);
    expect(m.accuracy).toBe(0.5);
  });

  it("computes classwise ECE and multiclass Brier for choice contracts", () => {
    const m = calibrationMetrics([choice(0.9, "a", "a"), choice(0.9, "a", "b")]);
    expect(m.classwise?.["a"]?.support).toBe(1);
    expect(m.classwise?.["b"]?.support).toBe(1);
    expect(m.classwise?.["a"]?.accuracy).toBe(0.5);
    expect(m.brier).toBeCloseTo((0.01 + 0.01 + 0.81 + 0.81) / 2, 10);
  });

  it("computes the ranked probability score for ordered levels", () => {
    expect(rankedProbabilityScore({ "0": 0, "1": 0, "2": 1 }, 2, 3)).toBe(0);
    expect(rankedProbabilityScore({ "0": 1, "1": 0, "2": 0 }, 2, 3)).toBe(1);
    const m = calibrationMetrics([
      {
        kind: "score",
        confidence: 0.7,
        outcome: "2",
        distribution: { "0": 0.1, "1": 0.2, "2": 0.7 },
        route: "human",
        label: "2",
      },
    ]);
    expect(m.rps).toBeCloseTo(((0.1 - 0) ** 2 + (0.3 - 0) ** 2) / 2, 10);
  });

  it("reports routing shares, auto precision with a Wilson bound, route correctness and rates", () => {
    const obs = [
      choice(0.95, "a", "a", { permittedRoute: "auto" }),
      choice(0.95, "a", "b", { permittedRoute: "human", override: true }),
      choice(0.5, "a", null, { escape: true, staleOption: true }),
      { ...choice(0.6, "a", null), route: "improve" as const, blindRetryBlocked: true },
    ];
    const m = calibrationMetrics(obs);
    expect(m.routeShare).toEqual({ auto: 0.5, improve: 0.25, human: 0.25 });
    expect(m.autoPrecision?.value).toBe(0.5);
    expect(m.autoPrecision?.lower95).toBeCloseTo(wilsonLower(0.5, 2), 12);
    expect(m.routeCorrectness).toBe(0.5);
    expect(m.rates).toEqual({
      escape: 0.25,
      override: 0.5,
      staleOption: 0.25,
      blindRetryBlocked: 0.25,
      interRaterDisagreement: null,
    });
    expect(CalibrationMetricsSchema.parse(m)).toEqual(m);
  });

  it("measures near-threshold mass on both sides of autoAt", () => {
    const obs = [0.89, 0.9, 0.91, 0.95, 0.5].map((c) => choice(c, "a", null));
    const m = calibrationMetrics(obs, { autoAt: 0.9, nearThresholdBand: 0.03 });
    expect(m.nearThreshold).toEqual({ band: 0.03, above: 0.4, below: 0.2 });
  });

  it("computes PSI against a baseline histogram and 0 for an identical one", () => {
    const m = calibrationMetrics(calibrated(10));
    const counts = m.confidenceHistogram.map((h) => h.count);
    expect(psi(counts, counts)).toBeCloseTo(0, 10);
    const shifted = [...counts].reverse();
    expect(psi(counts, shifted) ?? 0).toBeGreaterThan(0.2);
    expect(psi([], [])).toBeNull();
    expect(calibrationMetrics(calibrated(10), { baselineHistogram: counts }).psi).toBeCloseTo(
      0,
      10,
    );
  });

  it("keeps the Wilson bound inside [0, p] and tightening with n", () => {
    expect(wilsonLower(1, 0)).toBe(0);
    const small = wilsonLower(0.95, 20);
    const large = wilsonLower(0.95, 2000);
    expect(small).toBeLessThan(large);
    expect(large).toBeLessThan(0.95);
    expect(small).toBeGreaterThanOrEqual(0);
  });
});

describe("label sampling and adjudication", () => {
  it("matches strata from decision facts", () => {
    expect(
      matchStrata({
        confidence: 0.91,
        autoAt: 0.9,
        outcomeShare: 0.01,
        consequenceClass: "high",
        escape: true,
        route: "auto",
        newVersion: true,
        shadowDisagreement: true,
      }),
    ).toEqual([
      "near_threshold",
      "rare_outcome",
      "consequence_high",
      "escape_outcome",
      "auto_route",
      "new_version",
      "shadow_disagreement",
    ]);
  });

  it("uses the highest matching stratum rate and a deterministic draw", () => {
    const id = "1f0e4b52-9f0c-7b52-8a8d-3f1f2a7c9e11";
    const d = sampleForLabel(id, ["auto_route", "rare_outcome"]);
    expect(d.inclusionProbability).toBe(0.5);
    expect(sampleForLabel(id, ["auto_route", "rare_outcome"])).toEqual(d);
    expect(sampleForLabel(id, []).inclusionProbability).toBe(0.02);
    const draw = sampleDraw(id);
    expect(draw).toBeGreaterThanOrEqual(0);
    expect(draw).toBeLessThan(1);
    expect(d.include).toBe(draw < 0.5);
  });

  it("samples close to the configured rate across many receipts", () => {
    let hits = 0;
    for (let i = 0; i < 4000; i += 1)
      if (sampleForLabel(`receipt-${i}`, ["auto_route"]).include) hits += 1;
    expect(hits / 4000).toBeGreaterThan(0.035);
    expect(hits / 4000).toBeLessThan(0.065);
  });

  const receiptId = "0190a1b2-0000-7000-8000-000000000001";
  function label(
    labeler: string,
    outcome: string,
    source: DecisionLabel["source"] = "reviewer",
    t = "2026-09-23T10:00:00.000Z",
  ): DecisionLabel {
    return DecisionLabelSchema.parse({
      id: `0190a1b2-0000-7000-8000-${String(Math.abs(hash(labeler + outcome + t)))
        .padStart(12, "0")
        .slice(0, 12)}`,
      receiptId,
      labeler,
      source,
      outcome,
      permittedRoute: null,
      rubricVersion: "r1",
      rationale: null,
      inclusionProbability: null,
      createdAt: t,
    });
  }
  function hash(s: string): number {
    let h = 7;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000_007;
    return h;
  }

  it("folds labels into unlabeled, single, agreed, disputed and adjudicated", () => {
    expect(adjudicate(receiptId, []).status).toBe("unlabeled");
    expect(adjudicate(receiptId, [label("u1", "billing")])).toMatchObject({
      status: "single",
      outcome: "billing",
    });
    expect(adjudicate(receiptId, [label("u1", "billing"), label("u2", "billing")])).toMatchObject({
      status: "agreed",
      outcome: "billing",
    });
    const disputed = adjudicate(receiptId, [label("u1", "billing"), label("u2", "technical")]);
    expect(disputed).toMatchObject({ status: "disputed", outcome: null, disagreed: true });
    const resolved = adjudicate(receiptId, [
      label("u1", "billing"),
      label("u2", "technical"),
      label("lead", "technical", "adjudication"),
    ]);
    expect(resolved).toMatchObject({
      status: "adjudicated",
      outcome: "technical",
      disagreed: true,
    });
    expect(
      interRaterDisagreement([
        disputed,
        resolved,
        adjudicate(receiptId, [label("u1", "a"), label("u2", "a")]),
      ]),
    ).toBeCloseTo(2 / 3, 10);
    expect(interRaterDisagreement([])).toBeNull();
  });

  it("ignores fixture labels and keeps only the latest label per labeler", () => {
    const r = adjudicate(receiptId, [
      label("system", "general", "fixture"),
      label("u1", "billing", "reviewer", "2026-09-23T09:00:00.000Z"),
      label("u1", "technical", "reviewer", "2026-09-23T11:00:00.000Z"),
    ]);
    expect(r).toMatchObject({ status: "single", outcome: "technical", labelers: 1 });
  });
});

describe("drift alarms", () => {
  const base = calibrationMetrics(calibrated(60), { autoAt: 0.9 });
  it("raises nothing when the window matches the baseline", () => {
    expect(driftAlarms({ metrics: base }, { metrics: base })).toEqual([]);
  });

  it("raises ece_rise (critical at +0.06) and names what to inspect first", () => {
    const worse = calibrationMetrics(
      Array.from({ length: 100 }, (_, i) => choice(0.95, "a", i < 80 ? "a" : "b")),
    );
    const alarms = driftAlarms({ metrics: worse }, { metrics: base });
    const ece = alarms.find((a) => a.kind === "ece_rise");
    expect(ece?.severity).toBe("critical");
    expect(ece?.inspectFirst).toContain("evidence");
  });

  it("raises override, stale-option, near-threshold, disagreement, model and monotonicity alarms", () => {
    const obs = Array.from({ length: 100 }, (_, i) =>
      choice(i < 20 ? 0.91 : 0.95, "a", null, { override: i < 6, staleOption: i < 2 }),
    );
    const m = calibrationMetrics(obs, { autoAt: 0.9, interRaterDisagreement: 0.25 });
    const kinds = driftAlarms(
      { metrics: m, resolvedModel: "jev-1.14.0" },
      { metrics: base, resolvedModel: "jev-1.13.0" },
      { monotonicityViolationShare: 0.2 },
    ).map((a) => a.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "override_rate",
        "stale_options",
        "near_threshold_mass",
        "label_disagreement",
        "model_version_changed",
        "monotonicity",
      ]),
    );
  });

  it("needs enough decisions before rate-rise alarms fire", () => {
    const few = calibrationMetrics([choice(0.5, "a", null, { escape: true })]);
    expect(
      driftAlarms({ metrics: few }, { metrics: base }).some((a) => a.kind === "escape_rate_rise"),
    ).toBe(false);
  });
});

describe("threshold recommendation", () => {
  function segment(): CalibrationObservation[] {
    // 300 labeled at 0.97 (99 % correct), 300 at 0.8 (80 % correct), 200 at 0.55 (50 % correct).
    const out: CalibrationObservation[] = [];
    for (let i = 0; i < 300; i += 1) out.push(choice(0.97, "a", i < 297 ? "a" : "b"));
    for (let i = 0; i < 300; i += 1) out.push(choice(0.8, "a", i < 240 ? "a" : "b"));
    for (let i = 0; i < 200; i += 1) out.push(choice(0.55, "a", i < 110 ? "a" : "b"));
    return out;
  }

  it("never recommends automation for irreversible consequences", () => {
    const r = recommendThresholds({
      observations: segment(),
      consequenceClass: "irreversible",
      current: { autoAt: null, improveAt: null },
      hasImproveActions: false,
    });
    expect(r.recommended.autoAt).toBeNull();
    expect(r.warnings[0]).toMatch(/Irreversible/);
  });

  it("recommends the smallest threshold whose Wilson bound meets the target", () => {
    const r = recommendThresholds({
      observations: segment(),
      consequenceClass: "low",
      current: { autoAt: 0.9, improveAt: null },
      hasImproveActions: true,
      target: { maxEce: 0.1 },
    });
    expect(r.recommended.autoAt).toBe(0.81);
    expect(r.achieved?.lower95).toBeGreaterThanOrEqual(0.95);
    expect(r.achieved?.n).toBe(300);
    expect(r.recommended.improveAt).not.toBeNull();
  });

  it("refuses when calibration is too poor or labels too few", () => {
    const poor = Array.from({ length: 200 }, (_, i) => choice(0.97, "a", i < 120 ? "a" : "b"));
    const r = recommendThresholds({
      observations: poor,
      consequenceClass: "low",
      current: { autoAt: 0.9, improveAt: null },
      hasImproveActions: false,
    });
    expect(r.recommended.autoAt).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/ECE/);
    const few = recommendThresholds({
      observations: segment().slice(0, 50),
      consequenceClass: "medium",
      current: { autoAt: null, improveAt: null },
      hasImproveActions: false,
      target: { maxEce: 1 },
    });
    expect(few.recommended.autoAt).toBeNull();
  });
});
