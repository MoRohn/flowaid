import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg,
  fisherExactGreater,
  logGamma,
  mannWhitney,
  median,
  normalCdf,
  wilson,
} from "./stats.js";

describe("logGamma", () => {
  it("matches factorials and Γ(½)", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(11)).toBeCloseTo(Math.log(3_628_800), 10);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
});

describe("normalCdf", () => {
  it("matches table values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975002, 5);
    expect(normalCdf(-2.5758)).toBeCloseTo(0.005, 5);
  });
});

describe("fisherExactGreater", () => {
  it("reproduces the lady tasting tea (3 of 4 right: p = 17/70)", () => {
    expect(fisherExactGreater(3, 1, 1, 3)).toBeCloseTo(17 / 70, 12);
    expect(fisherExactGreater(4, 0, 0, 4)).toBeCloseTo(1 / 70, 12);
  });
  it("is 1 when the recent window is not worse or nothing failed", () => {
    expect(fisherExactGreater(0, 10, 5, 5)).toBeCloseTo(1, 12);
    expect(fisherExactGreater(0, 10, 0, 10)).toBe(1);
  });
  it("handles large tables without overflow", () => {
    const p = fisherExactGreater(300, 700, 1000, 9000);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-20);
  });
  it("rejects negative or fractional counts", () => {
    expect(() => fisherExactGreater(-1, 1, 1, 1)).toThrow(RangeError);
    expect(() => fisherExactGreater(1.5, 1, 1, 1)).toThrow(RangeError);
  });
});

describe("mannWhitney", () => {
  it("matches the corrected normal approximation for separated samples", () => {
    // U = 0, mean 12.5, sd = √(25·11/12); z = (12.5 − 0.5)/sd = 2.5067 → p = 0.01219
    const r = mannWhitney([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]);
    expect(r.u).toBe(0);
    expect(r.auc).toBe(0);
    expect(r.p).toBeCloseTo(0.01219, 4);
    expect(mannWhitney([6, 7, 8, 9, 10], [1, 2, 3, 4, 5], "greater").p).toBeCloseTo(0.006093, 4);
    expect(mannWhitney([6, 7, 8, 9, 10], [1, 2, 3, 4, 5], "less").p).toBeGreaterThan(0.99);
  });
  it("corrects for ties and returns p = 1 when every value is equal", () => {
    expect(mannWhitney([1, 1, 1], [1, 1, 1]).p).toBe(1);
    const tied = mannWhitney([1, 2, 2, 3], [2, 2, 2, 4]);
    expect(tied.u).toBe(6);
    expect(tied.p).toBeGreaterThan(0.5);
  });
});

describe("benjaminiHochberg", () => {
  it("adjusts in input order with monotone q-values", () => {
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]);
    expect(q.map((v) => Number(v.toFixed(6)))).toEqual([0.02, 0.04, 0.04, 0.02]);
    expect(benjaminiHochberg([])).toEqual([]);
    expect(benjaminiHochberg([0.9, 0.95])).toEqual([0.95, 0.95]);
  });
});

describe("wilson and median", () => {
  it("gives the Wilson interval", () => {
    const zero = wilson(0, 10);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeCloseTo(0.2775, 4);
    const half = wilson(50, 100);
    expect(half.lo).toBeCloseTo(0.4038, 4);
    expect(half.hi).toBeCloseTo(0.5962, 4);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
  it("takes the median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});
