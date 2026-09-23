import { describe, expect, it } from "vitest";

import { ISO_UTC_RE, elapsedMs, isIsoUtc, nowIso, parseIso, toIso } from "./time.js";

describe("time", () => {
  it("nowIso returns millisecond-precision UTC ISO strings", () => {
    const iso = nowIso();
    expect(iso).toMatch(ISO_UTC_RE);
    expect(Math.abs(Date.parse(iso) - Date.now())).toBeLessThan(5_000);
  });

  it("nowIso accepts an injected clock", () => {
    expect(nowIso(() => 0)).toBe("1970-01-01T00:00:00.000Z");
    expect(nowIso(() => 1_700_000_000_123)).toBe("2023-11-14T22:13:20.123Z");
  });

  it("toIso/parseIso round-trip and reject garbage", () => {
    expect(toIso(1_700_000_000_123)).toBe("2023-11-14T22:13:20.123Z");
    expect(parseIso("2023-11-14T22:13:20.123Z")).toBe(1_700_000_000_123);
    expect(parseIso("not a date")).toBeUndefined();
    expect(() => toIso(Number.NaN)).toThrow(RangeError);
  });

  it("isIsoUtc accepts only the canonical form", () => {
    expect(isIsoUtc("2023-11-14T22:13:20.123Z")).toBe(true);
    expect(isIsoUtc("2023-11-14T22:13:20Z")).toBe(false);
    expect(isIsoUtc("2023-11-14T22:13:20.123+01:00")).toBe(false);
    expect(isIsoUtc("2023-13-40T22:13:20.123Z")).toBe(false);
    expect(isIsoUtc(1)).toBe(false);
  });

  it("elapsedMs subtracts timestamps", () => {
    expect(elapsedMs("2023-11-14T22:13:20.000Z", "2023-11-14T22:13:21.500Z")).toBe(1500);
    expect(() => elapsedMs("x", "2023-11-14T22:13:21.500Z")).toThrow(RangeError);
  });
});
