import { describe, expect, it } from "vitest";
import {
  attributeVersion,
  detectChanges,
  type WindowData,
  type WorkflowWindows,
} from "./detect.js";

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}

/** mulberry32: a small seeded PRNG so simulations are reproducible */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** log-normal samples (median `m`, shape σ = 0.6): heavy-tailed like latency and cost */
function logNormal(rand: () => number, n: number, m: number): number[] {
  return Array.from({ length: n }, () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return m * Math.exp(0.6 * z);
  });
}

function window(
  rand: () => number,
  n: number,
  failRate: number,
  medianMs = 1000,
  medianUsd = 0.01,
  version = "v1",
): WindowData {
  let failed = 0;
  for (let i = 0; i < n; i++) if (rand() < failRate) failed++;
  return {
    finished: n,
    failed,
    durationsMs: logNormal(rand, n - failed, medianMs),
    costsUsd: logNormal(rand, n, medianUsd),
    confidences: Array.from({ length: n }, () => 0.7 + 0.25 * rand()),
    errorCodes: failed ? { E_TIMEOUT: failed } : {},
    versions: { [version]: n },
  };
}

const wf = (i: number, recent: WindowData, baseline: WindowData): WorkflowWindows => ({
  workflowId: `wf-${i}`,
  workflowName: `Workflow ${i}`,
  recent,
  baseline,
});

describe("detectChanges", () => {
  it("reports a failure-rate jump with its evidence and the version it coincides with", () => {
    const rand = rng(1);
    const out = detectChanges([
      wf(1, window(rand, 100, 0.35, 1000, 0.01, "v2"), window(rand, 400, 0.05)),
    ]);
    const f = must(out.find((i) => i.kind === "failure_rate"));
    expect(f.severity).toBe("critical");
    expect(f.evidence.test).toBe("fisher_exact");
    expect(f.evidence.qValue).toBeLessThan(0.05);
    expect(f.evidence.recent.n).toBe(100);
    expect(must(f.evidence.recent.interval).lo).toBeLessThan(f.evidence.recent.value);
    expect(f.attribution).toEqual({ versionId: "v2", share: 1 });
    expect(f.title).toBe("Workflow 1 fails more often since a new version");
  });

  it("reports slower and costlier runs by the ratio of medians", () => {
    const rand = rng(2);
    const out = detectChanges([
      wf(1, window(rand, 200, 0.02, 3000, 0.05), window(rand, 400, 0.02, 1000, 0.01)),
    ]);
    const kinds = out.map((i) => i.kind);
    expect(kinds).toContain("latency");
    expect(kinds).toContain("cost");
    const lat = must(out.find((i) => i.kind === "latency"));
    expect(lat.evidence.effect.ratio).toBeGreaterThan(2);
    expect(lat.severity).toBe("warning");
  });

  it("reports a confidence drop", () => {
    const rand = rng(3);
    const recent = window(rand, 200, 0.02);
    const lower = { ...recent, confidences: recent.confidences.map((c) => c - 0.2) };
    const out = detectChanges([wf(1, lower, window(rand, 400, 0.02))]);
    expect(out.map((i) => i.kind)).toContain("confidence_drop");
  });

  it("reports an error code the baseline never had", () => {
    const rand = rng(4);
    const recent = { ...window(rand, 100, 0), failed: 4, errorCodes: { E_AUTH: 4 } };
    const out = detectChanges([wf(1, recent, window(rand, 200, 0))]);
    const e = out.find((i) => i.kind === "new_error");
    expect(e?.id).toBe("new_error:wf-1:E_AUTH");
    expect(e?.summary).toBe(
      "4 of 100 recent runs failed with E_AUTH; none of the 200 earlier runs did.",
    );
  });

  it("claims nothing below the minimum sample sizes", () => {
    const rand = rng(5);
    expect(detectChanges([wf(1, window(rand, 10, 0.9), window(rand, 10, 0))])).toEqual([]);
  });

  it("ignores significant but small effects", () => {
    // 20% → 23% over large samples can be significant; it is below +5 points and ×1.5
    const w = wf(
      1,
      {
        ...window(rng(6), 0, 0),
        finished: 20_000,
        failed: 4_600,
        durationsMs: [],
        costsUsd: [],
        confidences: [],
      },
      {
        ...window(rng(7), 0, 0),
        finished: 20_000,
        failed: 4_000,
        durationsMs: [],
        costsUsd: [],
        confidences: [],
      },
    );
    expect(detectChanges([w])).toEqual([]);
  });

  it("keeps the false-positive rate low when nothing changed (simulation)", () => {
    const rand = rng(42);
    let trialsWithAny = 0;
    const trials = 200;
    for (let t = 0; t < trials; t++) {
      const workflows = Array.from({ length: 10 }, (_, i) =>
        wf(i, window(rand, 60, 0.1), window(rand, 240, 0.1)),
      ).map((w) => ({
        ...w,
        recent: { ...w.recent, errorCodes: {} },
        baseline: { ...w.baseline, errorCodes: {} },
      }));
      if (detectChanges(workflows).length > 0) trialsWithAny++;
    }
    // BH at 5% under the global null bounds the family-wise rate by 5%; the practical-effect
    // floor pushes it lower. Allow sampling noise.
    // measured: 7 of 200 trials (3.5%) at seed 42
    expect(trialsWithAny / trials).toBeLessThan(0.05);
  });

  it("detects a real failure-rate increase with high power (simulation)", () => {
    const rand = rng(7);
    let detected = 0;
    const trials = 200;
    for (let t = 0; t < trials; t++) {
      const workflows = [
        wf(0, window(rand, 100, 0.3), window(rand, 400, 0.1)),
        ...Array.from({ length: 9 }, (_, i) =>
          wf(i + 1, window(rand, 100, 0.1), window(rand, 400, 0.1)),
        ),
      ];
      if (
        detectChanges(workflows).some((i) => i.kind === "failure_rate" && i.workflowId === "wf-0")
      )
        detected++;
    }
    // measured 0.94 at seed 7 (100 recent runs, 40 tests under BH)
    expect(detected / trials).toBeGreaterThan(0.9);
  });
});

describe("attributeVersion", () => {
  it("names a version new to the recent window that carries at least half its runs", () => {
    expect(attributeVersion({ v2: 30, v1: 10 }, { v1: 100 })).toEqual({
      versionId: "v2",
      share: 0.75,
    });
    expect(attributeVersion({ v2: 10, v1: 30 }, { v1: 100 })).toBeUndefined();
    expect(attributeVersion({ v1: 10 }, { v1: 100 })).toBeUndefined();
    expect(attributeVersion({}, {})).toBeUndefined();
  });
});
